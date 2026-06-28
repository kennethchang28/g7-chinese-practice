/* 單元與整合測試：驗證題庫品質與抽題引擎的正確性。
   執行： node test_quiz.js
   檢查項目：
     1. 題庫結構（id 唯一、恰 4 選項且不重複、answer 索引合法、有題幹與詳解）
     2. 題庫總數 ≥ 200，且每一課皆有題目
     3. 無重複題目（stem + options 完全相同）
     4. 抽題：每份恰 20 題、id 不重複、皆來自題庫
     5. 防重複：連續兩份試卷「絕不」出現相同題目（核心需求）
     6. 防重複進階：在題庫足夠時，連續多份盡量互不重複
     7. 批改計分：全對 / 全錯 / 部分對 皆正確
     8. 計時格式化 formatTime 正確
     9. 抽題具決定性（相同亂數種子 → 相同結果）
*/
const QuizCore = require('./quiz-core.js');
const BANK = require('./questions.js');

const PER_PAPER = 20;
let fail = 0, pass = 0;
function check(name, ok, extra) {
  if (ok) { pass++; }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  →  ' + extra : '')); }
}
function section(t) { console.log('\n== ' + t + ' =='); }

/* 可重現的偽亂數產生器（mulberry32），讓測試結果具決定性 */
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

/* ---- 1. 題庫結構驗證 ---- */
section('1. 題庫結構驗證');
const errors = QuizCore.validateBank(BANK);
check('validateBank 無錯誤', errors.length === 0, errors.slice(0, 8).join(' | '));

/* ---- 2. 題庫總數與各課覆蓋 ---- */
section('2. 題庫總數與各課覆蓋');
console.log('  題庫總題數：' + BANK.length);
check('題庫總數 ≥ 200', BANK.length >= 200, '實際 ' + BANK.length);
const byLesson = {};
BANK.forEach(function (q) { byLesson[q.lesson] = (byLesson[q.lesson] || 0) + 1; });
Object.keys(byLesson).forEach(function (L) { console.log('    - ' + L + '：' + byLesson[L] + ' 題'); });
const expectLessons = ['五柳先生傳', '摩登土產鳳梨酥', '謝天', '貓的天堂', '漢字與書法', '越南安妮', '綜合測驗'];
expectLessons.forEach(function (L) { check('涵蓋課別「' + L + '」', (byLesson[L] || 0) > 0); });

/* ---- 3. 無重複題目（stem + options） ---- */
section('3. 無重複題目');
const seenKey = new Set(); let dup = 0;
BANK.forEach(function (q) {
  const key = q.stem + '||' + JSON.stringify(q.options);
  if (seenKey.has(key)) { dup++; console.log('    重複題：' + q.id); } else seenKey.add(key);
});
check('無完全相同的題目', dup === 0, dup + ' 題重複');

/* ---- 4. 抽題基本性質 ---- */
section('4. 抽題基本性質');
const bankIds = new Set(idsOf(BANK));
let allPaperOk = true;
for (let s = 0; s < 30; s++) {
  const rng = makeRng(1000 + s);
  const paper = QuizCore.pickQuestions(BANK, PER_PAPER, [], rng);
  const ids = idsOf(paper);
  if (paper.length !== PER_PAPER) { allPaperOk = false; console.log('    份數錯誤 seed=' + s + ' 得 ' + paper.length); break; }
  if (new Set(ids).size !== PER_PAPER) { allPaperOk = false; console.log('    同份內有重複 seed=' + s); break; }
  if (!ids.every(function (id) { return bankIds.has(id); })) { allPaperOk = false; console.log('    出現題庫外的題 seed=' + s); break; }
}
check('30 份抽樣：每份恰 20 題、不重複、皆來自題庫', allPaperOk);

/* ---- 5. 防重複（核心需求）：連續兩份「絕不」重複 ---- */
section('5. 防重複：連續兩份絕不重複（核心需求）');
let consecutiveOk = true, worstOverlap = 0;
for (let trial = 0; trial < 20 && consecutiveOk; trial++) {
  const rng = makeRng(7000 + trial);
  let exclude = [];
  let prev = null;
  for (let round = 0; round < 60; round++) {
    const paper = QuizCore.pickQuestions(BANK, PER_PAPER, exclude, rng);
    const ids = idsOf(paper);
    if (prev) {
      const overlap = intersect(prev, ids).length;
      if (overlap > worstOverlap) worstOverlap = overlap;
      if (overlap !== 0) {
        consecutiveOk = false;
        console.log('    trial=' + trial + ' round=' + round + ' 與上一份重複 ' + overlap + ' 題');
        break;
      }
    }
    exclude = QuizCore.nextExclusion(exclude, paper, BANK.length, PER_PAPER);
    prev = ids;
  }
}
check('連續 60 份、20 組亂數：相鄰兩份重複題數恆為 0', consecutiveOk, '最差重複 ' + worstOverlap);

/* ---- 6. 防重複進階：題庫足夠時，前若干份互不重複 ---- */
section('6. 防重複進階：耗盡前各份互不重複');
const maxDistinctRounds = Math.floor(BANK.length / PER_PAPER); // 理論上可連續產生這麼多份完全不重複
let distinctOk = true;
{
  const rng = makeRng(31337);
  let exclude = [];
  const usedAll = new Set();
  for (let round = 0; round < maxDistinctRounds; round++) {
    const paper = QuizCore.pickQuestions(BANK, PER_PAPER, exclude, rng);
    const ids = idsOf(paper);
    const repeat = ids.filter(function (id) { return usedAll.has(id); });
    if (repeat.length !== 0) { distinctOk = false; console.log('    round=' + round + ' 與先前各份重複 ' + repeat.length + ' 題'); break; }
    ids.forEach(function (id) { usedAll.add(id); });
    exclude = QuizCore.nextExclusion(exclude, paper, BANK.length, PER_PAPER);
  }
  console.log('  連續產生 ' + maxDistinctRounds + ' 份完全互不重複的試卷（題庫 ' + BANK.length + ' 題 / 每份 ' + PER_PAPER + ' 題）');
}
check('耗盡前各份完全互不重複', distinctOk);

/* ---- 7. 批改計分 ---- */
section('7. 批改計分');
const sample = QuizCore.pickQuestions(BANK, PER_PAPER, [], makeRng(42));
const allCorrect = {}; sample.forEach(function (q) { allCorrect[q.id] = q.answer; });
const r1 = QuizCore.grade(sample, allCorrect);
check('全對 → 分數 100、correct=20', r1.score === 100 && r1.correct === PER_PAPER);

const allWrong = {}; sample.forEach(function (q) { allWrong[q.id] = (q.answer + 1) % 4; });
const r2 = QuizCore.grade(sample, allWrong);
check('全錯 → 分數 0、correct=0', r2.score === 0 && r2.correct === 0);

const partial = {}; sample.forEach(function (q, i) { partial[q.id] = (i < 13) ? q.answer : (q.answer + 1) % 4; });
const r3 = QuizCore.grade(sample, partial);
check('部分對（13/20）→ correct=13、score=65', r3.correct === 13 && r3.score === 65, 'correct=' + r3.correct + ' score=' + r3.score);

const r4 = QuizCore.grade(sample, {}); // 完全未作答
check('未作答 → correct=0、wrong=20', r4.correct === 0 && r4.wrong === PER_PAPER);

// 各課統計加總應等於總題數
const sumByLesson = Object.keys(r3.byLesson).reduce(function (acc, L) { return acc + r3.byLesson[L].total; }, 0);
check('各課統計加總 = 總題數', sumByLesson === PER_PAPER, sumByLesson + ' vs ' + PER_PAPER);

/* ---- 8. 計時格式化 ---- */
section('8. 計時格式化 formatTime');
check("0 秒 → '00:00'", QuizCore.formatTime(0) === '00:00', QuizCore.formatTime(0));
check("65 秒 → '01:05'", QuizCore.formatTime(65) === '01:05', QuizCore.formatTime(65));
check("600 秒 → '10:00'", QuizCore.formatTime(600) === '10:00', QuizCore.formatTime(600));
check("3599 秒 → '59:59'", QuizCore.formatTime(3599) === '59:59', QuizCore.formatTime(3599));
check('負數 → 00:00（防呆）', QuizCore.formatTime(-5) === '00:00', QuizCore.formatTime(-5));

/* ---- 9. 抽題決定性 ---- */
section('9. 抽題決定性（相同種子 → 相同結果）');
const p1 = idsOf(QuizCore.pickQuestions(BANK, PER_PAPER, [], makeRng(555)));
const p2 = idsOf(QuizCore.pickQuestions(BANK, PER_PAPER, [], makeRng(555)));
check('相同亂數種子 → 抽出相同題序', JSON.stringify(p1) === JSON.stringify(p2));

/* ---- 總結 ---- */
console.log('\n========================================');
console.log('通過：' + pass + '　失敗：' + fail);
console.log('========================================');
process.exit(fail === 0 ? 0 : 1);
