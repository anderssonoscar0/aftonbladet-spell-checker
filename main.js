var HTMLParser = require('node-html-parser');
const Discord = require('discord.js');
const client = new Discord.Client();
let Parser = require('rss-parser');
let parser = new Parser();
const fs = require('fs');
var SpellChecker = require('simple-spellchecker');
var myDictionary = null;

// Load dictionary.
SpellChecker.getDictionary('sv-SE', './dict', function (err, result) {
  if (!err) {
    myDictionary = result;
  } else {
    console.log(err);
  }
});

const fetch = require('node-fetch');
const config = require('./config.js');

// Discord startup
client.on('ready', () => {
  console.log('Startup Sucess!');
  // readRRS();
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

  if (command === 'add') {
    addWordToDictionary(args[0]);
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
    
    if (cleanedWord === undefined) {
      // Word got 'removed' at cleaning. SKIPPING
    } else {
      var isSpellingCorrect = myDictionary.spellCheck(cleanedWord);
      if (isSpellingCorrect === false) {
        console.log(isSpellingCorrect + ' - ' + cleanedWord);
        const wordInSentence = wordArray[i - 3] + ' ' + wordArray[i - 2] + ' ' + wordArray[i - 1] + ' ' +
          wordArray[i].toUpperCase() + ' ' + wordArray[i + 1] + ' ' + wordArray[i + 2] + ' ' + wordArray[i + 3];
        // alertError(cleanedWord, wordInSentence);
      }
    }
  }
  console.log('Check for article ' + articleId + ' has been completed.');
}

function cleanWord (word) {
  const invalidChars = /[ A-ZÅÄÖ!•►”–@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?1234567890]/;
  if (invalidChars.test(word) || word === '') {
    return undefined; // The word contains invalid characters, returning undefined and skipping it later.
  } else {
    return word;
  }
}

function alertError (word, sentence) {
  console.log('alerting');
  const embed = {
    'color': 11738382,
    'title': 'Aftonbladet-Spell-Checker',
    'fields': [
      {
        'name': 'Misspelled word',
        'value': word
      }, {
        'name': 'The word in sentence',
        'value': sentence
      }
    ]
  };
  client.channels.get(config.discordChannelId).send('', { embed });
}

function addWordToDictionary (word) {
  // Adding word to Dictionary
  try {
    fs.appendFileSync('./dict/sv-SE.dic', '\n' + word);
  } catch (err) {
    /* Handle the error */
    throw err;
  }
  normalize();
}

function normalize () {
  SpellChecker.normalizeDictionary('./dict/sv-SE.dic', './dict/sv-SE.dic', function (err, success) {
    if (success) {
      console.log('The file was normalized');
    }
    if (err) {
      throw err;
    }
  });
}
