/* 抽題 / 批改 / 計時 引擎（瀏覽器與 Node 共用）
   - 全部為純函式，RNG 可注入，方便決定性測試。
   - 防重複：新的一份試卷不會與「最近出過的題目」重複（見 nextExclusion）。
   執行測試： node test_quiz.js
*/
(function (global) {
  'use strict';

  // ---- 題庫結構驗證：回傳錯誤訊息陣列（空陣列代表全數通過） ----
  function validateBank(bank) {
    const errors = [];
    if (!Array.isArray(bank)) { errors.push('題庫不是陣列'); return errors; }
    const seenId = new Set();
    bank.forEach(function (q, i) {
      const where = '題[' + i + '] (id=' + (q && q.id) + ')';
      if (!q || typeof q !== 'object') { errors.push(where + ' 不是物件'); return; }
      if (q.id == null || q.id === '') errors.push(where + ' 缺 id');
      else if (seenId.has(q.id)) errors.push(where + ' id 重複');
      else seenId.add(q.id);
      if (!q.lesson) errors.push(where + ' 缺 lesson 標籤');
      if (!q.stem || typeof q.stem !== 'string') errors.push(where + ' 缺題幹 stem');
      if (!Array.isArray(q.options)) { errors.push(where + ' options 非陣列'); }
      else {
        if (q.options.length !== 4) errors.push(where + ' 選項數=' + q.options.length + '（須恰為 4）');
        if (new Set(q.options).size !== q.options.length) errors.push(where + ' 選項內容重複');
        q.options.forEach(function (o, j) {
          if (typeof o !== 'string' || o.trim() === '') errors.push(where + ' 選項[' + j + '] 為空');
        });
      }
      if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3) errors.push(where + ' answer 索引非法=' + q.answer);
      if (!q.explanation || typeof q.explanation !== 'string') errors.push(where + ' 缺詳解 explanation');
    });
    return errors;
  }

  // ---- Fisher–Yates 洗牌（不破壞原陣列，rng 可注入） ----
  function shuffle(arr, rng) {
    rng = rng || Math.random;
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // ---- 分層抽題：盡量平均涵蓋各課（lesson），並排除最近出過的題目 ----
  // bank: 全題庫；count: 需要幾題；excludeIds: 要排除的 id 集合；rng: 亂數來源
  function pickQuestions(bank, count, excludeIds, rng) {
    rng = rng || Math.random;
    const exclude = new Set(excludeIds || []);
    let pool = bank.filter(function (q) { return !exclude.has(q.id); });
    // 若可用題目不足以湊滿一份，放寬限制：把被排除的題目洗牌後補進池底
    if (pool.length < count) {
      pool = pool.concat(shuffle(bank.filter(function (q) { return exclude.has(q.id); }), rng));
    }
    // 依 lesson 分組，各組內洗牌
    const byLesson = {};
    pool.forEach(function (q) { (byLesson[q.lesson] = byLesson[q.lesson] || []).push(q); });
    const order = shuffle(Object.keys(byLesson), rng);
    order.forEach(function (L) { byLesson[L] = shuffle(byLesson[L], rng); });
    // round-robin：各課輪流取一題，讓每份試卷盡量橫跨多課
    const picked = [];
    let idx = 0;
    while (picked.length < count) {
      if (order.every(function (L) { return byLesson[L].length === 0; })) break;
      const L = order[idx % order.length];
      if (byLesson[L].length) picked.push(byLesson[L].shift());
      idx++;
    }
    // 整體再打散一次，避免同課題目連續出現
    return shuffle(picked.slice(0, count), rng);
  }

  // ---- 計算「下一次要排除的 id」：保證連續兩份試卷不重複，同時盡量累積以提高變化度 ----
  // prevExclude: 這次抽題前所排除的 id；picked: 這次抽到的題目；bankSize: 題庫總數；count: 每份題數
  function nextExclusion(prevExclude, picked, bankSize, count) {
    const pickedIds = picked.map(function (q) { return q.id; });
    const merged = new Set(prevExclude || []);
    pickedIds.forEach(function (id) { merged.add(id); });
    // 若剩餘可用題目已不足以再湊一份「完全不重複」的試卷，重置為「只排除剛出的這一份」
    if (bankSize - merged.size < count) return pickedIds.slice();
    return Array.from(merged);
  }

  /* ===== 題組（會考閱讀題組）支援：block 模型 =====
     block = { id, kind:'single'|'group', lesson, passage, passageTitle, questions:[...] }
     單題 → 一個 size 1 的 single block；題組 → 一個含選文與多題的 group block。 */

  // ---- 題組結構驗證 ----
  function validateGroups(groups) {
    const errors = [];
    if (!Array.isArray(groups)) { errors.push('題組集不是陣列'); return errors; }
    const seenG = new Set();
    groups.forEach(function (g, i) {
      const where = '題組[' + i + '] (id=' + (g && g.id) + ')';
      if (!g || typeof g !== 'object') { errors.push(where + ' 不是物件'); return; }
      if (g.id == null || g.id === '') errors.push(where + ' 缺 id');
      else if (seenG.has(g.id)) errors.push(where + ' id 重複'); else seenG.add(g.id);
      if (!g.lesson) errors.push(where + ' 缺 lesson');
      if (!g.passage || typeof g.passage !== 'string' || !g.passage.trim()) errors.push(where + ' 缺選文 passage');
      if (!Array.isArray(g.questions) || g.questions.length < 1) errors.push(where + ' 題組無題目');
      else validateBank(g.questions).forEach(function (e) { errors.push(where + ' › ' + e); });
    });
    return errors;
  }

  // ---- 將單題與題組組成 block 清單 ----
  function composeBlocks(bank, groups) {
    const blocks = [];
    (bank || []).forEach(function (q) {
      blocks.push({ id: 'S:' + q.id, kind: 'single', lesson: q.lesson, passage: '', passageTitle: '', questions: [q] });
    });
    (groups || []).forEach(function (g) {
      blocks.push({ id: 'G:' + g.id, kind: 'group', lesson: g.lesson, passage: g.passage, passageTitle: g.passageTitle || '', questions: g.questions.slice() });
    });
    return blocks;
  }

  // ---- 依課分層，從 items 取出 k 個（round-robin 平均涵蓋各課） ----
  function stratifiedTake(items, k, rng) {
    if (k <= 0) return [];
    rng = rng || Math.random;
    const byLesson = {};
    items.forEach(function (b) { (byLesson[b.lesson] = byLesson[b.lesson] || []).push(b); });
    const lessons = shuffle(Object.keys(byLesson), rng);
    lessons.forEach(function (L) { byLesson[L] = shuffle(byLesson[L], rng); });
    const out = [];
    let idx = 0;
    while (out.length < k) {
      if (lessons.every(function (L) { return byLesson[L].length === 0; })) break;
      const L = lessons[idx % lessons.length];
      if (byLesson[L].length) out.push(byLesson[L].shift());
      idx++;
    }
    return out;
  }

  // ---- 抽一份試卷：混合題組與單題，總題數恰為 count，題組整組保留 ----
  // 顯示順序：單題在前、閱讀題組在後（貼近會考結構）。回傳 { blocks, questions }。
  function pickPaper(blocks, count, excludeIds, rng) {
    rng = rng || Math.random;
    const exclude = new Set(excludeIds || []);
    let avail = blocks.filter(function (b) { return !exclude.has(b.id); });
    const availQ = avail.reduce(function (s, b) { return s + b.questions.length; }, 0);
    if (availQ < count) {
      avail = avail.concat(shuffle(blocks.filter(function (b) { return exclude.has(b.id); }), rng));
    }
    const groups = shuffle(avail.filter(function (b) { return b.kind === 'group'; }), rng);
    const singles = avail.filter(function (b) { return b.kind === 'single'; });
    const singlesCount = singles.length;
    // 目標題組題數：約佔六成上限，但須保留足夠單題把總數補滿到 count
    const targetGroupQ = Math.min(count, Math.floor(count * 0.6));
    const pickedGroups = [];
    let gq = 0;
    for (let i = 0; i < groups.length; i++) {
      const sz = groups[i].questions.length;
      if (gq >= targetGroupQ) break;
      if (gq + sz > count) continue;                         // 不可超過總題數
      if ((count - (gq + sz)) > singlesCount) continue;      // 剩餘須能用單題補滿
      pickedGroups.push(groups[i]);
      gq += sz;
    }
    const needSingles = count - gq;
    const pickedSingles = stratifiedTake(shuffle(singles, rng), needSingles, rng);
    const orderedSingles = shuffle(pickedSingles, rng);
    const orderedGroups = shuffle(pickedGroups, rng);
    const paperBlocks = orderedSingles.concat(orderedGroups);
    const questions = [];
    paperBlocks.forEach(function (b) { b.questions.forEach(function (q) { questions.push(q); }); });
    return { blocks: paperBlocks, questions: questions };
  }

  // ---- 計算下一份要排除的 block id：保證連續兩份不重複，並盡量累積 ----
  function nextPaperExclusion(prevExclude, paperBlocks, allBlocks, count) {
    const pickedIds = paperBlocks.map(function (b) { return b.id; });
    const merged = new Set(prevExclude || []);
    pickedIds.forEach(function (id) { merged.add(id); });
    let remainingQ = 0;
    allBlocks.forEach(function (b) { if (!merged.has(b.id)) remainingQ += b.questions.length; });
    if (remainingQ < count) return pickedIds.slice(); // 重置為僅排除剛出的這一份
    return Array.from(merged);
  }

  // ---- 批改：questions 為本份題目，answers 為 { [id]: 所選索引 } ----
  function grade(questions, answers) {
    answers = answers || {};
    let correct = 0;
    const byLesson = {};
    const detail = questions.map(function (q) {
      const chosen = answers[q.id];
      const isCorrect = chosen === q.answer;
      if (isCorrect) correct++;
      const L = q.lesson;
      byLesson[L] = byLesson[L] || { total: 0, correct: 0 };
      byLesson[L].total++;
      if (isCorrect) byLesson[L].correct++;
      return { id: q.id, chosen: (chosen == null ? null : chosen), answer: q.answer, isCorrect: isCorrect };
    });
    const total = questions.length;
    return {
      total: total,
      correct: correct,
      wrong: total - correct,
      score: total ? Math.round((correct / total) * 100) : 0,
      byLesson: byLesson,
      detail: detail
    };
  }

  // ---- 計時格式化 mm:ss ----
  function formatTime(totalSeconds) {
    totalSeconds = Math.max(0, Math.floor(totalSeconds || 0));
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  const API = {
    validateBank: validateBank,
    validateGroups: validateGroups,
    shuffle: shuffle,
    pickQuestions: pickQuestions,
    nextExclusion: nextExclusion,
    composeBlocks: composeBlocks,
    pickPaper: pickPaper,
    nextPaperExclusion: nextPaperExclusion,
    grade: grade,
    formatTime: formatTime
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else global.QuizCore = API;
})(typeof window !== 'undefined' ? window : globalThis);
