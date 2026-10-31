// 유튜브 채널의 공개 영상을 보고 data/episodes/ 를 갱신한다. GitHub Actions에서 매시간 실행.
//
// - 이미 있는 편: 영상이 공개되면 publishDate를 채운다(비공개인 동안은 사이트에 안 보임).
//   설명란에 "0:00 장면 이름" 줄이 있고 장면 시간이 비어 있으면 시간을 채운다.
// - 새 편: 제목에 "세마넴 라이브 압축"이 들어간 공개 영상이 데이터에 없으면 새 파일을 만든다.
//
// 로그인이나 API 키 없이 공개 정보(채널 RSS, oEmbed)만 쓴다.
// 사용: node scripts/sync-youtube.mjs [--dry-run]

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const HANDLE = 'smn00000';
const EPISODE_DIR = 'data/episodes';
const MARK = '세마넴 라이브 압축';
const dryRun = process.argv.includes('--dry-run');

const MEMBER_NAMES = {
  hitomi: ['히토미', '토미'], shuie: ['슈이'], mei: ['메이'], kanny: ['카니'],
  soha: ['소하'], dohee: ['도희'], junhwi: ['준휘'], seungju: ['승주'],
};

const kstDate = (d) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(d);

async function get(url) {
  const res = await fetch(url, { headers: { 'accept-language': 'ko' } });
  return res;
}

async function channelId() {
  if (process.env.YT_CHANNEL_ID) return process.env.YT_CHANNEL_ID;
  const html = await (await get(`https://www.youtube.com/@${HANDLE}`)).text();
  const m = html.match(/"channelId":"(UC[\w-]{22})"/) || html.match(/channel\/(UC[\w-]{22})/);
  if (!m) throw new Error('채널 id를 찾지 못함');
  return m[1];
}

const decode = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&amp;/g, '&');

export function parseFeed(xml) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
    id: e.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/)?.[1],
    title: decode(e.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ''),
    published: e.match(/<published>([^<]+)<\/published>/)?.[1],
    description: decode(e.match(/<media:description>([\s\S]*?)<\/media:description>/)?.[1] ?? ''),
  })).filter((v) => v.id);
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

/** 공개(또는 일부 공개) 영상이면 true, 비공개·삭제면 false */
async function isWatchable(id) {
  const res = await get(`https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${id}`);
  return res.ok;
}

export function newEpisode(v) {
  const code = v.title.match(/\((\d{6})\)\s*$/)?.[1];
  if (!code) return null;
  const liveDate = `20${code.slice(0, 2)}-${code.slice(2, 4)}-${code.slice(4, 6)}`;
  const title = v.title.replace(new RegExp(`\\s*\\(${MARK}\\)\\s*\\(\\d{6}\\)\\s*$`), '').trim();
  const members = Object.entries(MEMBER_NAMES)
    .filter(([, names]) => names.some((n) => title.includes(n) && !(n === '토미' && title.includes('히토미'))))
    .map(([id]) => id);
  return {
    id: `${code}_${v.id}`,
    title,
    liveDate,
    publishDate: kstDate(new Date(v.published)),
    youtubeId: v.id,
    duration: null,
    members,
    anniversary: null,
    chapters: parseChapters(v.description) ?? [],
    shorts: [],
    weverseUrl: v.description.match(/https:\/\/weverse\.io\/saymyname\/live\/[\w-]+/)?.[0] ?? null,
    thumbnail: null,
  };
}

async function main() {
  const files = readdirSync(EPISODE_DIR).filter((f) => f.endsWith('.json'));
  const episodes = files.map((f) => ({ file: join(EPISODE_DIR, f), data: JSON.parse(readFileSync(join(EPISODE_DIR, f), 'utf8')) }));
  const byYoutube = new Map(episodes.map((e) => [e.data.youtubeId, e]));

  const feed = parseFeed(await (await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${await channelId()}`)).text());
  const feedById = new Map(feed.map((v) => [v.id, v]));
  const changes = [];
  const save = (e, why) => {
    changes.push(`${why}: ${e.data.title}`);
    if (!dryRun) writeFileSync(e.file, JSON.stringify(e.data, null, 2) + '\n');
  };

  for (const e of episodes) {
    if (e.data.sample) continue;
    const v = feedById.get(e.data.youtubeId);
    let changed = false;
    if (!e.data.publishDate) {
      // 채널 목록(최근 15개)에 있으면 그 공개일, 없으면 공개 여부만 확인하고 오늘 날짜
      if (v) { e.data.publishDate = kstDate(new Date(v.published)); changed = true; }
      else if (await isWatchable(e.data.youtubeId)) { e.data.publishDate = kstDate(new Date()); changed = true; }
    }
    const chapters = v && parseChapters(v.description);
    if (chapters && e.data.chapters.some((c) => c.time == null)) { e.data.chapters = chapters; changed = true; }
    if (changed) save(e, '갱신');
  }

  for (const v of feed) {
    if (byYoutube.has(v.id) || !v.title.includes(MARK)) continue;
    const data = newEpisode(v);
    if (!data) continue;
    save({ file: join(EPISODE_DIR, `${data.id}.json`), data }, '새 편');
  }

  console.log(changes.length ? changes.join('\n') : '바뀐 것 없음');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    // 유튜브 쪽 문제로 실패해도 사이트 배포는 계속되게 한다
    console.error('유튜브 확인 실패:', err.message);
  });
}
