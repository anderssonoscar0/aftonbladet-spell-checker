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

  if (command === 'addword') {
    const invalidChars = /[ a-z!✓•▪►”–@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/;
    if (args.length < 2) {
      message.channel.send('Missing argument');
    } else if (!invalidChars.test(args[0])) {
      message.channel.send('Command is ".addword <ArticleId> <Number>"');
    } else {
      updateArticleError(args, true); // Update the article AND add the words
    }
  }

  if (command === 'ignore') {
    const invalidChars = /[ a-z!✓•▪►”–@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/;
    if (args.length < 2) {
      message.channel.send('Missing argument');
    } else if (!invalidChars.test(args[0])) {
      message.channel.send('Command is ".ignore <ArticleId> <Number>"');
    } else {
      updateArticleError(args, false); // Update the article and IGNORE the words
    }
  }

  if (command === 'clear') {
    if (message.member.hasPermission('MANAGE_MESSAGES')) {
      message.channel.fetchMessages()
        .then(function (list) {
          message.channel.bulkDelete(list);
        }, function (err) { throw err; });
    }
  }
});

function readRRS () {
  (async () => {
    let feed = await parser.parseURL('https://www.aftonbladet.se/nyheter/rss.xml');
    feed.items.forEach(item => {
      const string = item.link;
      let articleId = string.substr(0, string.lastIndexOf('/')).substr(33);

      mongoose.connect(config.mongodbURI, {
        useNewUrlParser: true
      });
      Article.findOne({ '_id': articleId }, function (err, doc) {
        if (err) throw err;
        if (doc === null) {
          fetch(config.aftonbladetBaseUrl + articleId)
            .then(res => res.text())
            .then(htmlbody => {
              let parsedBody = HTMLParser.parse(htmlbody);
              const authorName = parsedBody.querySelector('._3ij4i').rawText.toLowerCase().replace(' ', '.');
              const authorEmail = authorName === 'tt' ? 'webbnyheter@aftonbladet.se' : authorName + '@aftonbladet.se'; // If authorName 'TT' -> newsroom is the author
              let articleBody = parsedBody.querySelector('._3p4DP._1lEgk').rawText.replace(/\./g, ' ');
              checkSpelling(articleBody, authorEmail, articleId, authorEmail);
            });
        } else {
          console.log('This article has already been checked for errors! ' + articleId);
        }
      });
    });
  })();
}

function checkSpelling (html, authorEmail, articleId) {
  console.log('------------------------------------');
  let wordArray = html.split(' ');
  console.log('Starting check for article: ' + articleId);
  var mispelledWords = [];
  var sentences = [];

  for (var i = 0; i < wordArray.length; i++) {
    const cleanedWord = cleanWord(wordArray[i]);
    if (cleanedWord === undefined) {
      // Word got 'removed' at cleaning. SKIPPING
    } else {
      var isWordInDictionary = myDictionary.spellCheck(cleanedWord);
      var isWordMisspelled = myDictionary.isMisspelled(cleanedWord);
      if (isWordInDictionary === false && isWordMisspelled === true) {
        console.log(isWordInDictionary + ' - ' + cleanedWord);
        const sentence = wordArray[i - 3] + ' ' + wordArray[i - 2] + ' ' + wordArray[i - 1] + ' ' +
        wordArray[i].toUpperCase() + ' ' + wordArray[i + 1] + ' ' + wordArray[i + 2] + ' ' + wordArray[i + 3];

        // Check if the sentence contains invalid characters
        const invalidChars = /[!•►✓▪”–@#$%^&*()_+\-=[\]{};':"\\|,.<>/?1234567890]/;
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
  const invalidChars = /[ A-ZÅÄÖ!✓▪•►”–@#$%^&*()_+\-=[\]{};':"\\|,.<>/?1234567890]/;
  if (invalidChars.test(word) || word === '') {
    return undefined; // The word contains invalid characters, returning undefined and skipping it later.
  } else {
    return word;
  }
}

function addNewArticle (words, sentences, articleId, authorEmail) {
  console.log('Check for article: ' + articleId + ' has been completed. Adding to Database.');

  mongoose.connect(config.mongodbURI, {
    useNewUrlParser: true
  });

  client.channels.get(config.discordChannelId).send(articleId + ' was just checked. THIS MESSAGE SHOULD UPDATE SOON');
  client.channels.get(config.discordChannelId).fetchMessages({ limit: 1 }).then(messages => {
    const messageId = messages.first().id;
    const newArticle = new Article({
      _id: articleId,
      words: words,
      sentences: sentences,
      authorEmail: authorEmail,
      discordMessageId: messageId
    });
    newArticle.save(function (err) {
      if (err) {
        if (err.code === 11000) {
          console.log(articleId + ' has already been checked for errors.');
        } else {
          throw err;
        }
      } else {
        sendDiscordAlert(articleId, new Date(), words, sentences, messageId);
      }
    });
  });
}

function updateArticleError (args, addToDictionary) {
  // Adding word to Dictionary
  const articleId = args[0];
  console.log('Updating articleId: ' + articleId);
  args.shift(); // Remove the first item in args (The article ID)
  Article.findOne({ '_id': articleId }, function (err, doc) {
    if (err) throw err;
    let words = [];
    let sentences = [];
    for (var i = 0; i < doc.words.length; i++) {
      if (args.includes(i.toString())) {
        if (addToDictionary === true) {
          // Add the word to the dictionary
          try {
            fs.appendFileSync('./dict/sv-SE.dic', '\n' + doc.words[i]);
          } catch (err) {
          /* Handle the error */
            throw err;
          }
          normalize();
          client.channels.get(config.discordChannelId).send(doc.words[i] + ' was added to the dictionary.');
        } else {
          // Dont add it to the dictionary (Ignore the article error)
          client.channels.get(config.discordChannelId).send(doc.words[i] + ' was ignored.');
        }
      } else {
        words.push(doc.words[i]);
        sentences.push(doc.sentences[i]);
      }
    }
    doc.words = words;
    doc.sentences = sentences;
    doc.save();
    sendDiscordAlert(doc._id, doc.date, words, sentences, doc.discordMessageId);
  });
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

function sendDiscordAlert (articleId, articleDate, words, sentences, discordMessageId) {
  let sendWords = '';
  let sendSentences = '';
  for (var i = 0; i < words.length; i++) {
    sendWords = sendWords + '(' + [i] + ') - ' + words[i] + '\n';
    sendSentences = sendSentences + '(' + [i] + ') - ' + sentences[i] + '\n';
  }
  const embed = {
    'color': 11738382,
    'timestamp': articleDate,
    'footer': {
      'icon_url': 'https://cdn.discordapp.com/embed/avatars/0.png',
      'text': articleId
    },
    'title': 'Aftonbladet-Spell-Checker',
    'fields': [
      {
        'name': 'Misspelled words',
        'value': sendWords
      }, {
        'name': 'The words in sentence',
        'value': sendSentences
      }
    ]
  };

  client.channels.get(config.discordChannelId).fetchMessage(discordMessageId)
    .then(message => {
      if (sendWords.length === 0) {
        message.delete();
        Article.findOneAndDelete({ '_id': articleId }, function (err) {
          if (err) throw err;
        });
        client.channels.get(config.discordChannelId).send(articleId + ' has no errors remaining!');
      } else {
        message.edit('Link to article ' + config.aftonbladetBaseUrl + articleId, { embed });
      }
    });
}

// Scheudule article search every 5 minutes
schedule.scheduleJob('*/5 * * * *', function () {
  readRRS();
});
