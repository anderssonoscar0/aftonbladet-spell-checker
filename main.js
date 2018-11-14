var HTMLParser = require('node-html-parser');
const Discord = require('discord.js');
const client = new Discord.Client();
let Parser = require('rss-parser');
let parser = new Parser();

const fetch = require('node-fetch');
const config = require('./config.js');

(async () => {
  let feed = await parser.parseURL('https://www.aftonbladet.se/nyheter/rss.xml');
  feed.items.forEach(item => {
    const string = item.link;
    var articleId = string.substr(0, string.lastIndexOf('/')).substr(33);
    console.log(articleId);
    fetch(config.aftonbladetBaseUrl + articleId)
      .then(res => res.text())
      .then(htmlbody => {
        var parsedBody = HTMLParser.parse(htmlbody);
        var authorName = parsedBody.querySelector('._3ij4i').rawText;
        console.log(authorName);
      });
  });
})();
