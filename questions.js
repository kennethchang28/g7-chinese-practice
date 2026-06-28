/* 題庫彙整（Node 端）。
   - 預設匯出：所有「單題」的扁平陣列（含會考情境單題）。
   - .groups：所有「會考閱讀題組」block。
   瀏覽器端不使用本檔，各 questions_*.js 會各自 push 至 window.QUESTION_BANK / window.QUESTION_GROUPS。 */
const huikao = require('./questions_huikao.js');

const singles = [].concat(
  require('./questions_L7.js'),
  require('./questions_L8.js'),
  require('./questions_L9.js'),
  require('./questions_L10.js'),
  require('./questions_yuwen.js'),
  require('./questions_annie.js'),
  require('./questions_mix.js'),
  huikao.singles
);

module.exports = singles;
module.exports.groups = huikao.groups;
