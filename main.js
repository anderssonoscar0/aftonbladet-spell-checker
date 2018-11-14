var HTMLParser = require('node-html-parser');
const Discord = require('discord.js');
const client = new Discord.Client();
let Parser = require('rss-parser');
let parser = new Parser();

const fetch = require('node-fetch');
const config = require('./config.js');

// Discord startup
client.on('ready', () => {
  console.log('Startup Sucess!');
});
client.login(config.discordToken);

// Discord listen
client.on('message', message => {
  if (!message.content.startsWith(config.discordPrefix)) return;
  if (!message.channel.id === config.discordChannelId) return;
  const args = message.content.slice(config.discordPrefix.length).trim().split(/ +/g);
  const command = args.shift().toLowerCase();
  console.log(args);
  console.log(command);

  if (command === 'accept') {
    message.channel.send('Accepting!');
  }

  if (command === 'deny') {
    message.channel.send('Denying!');
  }
});

function readRRS () {
  (async () => {
    let feed = await parser.parseURL('https://www.aftonbladet.se/nyheter/rss.xml');
    feed.items.forEach(item => {
      const string = item.link;
      var articleId = string.substr(0, string.lastIndexOf('/')).substr(33);
      fetch(config.aftonbladetBaseUrl + articleId)
        .then(res => res.text())
        .then(htmlbody => {
          var parsedBody = HTMLParser.parse(htmlbody);
          var authorName = parsedBody.querySelector('._3ij4i').rawText.toLowerCase().replace(' ', '.');
          var authorEmail = authorName === 'tt' ? 'webbnyheter@aftonbladet.se' : authorName + '@aftonbladet.se'; // If authorName 'TT' -> newsroom is the author
          console.log(authorName + ' : ' + authorEmail);
        });
    });
  })();
}

function checkSpelling (html) {
  console.log('running check');
}

function alertError (t) {
  console.log('alerting');
  client.channels.get(config.discordChannelId).send('ALERT ALERT');
}
