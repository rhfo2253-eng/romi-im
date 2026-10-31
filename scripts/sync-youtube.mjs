// 유튜브 채널(@smn00000)을 보고 data/episodes/ 를 갱신한다. GitHub Actions에서 매시간 실행.
//
// - 채널 "동영상" 탭에 공개된 영상 = 압축본. 데이터에 없으면 새 파일을 만든다.
// - 이미 있는 편: 비어 있는 공개일·길이·장면 시간·멤버·위버스 주소를 영상 정보로 채운다.
//   채널에 없는 편(비공개·예약)은 공개일을 비워 둬서 사이트에 안 보인다.
// - 채널 "Shorts" 탭의 쇼츠는 설명란의 본편 링크를 보고 해당 편에 붙인다.
//
// 로그인이나 API 키 없이 누구나 볼 수 있는 채널 페이지와 영상 정보만 쓴다.
// 사용: node scripts/sync-youtube.mjs [--dry-run]

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const HANDLE = 'smn00000';
const EPISODE_DIR = 'data/episodes';
const LIVES_FILE = 'data/lives.json';
const dryRun = process.argv.includes('--dry-run');
const CLIENT = { clientName: 'WEB', clientVersion: '2.20251001.00.00', hl: 'ko', gl: 'KR' };

const MEMBER_NAMES = {
  hitomi: ['히토미', '토미', '히부장'], shuie: ['슈이'], mei: ['메이'], kanny: ['카니'],
  soha: ['소하', '민하'], dohee: ['도희'], junhwi: ['준휘'], seungju: ['승주'],
};

const kstDate = (d) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(d);

/** 객체 안에서 key 이름이 같은 값을 모두 찾는다 */
function findAll(obj, key, out = []) {
  if (Array.isArray(obj)) obj.forEach((x) => findAll(x, key, out));
  else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (k === key) out.push(v);
      findAll(v, key, out);
    }
  }
  return out;
}

async function innertube(endpoint, body) {
  const res = await fetch(`https://www.youtube.com/youtubei/v1/${endpoint}?prettyPrint=false`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'accept-language': 'ko-KR' },
    body: JSON.stringify({ context: { client: CLIENT }, ...body }),
  });
  if (!res.ok) throw new Error(`${endpoint} ${res.status}`);
  return res.json();
}

/** "1:02:03" → 3723 */
const toSeconds = (t) => t?.match(/^\d+(:\d{2}){1,2}$/) ? t.split(':').reduce((a, n) => a * 60 + Number(n), 0) : null;

/** 썸네일 위 길이 표시 (동영상 탭에만 있음) */
export const lengths = new Map();

/** 채널 탭(videos, shorts)의 영상 id 목록. 다음 페이지가 있으면 끝까지 넘긴다. */
async function listTab(tab) {
  const html = await (await fetch(`https://www.youtube.com/@${HANDLE}/${tab}`, { headers: { 'accept-language': 'ko-KR' } })).text();
  const start = html.indexOf('ytInitialData = ');
  if (start < 0) throw new Error(`${tab} 탭을 읽지 못함`);
  let data = JSON.parse(html.slice(start + 'ytInitialData = '.length).match(/^(\{[\s\S]*?\});<\/script>/)[1]);
  const ids = [];
  for (let page = 0; page < 20; page++) {
    for (const l of findAll(data, 'lockupViewModel')) {
      if (!l.contentId) continue;
      ids.push(l.contentId);
      const sec = toSeconds(findAll(l, 'thumbnailBadgeViewModel')[0]?.text);
      if (sec) lengths.set(l.contentId, sec);
    }
    for (const s of findAll(data, 'shortsLockupViewModel')) {
      const id = findAll(s, 'videoId')[0];
      if (id) ids.push(id);
    }
    const token = findAll(data, 'continuationCommand').map((c) => c.token)[0];
    if (!token) break;
    data = await innertube('browse', { continuation: token });
  }
  return [...new Set(ids)];
}

function parseKoreanDate(text) {
  const m = text?.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
}

/** 영상 한 개의 제목, 공개일, 설명란, 설명란 속 링크 */
async function videoInfo(id) {
  const d = await innertube('next', { videoId: id });
  const desc = findAll(d, 'attributedDescription')[0];
  const title = findAll(d, 'videoPrimaryInfoRenderer').flatMap((r) => r.title?.runs ?? []).map((r) => r.text).join('')
    || findAll(d, 'reelPlayerHeaderRenderer').map((r) => r.reelTitleText?.runs?.map((x) => x.text).join(''))[0]
    || '';
  const links = findAll(desc, 'url').map((u) => {
    const q = u.match(/[?&]q=([^&]+)/);
    return q ? decodeURIComponent(q[1]) : u;
  });
  return {
    id,
    title,
    publishDate: parseKoreanDate(findAll(d, 'dateText')[0]?.simpleText ?? findAll(d, 'publishDate')[0]?.simpleText),
    description: desc?.content ?? '',
    links,
  };
}

/** 설명란의 "0:00 인사", "1:02:03 - 마무리" 같은 줄을 장면 목록으로 */
export function parseChapters(description) {
  const list = [];
  for (const line of description.split('\n')) {
    const m = line.trim().match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s*[-–—·]?\s*(.+)$/);
    if (m) list.push({ title: m[4].trim(), time: (Number(m[1] ?? 0) * 3600) + Number(m[2]) * 60 + Number(m[3]) });
  }
  // 유튜브 챕터 규칙과 같이 0:00으로 시작하고 3개 이상일 때만 장면 목록으로 본다
  return list.length >= 3 && list[0].time === 0 ? list : null;
}

/** 제목 끝의 (261013), (20250324), - 251225 같은 라이브 날짜 */
export function liveDateOf(title) {
  const m = title.match(/(?:\(|-\s*)(20)?(\d{2})(\d{2})(\d{2})\)?/g);
  if (!m) return null;
  const [, , yy, mm, dd] = m.at(-1).match(/(20)?(\d{2})(\d{2})(\d{2})/);
  return Number(mm) >= 1 && Number(mm) <= 12 ? `20${yy}-${mm}-${dd}` : null;
}

export function cleanTitle(title) {
  return title
    .replace(/\s*\(세마넴 라이브 압축\)/, '')
    .replace(/\s*(?:\((?:20)?\d{6}\)|-\s*\d{6})/g, '')
    .replace(/\s+/g, ' ')
    .trim() || title;
}

export function membersIn(text) {
  return Object.entries(MEMBER_NAMES)
    .filter(([, names]) => names.some((n) => text.includes(n)))
    .map(([id]) => id);
}

const weverseOf = (info) => info.links.find((u) => u.includes('weverse.io/saymyname/live/')) ?? null;

async function main() {
  const files = readdirSync(EPISODE_DIR).filter((f) => f.endsWith('.json'));
  const episodes = files.map((f) => ({ file: join(EPISODE_DIR, f), data: JSON.parse(readFileSync(join(EPISODE_DIR, f), 'utf8')) }));
  const byYoutube = new Map(episodes.map((e) => [e.data.youtubeId, e]));
  const knownShorts = new Set(episodes.flatMap((e) => e.data.shorts.map((s) => s.youtubeId)));
  const lives = JSON.parse(readFileSync(LIVES_FILE, 'utf8'));
  let livesChanged = false;
  const changed = new Map();
  const log = [];
  const mark = (e, why) => { changed.set(e.file, e); log.push(`${why}: ${e.data.title}`); };

  const videoIds = await listTab('videos');
  for (const id of videoIds) {
    const e = byYoutube.get(id);
    const d = e?.data;
    if (d && d.duration == null && lengths.has(id)) { d.duration = lengths.get(id); mark(e, '길이'); }
    const needs = !d || !d.publishDate || d.chapters.some((c) => c.time == null) || !d.weverseUrl;
    if (!needs) continue;
    const info = await videoInfo(id);
    const chapters = parseChapters(info.description);
    if (!d) {
      const liveDate = liveDateOf(info.title) ?? info.publishDate;
      const data = {
        id: `${liveDate.replace(/-/g, '').slice(2)}_${id}`,
        title: cleanTitle(info.title),
        liveDate,
        publishDate: info.publishDate,
        youtubeId: id,
        duration: lengths.get(id) ?? null,
        members: membersIn(`${info.title} ${info.description}`),
        anniversary: null,
        chapters: chapters ?? [],
        shorts: [],
        weverseUrl: weverseOf(info),
        thumbnail: null,
      };
      const ne = { file: join(EPISODE_DIR, `${data.id}.json`), data };
      byYoutube.set(id, ne);
      mark(ne, '새 편');
      // 라이브 기록에도 연결: 같은 위버스 라이브가 있으면 거기에, 없으면 새 줄
      const live = data.weverseUrl && lives.find((l) => l.weverseUrl === data.weverseUrl);
      if (live) live.episodes.push(data.id);
      else lives.push({ id: data.id, date: liveDate, title: data.title, members: data.members, duration: null, weverseUrl: data.weverseUrl, episodes: [data.id] });
      livesChanged = true;
      continue;
    }
    let touched = false;
    if (!d.publishDate && info.publishDate) { d.publishDate = info.publishDate; touched = true; }
    if (chapters && d.chapters.some((c) => c.time == null)) { d.chapters = chapters; touched = true; }
    if (!d.weverseUrl && weverseOf(info)) { d.weverseUrl = weverseOf(info); touched = true; }
    if (!d.members.length) {
      const found = membersIn(`${info.title} ${info.description}`);
      if (found.length) { d.members = found; touched = true; }
    }
    if (touched) mark(e, '갱신');
  }

  for (const id of await listTab('shorts')) {
    if (knownShorts.has(id)) continue;
    const info = await videoInfo(id);
    const main = info.links.map((u) => u.match(/watch\?v=([\w-]{11})/)?.[1]).find((v) => v && byYoutube.has(v));
    if (!main) continue;
    const e = byYoutube.get(main);
    e.data.shorts.push({ youtubeId: id, title: info.title.replace(/\s*#\S+/g, '').trim() });
    knownShorts.add(id);
    mark(e, '쇼츠 추가');
  }

  if (!dryRun) {
    for (const e of changed.values()) writeFileSync(e.file, JSON.stringify(e.data, null, 2) + '\n');
    if (livesChanged) {
      lives.sort((a, b) => b.date.localeCompare(a.date));
      writeFileSync(LIVES_FILE, JSON.stringify(lives, null, 2) + '\n');
    }
  }
  console.log(log.length ? log.join('\n') : '바뀐 것 없음');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    // 유튜브 쪽 문제로 실패해도 사이트 배포는 계속되게 한다
    console.error('유튜브 확인 실패:', err.message);
  });
}
