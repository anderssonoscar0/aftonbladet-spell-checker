const Discord = require('discord.js');
const client = new Discord.Client();
let Parser = require('rss-parser');
let parser = new Parser();

const fetch = require('node-fetch');
const config = require('./config.js');

(async () => {
  let feed = await parser.parseURL('https://www.aftonbladet.se/nyheter/rss.xml');
  console.log(feed.title);
  feed.items.forEach(item => {
    const string = item.link;
    var articleId = string.substr(0, string.lastIndexOf('/')).substr(33);
    console.log(articleId);
  });
})();
