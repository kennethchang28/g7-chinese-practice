/* 單元與整合測試：驗證題庫品質與抽題引擎（含會考閱讀題組）的正確性。
   執行： node test_quiz.js
   檢查項目：
     1. 單題題庫結構（id 唯一、恰 4 互異選項、answer 合法、有題幹與詳解）
     2. 題組（會考閱讀題組）結構（選文 passage、各小題結構）
     3. 全題庫題目 id 全域唯一（單題＋題組小題）、無完全重複題目
     4. 題庫總題數 ≥ 200，且各課皆有題目
     5. 抽題：每份恰 20 題、題組整組保留、選文非空、id 不重複、皆來自題庫
     6. 防重複（核心需求）：連續兩份試卷「絕不」出現相同題目
     7. 防重複進階：題庫足夠時連續多份互不重複
     8. 批改計分：全對 / 全錯 / 部分對 皆正確
     9. 計時格式化 formatTime 正確
    10. 抽題決定性（相同亂數種子 → 相同結果）
*/
const QuizCore = require('./quiz-core.js');
const SINGLES = require('./questions.js');
const GROUPS = require('./questions.js').groups || [];
const BLOCKS = QuizCore.composeBlocks(SINGLES, GROUPS);

const PER_PAPER = 20;
let fail = 0, pass = 0;
function check(name, ok, extra) { if (ok) pass++; else { fail++; console.log('  ✗ ' + name + (extra ? '  →  ' + extra : '')); } }
function section(t) { console.log('\n== ' + t + ' =='); }

function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function idsOf(arr) { return arr.map(function (q) { return q.id; }); }
function intersect(a, b) { const s = new Set(a); return b.filter(function (x) { return s.has(x); }); }

// 全題庫題目（攤平）
const ALL_Q = SINGLES.concat(GROUPS.reduce(function (acc, g) { return acc.concat(g.questions || []); }, []));
const ALL_Q_IDS = new Set(idsOf(ALL_Q));

/* ---- 1. 單題結構 ---- */
section('1. 單題題庫結構');
const e1 = QuizCore.validateBank(SINGLES);
check('validateBank（單題）無錯誤', e1.length === 0, e1.slice(0, 8).join(' | '));

/* ---- 2. 題組結構 ---- */
section('2. 會考閱讀題組結構');
console.log('  題組數：' + GROUPS.length);
const e2 = QuizCore.validateGroups(GROUPS);
check('validateGroups 無錯誤', e2.length === 0, e2.slice(0, 8).join(' | '));

/* ---- 3. 全域 id 唯一 / 無重複題 ---- */
section('3. 全域 id 唯一與無重複題');
check('全題庫題目 id 全域唯一', ALL_Q_IDS.size === ALL_Q.length, ALL_Q.length + ' 題 / ' + ALL_Q_IDS.size + ' 個唯一 id');
const seenKey = new Set(); let dup = 0;
ALL_Q.forEach(function (q) { const k = q.stem + '||' + JSON.stringify(q.options); if (seenKey.has(k)) { dup++; console.log('    重複題：' + q.id); } else seenKey.add(k); });
check('無完全相同的題目', dup === 0, dup + ' 題重複');

/* ---- 4. 總題數與各課覆蓋 ---- */
section('4. 總題數與各課覆蓋');
console.log('  單題：' + SINGLES.length + '　題組小題：' + (ALL_Q.length - SINGLES.length) + '　合計：' + ALL_Q.length);
check('總題數 ≥ 200', ALL_Q.length >= 200, '實際 ' + ALL_Q.length);
const byLesson = {};
ALL_Q.forEach(function (q) { byLesson[q.lesson] = (byLesson[q.lesson] || 0) + 1; });
Object.keys(byLesson).forEach(function (L) { console.log('    - ' + L + '：' + byLesson[L] + ' 題'); });
['五柳先生傳', '摩登土產鳳梨酥', '謝天', '貓的天堂', '漢字與書法', '越南安妮', '綜合測驗'].forEach(function (L) {
  check('涵蓋課別「' + L + '」', (byLesson[L] || 0) > 0);
});

/* ---- 5. 抽題：恰 20 題、題組整組、選文非空 ---- */
section('5. 抽題基本性質（含題組）');
let okPaper = true, sawGroup = false;
for (let s = 0; s < 40 && okPaper; s++) {
  const paper = QuizCore.pickPaper(BLOCKS, PER_PAPER, [], makeRng(2000 + s));
  const ids = idsOf(paper.questions);
  if (paper.questions.length !== PER_PAPER) { okPaper = false; console.log('    題數=' + paper.questions.length + ' (seed ' + s + ')'); break; }
  if (new Set(ids).size !== PER_PAPER) { okPaper = false; console.log('    同份內題目重複 (seed ' + s + ')'); break; }
  if (!ids.every(function (id) { return ALL_Q_IDS.has(id); })) { okPaper = false; console.log('    出現題庫外的題 (seed ' + s + ')'); break; }
  // 題組整組保留 + 選文非空 + 攤平題數與 blocks 一致
  let flat = 0;
  for (const b of paper.blocks) {
    flat += b.questions.length;
    if (b.kind === 'group') {
      sawGroup = true;
      if (!b.passage || !b.passage.trim()) { okPaper = false; console.log('    題組選文為空 (seed ' + s + ')'); break; }
      if (b.questions.length < 1) { okPaper = false; console.log('    題組無題 (seed ' + s + ')'); break; }
    }
  }
  if (flat !== PER_PAPER) { okPaper = false; console.log('    blocks 攤平題數=' + flat + ' (seed ' + s + ')'); break; }
}
check('40 份抽樣：每份恰 20 題、題組整組保留、選文非空、皆來自題庫', okPaper);
check('抽樣中有出現閱讀題組（若題庫含題組）', GROUPS.length === 0 || sawGroup, '題組數=' + GROUPS.length);

/* ---- 6. 防重複：連續兩份「絕不」重複（核心需求，題目層級） ---- */
section('6. 防重複：連續兩份零重複（核心需求）');
let consecutiveOk = true, worst = 0;
for (let trial = 0; trial < 20 && consecutiveOk; trial++) {
  const rng = makeRng(8000 + trial);
  let exclude = [], prev = null;
  for (let round = 0; round < 60; round++) {
    const paper = QuizCore.pickPaper(BLOCKS, PER_PAPER, exclude, rng);
    const ids = idsOf(paper.questions);
    if (prev) {
      const ov = intersect(prev, ids).length;
      if (ov > worst) worst = ov;
      if (ov !== 0) { consecutiveOk = false; console.log('    trial=' + trial + ' round=' + round + ' 重複 ' + ov + ' 題'); break; }
    }
    exclude = QuizCore.nextPaperExclusion(exclude, paper.blocks, BLOCKS, PER_PAPER);
    prev = ids;
  }
}
check('連續 60 份、20 組亂數：相鄰兩份重複題數恆為 0', consecutiveOk, '最差重複 ' + worst);

/* ---- 7. 防重複進階：耗盡前各份互不重複 ---- */
section('7. 防重複進階：耗盡前各份互不重複');
const maxRounds = Math.floor(ALL_Q.length / PER_PAPER);
let distinctOk = true, producedRounds = 0;
{
  const rng = makeRng(123457);
  let exclude = [];
  const used = new Set();
  for (let round = 0; round < maxRounds; round++) {
    const paper = QuizCore.pickPaper(BLOCKS, PER_PAPER, exclude, rng);
    const ids = idsOf(paper.questions);
    const rep = ids.filter(function (id) { return used.has(id); });
    if (rep.length !== 0) { distinctOk = false; console.log('    round=' + round + ' 與先前重複 ' + rep.length + ' 題'); break; }
    ids.forEach(function (id) { used.add(id); });
    exclude = QuizCore.nextPaperExclusion(exclude, paper.blocks, BLOCKS, PER_PAPER);
    producedRounds++;
  }
  console.log('  連續產生 ' + producedRounds + ' 份完全互不重複的試卷（題庫 ' + ALL_Q.length + ' 題 / 每份 ' + PER_PAPER + '）');
}
check('耗盡前各份完全互不重複', distinctOk);

/* ---- 8. 批改計分 ---- */
section('8. 批改計分');
const sample = QuizCore.pickPaper(BLOCKS, PER_PAPER, [], makeRng(42)).questions;
const allCorrect = {}; sample.forEach(function (q) { allCorrect[q.id] = q.answer; });
const r1 = QuizCore.grade(sample, allCorrect);
check('全對 → 100 分、correct=20', r1.score === 100 && r1.correct === PER_PAPER);
const allWrong = {}; sample.forEach(function (q) { allWrong[q.id] = (q.answer + 1) % 4; });
const r2 = QuizCore.grade(sample, allWrong);
check('全錯 → 0 分、correct=0', r2.score === 0 && r2.correct === 0);
const partial = {}; sample.forEach(function (q, i) { partial[q.id] = (i < 13) ? q.answer : (q.answer + 1) % 4; });
const r3 = QuizCore.grade(sample, partial);
check('部分對（13/20）→ correct=13、score=65', r3.correct === 13 && r3.score === 65, 'correct=' + r3.correct + ' score=' + r3.score);
const sumByLesson = Object.keys(r3.byLesson).reduce(function (acc, L) { return acc + r3.byLesson[L].total; }, 0);
check('各課統計加總 = 總題數', sumByLesson === PER_PAPER, sumByLesson + ' vs ' + PER_PAPER);

/* ---- 9. 計時格式化 ---- */
section('9. 計時格式化 formatTime');
check("0 → '00:00'", QuizCore.formatTime(0) === '00:00');
check("65 → '01:05'", QuizCore.formatTime(65) === '01:05');
check("600 → '10:00'", QuizCore.formatTime(600) === '10:00');
check("3599 → '59:59'", QuizCore.formatTime(3599) === '59:59');
check('負數 → 00:00', QuizCore.formatTime(-5) === '00:00');

/* ---- 10. 抽題決定性 ---- */
section('10. 抽題決定性（相同種子 → 相同結果）');
const p1 = idsOf(QuizCore.pickPaper(BLOCKS, PER_PAPER, [], makeRng(555)).questions);
const p2 = idsOf(QuizCore.pickPaper(BLOCKS, PER_PAPER, [], makeRng(555)).questions);
check('相同亂數種子 → 抽出相同題序', JSON.stringify(p1) === JSON.stringify(p2));

console.log('\n========================================');
console.log('通過：' + pass + '　失敗：' + fail);
console.log('========================================');
process.exit(fail === 0 ? 0 : 1);
