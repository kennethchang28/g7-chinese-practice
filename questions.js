/* 題庫彙整（Node 端：合併各分課題庫並輸出單一陣列）。
   瀏覽器端不使用本檔，各 questions_*.js 會各自 push 至 window.QUESTION_BANK。 */
module.exports = [].concat(
  require('./questions_L7.js'),
  require('./questions_L8.js'),
  require('./questions_L9.js'),
  require('./questions_L10.js'),
  require('./questions_yuwen.js'),
  require('./questions_annie.js'),
  require('./questions_mix.js')
);
