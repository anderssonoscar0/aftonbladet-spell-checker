var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var newArticleSchema = new Schema({
  _id: { type: String, unique: true },
  words: { type: Array },
  sentences: { type: Array },
  authorEmail: { type: String },
  date: { type: Date, default: Date.now },
  discordMessageId: { type: String },
  articleTitle: { type: String }
}, { runSettersOnQuery: true });

module.exports = mongoose.model('articles', newArticleSchema);
