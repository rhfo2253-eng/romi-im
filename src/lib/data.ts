import membersJson from '../../data/members.json';
import livesJson from '../../data/lives.json';
import discographyJson from '../../data/discography.json';
import eventsJson from '../../data/events.json';
import photosJson from '../../data/photos.json';
import officialVideosJson from '../../data/official-videos.json';

export interface Fact { label: string; value: string; source: string }
export interface Member {
  id: string; name: string; color: string; colorDark?: string; colorName: string; colorSource?: string; facts: Fact[];
}
/** time: 장면 시작 초. 모르면 null(누르면 처음부터 재생) */
export interface Chapter { title: string; time: number | null }
/** public: 유튜브에서 공개된 쇼츠인지(자동 갱신이 채움). 공개된 것만 사이트에 보인다. */
export interface Short { youtubeId: string; title: string; public?: boolean }
export interface Episode {
  sample?: boolean; id: string; no?: number; title: string; liveTitle?: string; liveDate: string; publishDate: string | null;
  youtubeId: string; duration: number | null; members: string[]; anniversary: string | null;
  /** hashtag: 설명란 태그, file: 정리 파일, manual: 주인이 고침, title: 제목으로 추정(확인 안 됨) */
  membersFrom?: 'hashtag' | 'file' | 'manual' | 'title';
  chapters: Chapter[]; shorts: Short[]; weverseUrl: string | null; thumbnail: string | null;
}
export interface Live {
  sample?: boolean; id: string; date: string; title: string; members: string[];
  duration: number | null; weverseUrl: string | null; episodes: string[];
  /** 공식 X의 라이브 시작 공지 */
  noticeUrl?: string;
}
export interface Release {
  id: string; title: string; type: string; releaseDate: string | null; status?: string; titleTrack: string | null;
  mv: string | null; source: string;
}
export interface SiteEvent {
  id: string; date: string; repeat?: 'yearly'; type: string; title: string; source: string;
}

export const members = membersJson as Member[];
// 발매일이 정해지지 않은 예정작이 맨 앞
export const discography = (discographyJson as Release[]).toSorted((a, b) =>
  (b.releaseDate ?? '9999').localeCompare(a.releaseDate ?? '9999'));
export const events = eventsJson as SiteEvent[];

const episodeModules = import.meta.glob<Episode>('../../data/episodes/*.json', { eager: true, import: 'default' });

/** 빌드한 날(한국 시간). 공개일이 이날 이후거나 비어 있는 편은 아직 비공개로 보고 사이트에서 뺀다. */
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
const isPublic = (e: Episode) => e.sample || (e.publishDate != null && e.publishDate <= today);

export const episodes = Object.values(episodeModules).filter(isPublic)
  .map((e) => ({ ...e, shorts: e.shorts.filter((s) => e.sample || s.public === true) }))
  .toSorted((a, b) =>
  b.liveDate.localeCompare(a.liveDate) || (a.no ?? 0) - (b.no ?? 0));
const publicIds = new Set(episodes.map((e) => e.id));

// 비공개 편으로 가는 링크는 라이브 기록에서도 뺀다
export const lives = (livesJson as Live[])
  .map((l) => ({ ...l, episodes: l.episodes.filter((id) => publicIds.has(id)) }))
  .toSorted((a, b) => b.date.localeCompare(a.date));

export interface Photo {
  url: string; platform: 'x' | 'instagram' | 'weverse'; date: string; members: string[]; note?: string;
}
export const photos = (photosJson as Photo[]).toSorted((a, b) => b.date.localeCompare(a.date));

/** 공식 유튜브 채널 최신 영상(scripts/sync-official.mjs가 매시간 채움) */
export interface OfficialVideo { youtubeId: string; title: string; publishDate: string | null; duration: number | null }
export const officialVideos = officialVideosJson as OfficialVideo[];

/** 공식 계정. 출처: 공식 유튜브 채널 정보에 걸린 링크, 공식 X·위버스 */
export const officialAccounts = [
  { name: '유튜브', handle: '@sa2m2nam3', url: 'https://www.youtube.com/@sa2m2nam3' },
  { name: 'X', handle: '@sa2m2nam3', url: 'https://x.com/sa2m2nam3' },
  { name: 'X 일본', handle: '@sa2m2nam3_JP', url: 'https://x.com/sa2m2nam3_JP' },
  { name: '인스타그램', handle: '@sa2m2nam3', url: 'https://www.instagram.com/sa2m2nam3/' },
  { name: '틱톡', handle: '@sa2m2nam3', url: 'https://www.tiktok.com/@sa2m2nam3' },
  { name: '위버스', handle: 'SAY MY NAME', url: 'https://weverse.io/saymyname' },
  { name: '페이스북', handle: 'official.sa2m2nam3', url: 'https://www.facebook.com/official.sa2m2nam3' },
  { name: '웨이보', handle: 'SAY MY NAME', url: 'https://weibo.com/u/7962178986' },
  { name: '일본 팬클럽', handle: 'saymyname.jp', url: 'https://saymyname.jp/' },
  { name: '소속사 X', handle: '@inkodeofficial', url: 'https://x.com/inkodeofficial' },
];


export const memberById = new Map(members.map((m) => [m.id, m]));

export const base = import.meta.env.BASE_URL.replace(/\/$/, '');
export const href = (path: string) => `${base}${path}`;
export const episodeHref = (id: string, t?: number) =>
  href(`/episodes/${encodeURIComponent(id)}/`) + (t ? `?t=${t}` : '');

export function formatDuration(sec: number | null | undefined) {
  if (sec == null) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${y}. ${m}. ${d}.`;
}

export const thumbOf = (e: Episode) =>
  e.sample ? null : e.thumbnail ?? `https://i.ytimg.com/vi/${e.youtubeId}/hqdefault.jpg`;

export const contactEmail = 'rhfo4333@gmail.com';
export const channelUrl = 'https://www.youtube.com/@smn00000';

/** 한 달력에 모든 날: 기념일, 발매일, 압축본 공개일 */
export interface DayItem { date: string; title: string; kind: 'anniversary' | 'release' | 'episode' | 'birthday' | 'broadcast' | 'event'; href?: string; source?: string; sample?: boolean; repeat: boolean }

export function calendarItems(): DayItem[] {
  const items: DayItem[] = [];
  for (const ev of events) {
    items.push({ date: ev.date, title: ev.title, kind: (['birthday', 'broadcast', 'event'].includes(ev.type) ? ev.type : 'anniversary') as DayItem['kind'], source: ev.source, repeat: ev.repeat === 'yearly' });
  }
  for (const r of discography) {
    if (!r.releaseDate) continue;
    items.push({ date: r.releaseDate, title: `${r.title} 발매`, kind: 'release', href: href('/discography/'), source: r.source, repeat: false });
  }
  for (const e of episodes) {
    if (!e.publishDate) continue;
    items.push({ date: e.publishDate, title: `압축본 공개: ${e.title}`, kind: 'episode', href: episodeHref(e.id), sample: e.sample, repeat: false });
  }
  return items;
}
