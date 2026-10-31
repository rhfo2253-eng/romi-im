// 세이마이네임 공식 유튜브 채널(@sa2m2nam3)의 최신 영상 목록을 data/official-videos.json에 맞춘다.
// GitHub Actions에서 매시간 실행. 로그인 없이 누구나 볼 수 있는 채널 페이지만 쓴다.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { listTab, videoInfo, titles, lengths } from './sync-youtube.mjs';

const FILE = 'data/official-videos.json';
const KEEP = 24;

async function main() {
  const old = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : [];
  const byId = new Map(old.map((v) => [v.youtubeId, v]));
  const ids = (await listTab('videos', 'sa2m2nam3', 1)).slice(0, KEEP);
  if (!ids.length) throw new Error('공식 채널 목록이 비어 있음');
  const list = [];
  for (const id of ids) {
    const known = byId.get(id);
    if (known) { list.push({ ...known, title: titles.get(id) ?? known.title }); continue; }
    const info = await videoInfo(id);
    list.push({ youtubeId: id, title: titles.get(id) ?? info.title, publishDate: info.publishDate, duration: lengths.get(id) ?? null });
  }
  const added = list.filter((v) => !byId.has(v.youtubeId)).length;
  writeFileSync(FILE, JSON.stringify(list, null, 2) + '\n');
  console.log(`공식 영상 ${list.length}개 (새로 ${added}개)`);
}

main().catch((err) => console.error('공식 채널 확인 실패:', err.message));
