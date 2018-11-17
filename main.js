var HTMLParser = require('node-html-parser');
const Discord = require('discord.js');
var mongoose = require('mongoose');
var schedule = require('node-schedule');
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
var Article = require('./schemas/article.js');

// Discord startup
client.on('ready', () => {
  console.log('Startup Sucess!');
  readRRS();
  // alertSchedule();
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
          checkSpelling(articleBody, authorEmail, articleId, authorEmail);
        });
    });
  })();
}

function checkSpelling (html, authorEmail, articleId, authorEmail) {
  console.log('------------------------------------');
  let wordArray = html.split(' ');
  console.log('Running check on article ' + articleId);
  var mispelledWords = [];
  var sentences = [];

  for (var i = 0; i < wordArray.length; i++) {
    const cleanedWord = cleanWord(wordArray[i]);
    if (cleanedWord === undefined) {
      // Word got 'removed' at cleaning. SKIPPING
    } else {
      var isSpellingCorrect = myDictionary.spellCheck(cleanedWord);
      if (isSpellingCorrect === false) {
        console.log(isSpellingCorrect + ' - ' + cleanedWord);
        const sentence = wordArray[i - 3] + ' ' + wordArray[i - 2] + ' ' + wordArray[i - 1] + ' ' +
        wordArray[i].toUpperCase() + ' ' + wordArray[i + 1] + ' ' + wordArray[i + 2] + ' ' + wordArray[i + 3];

        // Check if the sentence contains invalid characters
        const invalidChars = /[!•►”–@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?1234567890]/;
        if (invalidChars.test(sentence)) {
          // Sentence contains invalid characters. SKIPPING
        } else {
          mispelledWords.push(cleanedWord);
          sentences.push(sentence);
        }
      }
    }
  }
  addNewArticle(mispelledWords, sentences, articleId, authorEmail); // Add the misspelled words to MongoDB
  console.log('-----------------------------');
}

function cleanWord (word) {
  const invalidChars = /[ A-ZÅÄÖ!•►”–@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?1234567890]/;
  if (invalidChars.test(word) || word === '') {
    return undefined; // The word contains invalid characters, returning undefined and skipping it later.
  } else {
    return word;
  }
}

function addNewArticle (words, sentences, articleId, authorEmail) {
  console.log('Adding mispelled word');
  console.log(articleId);
  console.log(words);
  console.log(sentences);
  console.log('Check for article ' + articleId + ' has been completed.');

  mongoose.connect(config.mongodbURI, {
    useNewUrlParser: true
  });

  const newArticle = new Article({
    _id: articleId,
    words: words,
    sentences: sentences,
    authorEmail: authorEmail
  });
  newArticle.save();
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

// Checks for new articles and send an discord alert.
function alertSchedule () {
  console.log('Running alert');

  mongoose.connect(config.mongodbURI, {
    useNewUrlParser: true
  });
  const query = Article.find({ 'alerted': false });
  query.limit(5);

  query.exec(function (err, docs) {
    if (err) throw err;
    docs.forEach(article => {
      console.log(article._id);
      let words = '';
      let sentences = '';
      for (var i = 0; i < article.words.length; i++) {
        words = words + '(' + [i] + ') - ' + article.words[i] + '\n';
        sentences = sentences + '(' + [i] + ') - ' + article.sentences[i] + '\n';
      }

      const embed = {
        'color': 11738382,
        'timestamp': article.date,
        'footer': {
          'icon_url': 'https://cdn.discordapp.com/embed/avatars/0.png',
          'text': article._id
        },
        'title': 'Aftonbladet-Spell-Checker',
        'fields': [
          {
            'name': 'Misspelled words',
            'value': words
          }, {
            'name': 'The words in sentence',
            'value': sentences
          }
        ]
      };
      client.channels.get(config.discordChannelId).send('Link to article ' + config.aftonbladetBaseUrl + article._id, { embed });
      Article.findOne({ '_id': article._id }, function (err, doc) {
        if (err) throw err;
        doc.alerted = true;
        doc.save();
      });
    });
  });
}

// Schedule alert every 5 minutes
schedule.scheduleJob('*/1 * * * *', function () {
  alertSchedule();
});
