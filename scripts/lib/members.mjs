// 멤버 정보는 data/members.json 한 곳에서만 관리한다(진실의 원천).
// 스크립트는 이름 목록을 따로 들고 있지 말고 이 모듈을 쓴다.

import { readFileSync } from 'node:fs';

export const MEMBERS = JSON.parse(readFileSync(new URL('../../data/members.json', import.meta.url), 'utf8'));
export const MEMBER_IDS = MEMBERS.map((m) => m.id);

/** 멤버를 부르는 모든 이름: 한국어 이름, 영문·일본어 표기, 별명 */
export const namesOf = (m) => [m.name, m.englishName, m.japaneseName, ...(m.aliases ?? [])].filter(Boolean);

const norm = (s) => s.normalize('NFC').toLowerCase();

/** 이름 하나 → 멤버 id (대소문자 무시). 없으면 undefined */
export function memberIdByName(name) {
  const n = norm(name.trim());
  return MEMBERS.find((m) => namesOf(m).some((x) => norm(x) === n))?.id;
}

/** 글 속 해시태그(#메이 #SEUNGJOO #スンジュ …)로 멤버 찾기. 태그가 이름과 정확히 같을 때만 */
export function membersFromHashtags(text) {
  const tags = new Set([...text.matchAll(/#([^\s#]+)/g)].map((m) => norm(m[1])));
  return MEMBERS.filter((m) => namesOf(m).some((x) => tags.has(norm(x)))).map((m) => m.id);
}

/** 글 속에 이름이 나오는 멤버(한국어 이름·별명만). 제목으로 추정할 때만 쓴다 */
export function membersMentioned(text) {
  return MEMBERS.filter((m) => [m.name, ...(m.aliases ?? [])].some((x) => text.includes(x))).map((m) => m.id);
}
