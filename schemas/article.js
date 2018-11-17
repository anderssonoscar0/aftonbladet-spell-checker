var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var newArticleSchema = new Schema({
  _id: { type: String, unique: true },
  words: { type: Array },
  sentences: { type: Array },
  alerted: { type: Boolean, default: false },
  authorEmail: { type: String },
  date: { type: Date, default: Date.now }
}, { runSettersOnQuery: true });

module.exports = mongoose.model('articles', newArticleSchema);
