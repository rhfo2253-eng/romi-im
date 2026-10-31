// GitHub 이슈 양식(라이브 기록 추가, 사진 추가, 압축본 멤버 고치기)으로 받은 내용을 data/에 넣는다.
// .github/workflows/add-from-issue.yml에서 실행. 결과 문장은 result.md에 써서 이슈 댓글로 남긴다.
//
// 환경 변수: ISSUE_BODY(이슈 본문), ISSUE_LABEL(add-live, add-photo, fix-members), ISSUE_DATE(이슈 만든 날, ISO)

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const NAMES = { 히토미: 'hitomi', 슈이: 'shuie', 메이: 'mei', 카니: 'kanny', 소하: 'soha', 도희: 'dohee', 준휘: 'junhwi', 승주: 'seungju' };
const HASHTAGS = {
  hitomi: ['#히토미', '#hitomi'], shuie: ['#슈이', '#shuie'], mei: ['#메이', '#mei'], kanny: ['#카니', '#kanny'],
  soha: ['#소하', '#soha'], dohee: ['#도희', '#dohee'], junhwi: ['#준휘', '#junhwi'], seungju: ['#승주', '#seungjoo'],
};
const OFFICIAL_X = ['sa2m2nam3', 'sa2m2nam3_jp'];

const kst = (d) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(d);

/** 이슈 양식 본문("### 제목\n\n값")을 {제목: 값}으로 */
function parseForm(body) {
  const out = {};
  for (const part of body.split(/^### /m).slice(1)) {
    const [head, ...rest] = part.split('\n');
    const value = rest.join('\n').trim();
    out[head.trim()] = value === '_No response_' ? '' : value;
  }
  return out;
}
const checked = (text) => [...(text ?? '').matchAll(/- \[[xX]\] (\S+)/g)].map((m) => NAMES[m[1]]).filter(Boolean);
const toSeconds = (t) => (/^\d+(:\d{2}){1,2}$/.test(t ?? '') ? t.split(':').reduce((a, n) => a * 60 + Number(n), 0) : null);

const result = [];
const body = process.env.ISSUE_BODY ?? '';
const form = parseForm(body);

if (process.env.ISSUE_LABEL === 'add-live') {
  const date = form['날짜'];
  const title = form['라이브 제목'];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !title) {
    result.push('날짜(예: 2026-10-30)와 라이브 제목을 확인해 주세요. 아무것도 추가하지 않았습니다.');
  } else {
    const lives = JSON.parse(readFileSync('data/lives.json', 'utf8'));
    const weverseUrl = (form['위버스 주소 (선택)'] ?? '').match(/https:\/\/weverse\.io\/\S+/)?.[0] ?? null;
    if (weverseUrl && lives.some((l) => l.weverseUrl === weverseUrl)) {
      result.push('이미 라이브 기록에 있는 위버스 주소입니다. 추가하지 않았습니다.');
    } else {
      lives.push({
        id: `${date.replace(/-/g, '').slice(2)}-${Date.now().toString(36)}`,
        date,
        title,
        members: checked(form['나온 멤버']),
        duration: toSeconds(form['길이 (선택)']),
        weverseUrl,
        episodes: [],
      });
      lives.sort((a, b) => b.date.localeCompare(a.date));
      writeFileSync('data/lives.json', JSON.stringify(lives, null, 2) + '\n');
      result.push(`라이브 기록에 추가했습니다: ${date} ${title}`);
    }
  }
}

if (process.env.ISSUE_LABEL === 'add-photo') {
  const photos = JSON.parse(readFileSync('data/photos.json', 'utf8'));
  const have = new Set(photos.map((p) => p.url));
  const formMembers = checked(form['나온 멤버 (인스타그램·위버스용, X는 자동)']);
  const urls = [...(form['게시물 주소 (한 줄에 하나)'] ?? '').matchAll(/https?:\/\/\S+/g)].map((m) => m[0].replace(/[?#].*$/, ''));
  for (let url of urls) {
    url = url.replace('://twitter.com/', '://x.com/').replace('://mobile.twitter.com/', '://x.com/');
    const x = url.match(/x\.com\/([^/]+)\/status\/(\d+)/);
    if (x) {
      if (!OFFICIAL_X.includes(x[1].toLowerCase())) { result.push(`공식 계정이 아니라서 넣지 않았습니다: ${url}`); continue; }
      url = `https://x.com/${x[1]}/status/${x[2]}`;
      if (have.has(url)) { result.push(`이미 있습니다: ${url}`); continue; }
      // X 공식 퍼가기 정보로 게시물이 있는지, 사진이 있는지 확인한다
      const res = await fetch(`https://publish.twitter.com/oembed?omit_script=1&url=${encodeURIComponent(url)}`);
      if (!res.ok) { result.push(`게시물을 찾지 못했습니다(지워졌거나 비공개): ${url}`); continue; }
      const html = (await res.json()).html ?? '';
      const text = html.replace(/<[^>]+>/g, ' ').split('&mdash;')[0].toLowerCase();
      const members = Object.entries(HASHTAGS).filter(([, tags]) => tags.some((t) => text.includes(t))).map(([id]) => id);
      // 게시물 번호에 올린 시각이 들어 있다
      const date = kst(new Date(Number((BigInt(x[2]) >> 22n) + 1288834974657n)));
      photos.push({ url, platform: 'x', date, members: members.length ? members : formMembers });
      have.add(url);
      result.push(`추가했습니다: ${date} ${url}${html.includes('pic.twitter.com') ? '' : ' (사진이 없는 글일 수 있습니다)'}`);
    } else if (/instagram\.com\/(p|reel)\//.test(url) || /weverse\.io\/saymyname\//.test(url)) {
      if (have.has(url)) { result.push(`이미 있습니다: ${url}`); continue; }
      const platform = url.includes('instagram.com') ? 'instagram' : 'weverse';
      photos.push({ url, platform, date: kst(new Date(process.env.ISSUE_DATE ?? Date.now())), members: formMembers });
      have.add(url);
      result.push(`추가했습니다(날짜는 오늘로 넣었습니다): ${url}`);
    } else {
      result.push(`지원하지 않는 주소입니다: ${url}`);
    }
  }
  if (!urls.length) result.push('게시물 주소를 찾지 못했습니다.');
  photos.sort((a, b) => b.date.localeCompare(a.date));
  writeFileSync('data/photos.json', JSON.stringify(photos, null, 2) + '\n');
}

if (process.env.ISSUE_LABEL === 'fix-members') {
  const input = form['압축본 주소'] ?? '';
  const members = checked(form['나온 멤버 (전부 체크)']);
  const youtubeId = input.match(/(?:youtu\.be\/|watch\?v=|shorts\/)([\w-]{11})/)?.[1];
  const siteId = (() => { const m = input.match(/\/episodes\/([^/?#\s]+)/); return m ? decodeURIComponent(m[1]) : null; })();
  const dir = 'data/episodes';
  const file = readdirSync(dir).find((f) => {
    const d = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
    return (siteId && d.id === siteId) || (youtubeId && (d.youtubeId === youtubeId || d.shorts.some((s) => s.youtubeId === youtubeId)));
  });
  if (!file) result.push('해당 압축본을 찾지 못했습니다. 주소를 확인해 주세요.');
  else if (!members.length) result.push('멤버를 하나 이상 체크해 주세요.');
  else {
    const d = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8'));
    d.members = members;
    d.membersFrom = 'manual';
    writeFileSync(`${dir}/${file}`, JSON.stringify(d, null, 2) + '\n');
    // 라이브 기록에도 같은 멤버를 반영
    const lives = JSON.parse(readFileSync('data/lives.json', 'utf8'));
    for (const l of lives) if (l.episodes.includes(d.id)) l.members = members;
    writeFileSync('data/lives.json', JSON.stringify(lives, null, 2) + '\n');
    result.push(`멤버를 고쳤습니다: ${d.title} → ${form['나온 멤버 (전부 체크)'].match(/- \[[xX]\] \S+/g).map((x) => x.slice(6)).join(', ')}`);
  }
}

writeFileSync('result.md', result.join('\n') + '\n\n사이트에는 1~3분 뒤 반영됩니다. 틀린 내용은 data/ 파일에서 고치거나 지우면 됩니다.\n');
console.log(result.join('\n'));
