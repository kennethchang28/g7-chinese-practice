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
    shuffle: shuffle,
    pickQuestions: pickQuestions,
    nextExclusion: nextExclusion,
    grade: grade,
    formatTime: formatTime
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else global.QuizCore = API;
})(typeof window !== 'undefined' ? window : globalThis);
