var HTMLParser = require('node-html-parser');
const Discord = require('discord.js');
const client = new Discord.Client();
let Parser = require('rss-parser');
let parser = new Parser();
var SpellChecker = require('simple-spellchecker');
var myDictionary = null;

// Load dictionary.
SpellChecker.getDictionary('sv-SE', './node_modules/simple-spellchecker/dict', function (err, result) {
  if (!err) {
    myDictionary = result;
  }
});

const fetch = require('node-fetch');
const config = require('./config.js');

// Discord startup
client.on('ready', () => {
  console.log('Startup Sucess!');
  readRRS();
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
      let articleId = string.substr(0, string.lastIndexOf('/')).substr(33);
      fetch(config.aftonbladetBaseUrl + articleId)
        .then(res => res.text())
        .then(htmlbody => {
          let parsedBody = HTMLParser.parse(htmlbody);
          const authorName = parsedBody.querySelector('._3ij4i').rawText.toLowerCase().replace(' ', '.');
          const authorEmail = authorName === 'tt' ? 'webbnyheter@aftonbladet.se' : authorName + '@aftonbladet.se'; // If authorName 'TT' -> newsroom is the author
          let articleBody = parsedBody.querySelector('._3p4DP._1lEgk').rawText.replace(/\./g, ' ');
          checkSpelling(articleBody, authorEmail, articleId);
        });
    });
  })();
}

function checkSpelling (html, authorEmail, articleId) {
  console.log('Running check on article ' + articleId);
  let wordArray = html.split(' ');
  console.log('------------------------------------');
  for (var i = 0; i < wordArray.length; i++) {
    const cleanedWord = cleanWord(wordArray[i]);
    var test = myDictionary.spellCheck(cleanedWord);
    if (wordArray[i] === 'LÄS') {
      console.log('BREAKING');
      break;
    } else if (/[A-Z]/.test(wordArray[i][0]) === true && test === false) {
      // console.log('"' + wordArray[i] + '" is proably a name. SKIPPING');
      i++;
    } else {
      if (test === false) {
        console.log(test + ' - ' + cleanedWord);
      }
    }
  }
  console.log('Check for article ' + articleId + ' has been completed.');
}

function cleanWord (word) {
  let cleanedWord = word;
  const invalidChars = /[ !•”–@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?1234567890]/;
  if (invalidChars.test(cleanedWord) || cleanedWord === '') {
    // console.log(cleanedWord + ' - Contains invalid character. SKIPPING');
    return 'Ebba';
  } else {
    return cleanedWord;
  }
}

function alertError (t) {
  console.log('alerting');
  client.channels.get(config.discordChannelId).send('ALERT ALERT');
}
