// 빌드 전에 데이터가 data/members.json(진실의 원천)과 맞는지 확인한다. 어긋나면 빌드를 멈춘다.
//  - 데이터 곳곳의 멤버 id가 members.json에 있는지
//  - 이슈 양식의 멤버 체크박스가 members.json의 이름과 같은지
//  - 멤버 이름·표기가 서로 겹치지 않는지

import { readFileSync, readdirSync } from 'node:fs';
import { MEMBERS, MEMBER_IDS, namesOf } from './lib/members.mjs';

const errors = [];
const ids = new Set(MEMBER_IDS);
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const checkIds = (where, list) => {
  for (const id of list ?? []) if (!ids.has(id)) errors.push(`${where}: 모르는 멤버 id "${id}"`);
};

for (const f of readdirSync('data/episodes')) checkIds(`data/episodes/${f}`, read(`data/episodes/${f}`).members);
for (const l of read('data/lives.json')) checkIds(`data/lives.json ${l.id}`, l.members);
for (const p of read('data/photos.json')) checkIds(`data/photos.json ${p.url}`, p.members);
for (const a of read('data/member-activities.json')) checkIds(`data/member-activities.json ${a.id}`, [a.member]);

// 이슈 양식 체크박스(라벨 목록)가 멤버 이름 목록과 같아야 양식이 제대로 처리된다
const want = MEMBERS.map((m) => m.name).join(',');
for (const f of readdirSync('.github/ISSUE_TEMPLATE').filter((x) => x.endsWith('.yml') && x !== 'config.yml')) {
  const text = readFileSync(`.github/ISSUE_TEMPLATE/${f}`, 'utf8');
  for (const block of text.split(/\n  - type: /).filter((b) => b.startsWith('checkboxes'))) {
    const got = [...block.matchAll(/- label: (\S+)/g)].map((m) => m[1]).join(',');
    if (got !== want) errors.push(`.github/ISSUE_TEMPLATE/${f}: 멤버 체크박스가 members.json과 다름 (${got} ≠ ${want})`);
  }
}

const seen = new Map();
for (const m of MEMBERS) {
  for (const n of namesOf(m)) {
    const k = n.toLowerCase();
    if (seen.has(k) && seen.get(k) !== m.id) errors.push(`이름 "${n}"이 ${seen.get(k)}와 ${m.id}에 겹침`);
    seen.set(k, m.id);
  }
}

if (errors.length) {
  console.error('데이터 확인 실패:\n' + errors.map((e) => ' - ' + e).join('\n'));
  process.exit(1);
}
console.log(`데이터 확인 통과: 멤버 ${MEMBERS.length}명`);
