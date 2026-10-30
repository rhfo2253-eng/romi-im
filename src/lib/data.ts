import membersJson from '../../data/members.json';
import livesJson from '../../data/lives.json';
import discographyJson from '../../data/discography.json';
import eventsJson from '../../data/events.json';

export interface Fact { label: string; value: string; source: string }
export interface Member {
  id: string; name: string; color: string; colorDark?: string; colorName: string; colorSource?: string; facts: Fact[];
}
export interface Chapter { title: string; time: number }
export interface Short { youtubeId: string; title: string }
export interface Episode {
  sample?: boolean; id: string; title: string; liveDate: string; publishDate: string;
  youtubeId: string; duration: number; members: string[]; anniversary: string | null;
  chapters: Chapter[]; shorts: Short[]; weverseUrl: string | null; thumbnail: string | null;
}
export interface Live {
  sample?: boolean; id: string; date: string; title: string; members: string[];
  duration: number | null; weverseUrl: string | null; episode: string | null;
}
export interface Release {
  id: string; title: string; type: string; releaseDate: string | null; status?: string; titleTrack: string | null;
  mv: string | null; source: string;
}
export interface SiteEvent {
  id: string; date: string; repeat?: 'yearly'; type: string; title: string; source: string;
}

export const members = membersJson as Member[];
export const lives = (livesJson as Live[]).toSorted((a, b) => b.date.localeCompare(a.date));
// 발매일이 정해지지 않은 예정작이 맨 앞
export const discography = (discographyJson as Release[]).toSorted((a, b) =>
  (b.releaseDate ?? '9999').localeCompare(a.releaseDate ?? '9999'));
export const events = eventsJson as SiteEvent[];

const episodeModules = import.meta.glob<Episode>('../../data/episodes/*.json', { eager: true, import: 'default' });
export const episodes = Object.values(episodeModules).toSorted((a, b) =>
  b.liveDate.localeCompare(a.liveDate) || b.publishDate.localeCompare(a.publishDate));

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
    items.push({ date: e.publishDate, title: `압축본 공개: ${e.title}`, kind: 'episode', href: episodeHref(e.id), sample: e.sample, repeat: false });
  }
  return items;
}
