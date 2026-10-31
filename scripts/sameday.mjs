// 공식 사진 게시물과 라이브 압축본의 화면을 비교해 "같은 날로 보이는" 짝을 찾는다.
// 결과: data/sameday.json (자동 생성). 주인이 확인·제외한 짝은 data/sameday-review.json.
//
// 판단 방법
// - 압축본: 유튜브가 영상 안에서 자동으로 잡은 장면 3장(채널 썸네일 아님).
// - 사진: 공식 X 게시물의 사진(퍼가기용 공개 정보에서 주소를 얻어 비교에만 쓰고 저장하지 않음).
// - 이미지 모델(DINOv2)로 의상·머리·장소가 얼마나 비슷한지 점수(0~1)를 내고,
//   사람을 찾아 얼굴 아래(옷) 부분의 색 분포도 비교한다. 얼굴만 닮고 옷이 다른 경우를 거르기 위해서다.
// - 같은 옷을 다른 날 입을 수 있으므로: 사진 게시일 기준 하루 전~7일 뒤 라이브만 후보로 보고,
//   멤버 태그가 둘 다 있는데 겹치지 않으면 제외하며, 비슷한 후보가 다른 날짜에도 있으면 "애매함"으로 표시한다.
// - 기준은 같은 영상의 다른 장면(같은 날 29쌍)과 2주 안의 다른 날 라이브(33쌍)로 정했다:
//   점수 0.72 이상 → 같은 날 23/29 잡음, 다른 날 잘못 0/33. 여기에 옷 색 0.9 이상을 함께 요구한다.
//   이 기준을 넘으면 사이트에 "같은 날로 보입니다"로 표시(high), 0.62 이상은 주인 확인용 후보(check)로만 남긴다.
//
// 사용: node scripts/sameday.mjs

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const HIGH = 0.72;
const MID = 0.62;
const OUTFIT = 0.9;
const WINDOW = { before: 1, after: 7 }; // 사진 게시일 - 라이브 날짜(일)
const CACHE = '.cache/sameday-features.json';
const MODEL = 'Xenova/dinov2-small';

const days = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

const episodes = readdirSync('data/episodes')
  .map((f) => JSON.parse(readFileSync(join('data/episodes', f), 'utf8')))
  .filter((e) => e.publishDate && !e.sample);
const photos = JSON.parse(readFileSync('data/photos.json', 'utf8'));

// 사진 게시일 기준으로 비교할 라이브가 하나라도 있는 게시물만 다룬다
const candidatesOf = (p) => episodes.filter((e) => {
  const d = days(p.date, e.liveDate);
  if (d < -WINDOW.before || d > WINDOW.after) return false;
  return !(p.members.length && e.members.length && !p.members.some((m) => e.members.includes(m)));
});
const work = photos.filter((p) => p.platform === 'x' && candidatesOf(p).length);

async function photoUrls(url) {
  const id = url.match(/status\/(\d+)/)?.[1];
  const res = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=a`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.mediaDetails ?? []).filter((m) => m.type === 'photo').map((m) => `${m.media_url_https}?name=small`);
}

async function main() {
  const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
  let extract = null;
  const { RawImage, pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = '.cache/models';

  let detect = null;
  const unit = (v) => { const n = Math.hypot(...v) || 1; return v.map((x) => Number((x / n).toFixed(5))); };
  // 옷 색 분포: RGB를 4단계씩 나눈 64칸
  const colors = (img) => {
    const h = new Array(64).fill(0);
    for (let i = 0; i < img.data.length; i += img.channels) h[(img.data[i] >> 6) * 16 + (img.data[i + 1] >> 6) * 4 + (img.data[i + 2] >> 6)]++;
    return unit(h);
  };

  /** 이미지 하나의 특징: 전체 모습(look)과 사람마다 옷 부분 색(outfits) */
  async function embed(url, crop) {
    if (cache[url]) return cache[url];
    extract ??= await pipeline('image-feature-extraction', MODEL, { dtype: 'fp32' });
    detect ??= await pipeline('object-detection', 'Xenova/yolos-tiny', { dtype: 'q8' });
    let img = await RawImage.fromURL(url);
    if (crop) img = await img.crop(crop);
    const t = await extract(img);
    const look = unit(Array.from(t.data).slice(0, t.dims.at(-1))); // CLS 토큰
    const outfits = [];
    for (const { box, label } of await detect(img, { threshold: 0.6 })) {
      if (label !== 'person') continue;
      const w = box.xmax - box.xmin, h = box.ymax - box.ymin;
      if (w * h < img.width * img.height * 0.04) continue; // 배경 속 작은 사람 제외
      const part = await img.crop([
        Math.max(0, Math.round(box.xmin)), Math.round(box.ymin + h * 0.3),
        Math.min(img.width - 1, Math.round(box.xmax)), Math.min(img.height - 1, Math.round(box.ymin + h * 0.95)),
      ]);
      if (part.width >= 20 && part.height >= 20) outfits.push(colors(part));
    }
    return (cache[url] = { look, outfits });
  }

  /** 두 이미지 비교: [전체 점수, 옷 색 점수] */
  const compare = (a, b) => [
    dot(a.look, b.look),
    a.outfits.length && b.outfits.length ? Math.max(...a.outfits.flatMap((x) => b.outfits.map((y) => dot(x, y)))) : 0,
  ];

  // 유튜브 자동 장면 hq1~3.jpg는 480x360에 위아래 검은 띠가 있다
  const frames = new Map();
  const needed = new Set(work.flatMap(candidatesOf).map((e) => e.id));
  for (const e of episodes.filter((x) => needed.has(x.id))) {
    const list = [];
    for (const k of [1, 2, 3]) {
      try { list.push(await embed(`https://i.ytimg.com/vi/${e.youtubeId}/hq${k}.jpg`, [0, 45, 479, 314])); } catch { /* 장면이 없는 영상 */ }
    }
    frames.set(e.id, list);
  }

  const results = [];
  for (const p of work) {
    const imgs = [];
    for (const u of await photoUrls(p.url).catch(() => [])) {
      try { imgs.push(await embed(u)); } catch { /* 지워진 사진 */ }
    }
    if (!imgs.length) continue;
    const scored = candidatesOf(p).map((e) => {
      // 사진·장면 짝 중 전체 점수가 가장 높은 짝을 그 라이브의 점수로
      const best = imgs.flatMap((a) => (frames.get(e.id) ?? []).map((b) => compare(a, b))).sort((x, y) => y[0] - x[0])[0] ?? [-1, 0];
      return { episode: e.id, liveDate: e.liveDate, score: best[0], outfit: best[1] };
    }).filter((c) => c.score >= MID).sort((a, b) => b.score - a.score);
    const strong = scored.filter((c) => c.score >= HIGH && c.outfit >= OUTFIT);
    // 같은 옷이 서로 다른 날짜에 모두 나오면 날짜를 정하지 않고 애매함으로 둔다
    const ambiguous = new Set(strong.map((c) => c.liveDate)).size > 1;
    for (const c of scored) {
      results.push({
        photo: p.url,
        episode: c.episode,
        score: Number(c.score.toFixed(3)),
        outfit: Number(c.outfit.toFixed(3)),
        level: c.score >= HIGH && c.outfit >= OUTFIT ? 'high' : 'check',
        ambiguous,
      });
    }
  }

  mkdirSync('.cache', { recursive: true });
  writeFileSync(CACHE, JSON.stringify(cache));
  results.sort((a, b) => b.score - a.score);
  writeFileSync('data/sameday.json', JSON.stringify(results, null, 2) + '\n');
  console.log(`사진 ${work.length}개 비교, 같은 날 후보 ${results.length}개`);
}

main().catch((err) => {
  // 실패해도 사이트 배포는 계속된다(이전 결과 유지)
  console.error('같은 날 추정 실패:', err.message);
});
