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
const mailer = require('./mailer.js');
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

  if (command === 'alert') {
    const invalidChars = /[ A-z!✓•▪►”–@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/;
    if (args.length < 3) {
      message.channel.send('Missing arguments');
    } else if (!invalidChars.test(args[0])) {
      message.channel.send('Command is ".alert <ArticleId> <Number> <Correct spelling>"');
    } else if (isNaN(args[1])) {
      message.channel.send('The misspelled word must be an integer');
    } else {
      alertAftonbladet(args);
    }
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
    const invalidChars = /[ !✓•▪►”–@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/;
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
              let authorName = parsedBody.querySelector('._38DY_');
              const articleTitle = parsedBody.querySelector('._11S-G').rawText;
              if (authorName === null) {
                console.log(articleId + ' is an + article. SKIPPING');
              } else {
                authorName = authorName.rawText.toLowerCase().replace(' ', '.'); // Replace first space with a dot
                authorName = authorName.replace(' ', ''); // Remove second space
                const invalidChars = /[ ÅÄÖåäö]/;
                if (invalidChars.test(authorName)) {
                  authorName = authorName.replace('å', 'a');
                  authorName = authorName.replace('ä', 'a');
                  authorName = authorName.replace('ö', 'o');
                  authorName = authorName.replace('é', 'e');
                }
                const authorEmail = authorName === 'tt' ? 'webbnyheter@aftonbladet.se' : authorName + '@aftonbladet.se'; // If authorName 'TT' -> newsroom is the author
                let articleBody = parsedBody.querySelector('._3p4DP._1lEgk').rawText.replace(/\./g, ' ');
                checkSpelling(articleBody, authorEmail, articleId, articleTitle);
              }
            });
        }
      });
    });
  })();
}

function checkSpelling (html, authorEmail, articleId, articleTitle) {
  console.log('------------------------------------');
  let wordArray = html.split(' ');
  console.log('Starting check for article: ' + articleId);
  var misspelledWords = [];
  var sentences = [];

  for (var i = 0; i < wordArray.length; i++) {
    const cleanedWord = cleanWord(wordArray[i]);
    if (cleanedWord === undefined) {
      // Word got 'removed' at cleaning. SKIPPING
    } else {
      var isWordInDictionary = myDictionary.spellCheck(cleanedWord);
      var isWordMisspelled = myDictionary.isMisspelled(cleanedWord);
      if (isWordInDictionary === false && isWordMisspelled === true) {
        const sentence = wordArray[i - 3] + ' ' + wordArray[i - 2] + ' ' + wordArray[i - 1] + ' ' +
        wordArray[i].toUpperCase() + ' ' + wordArray[i + 1] + ' ' + wordArray[i + 2] + ' ' + wordArray[i + 3];
        // Check if the sentence contains invalid characters
        const invalidChars = /[!•►✓▪”–@#$%^&*()_+\-=[\]{};':"\\|,.<>/?1234567890]/;
        if (invalidChars.test(sentence)) {
          // Sentence contains invalid characters. SKIPPING
        } else {
          misspelledWords.push(cleanedWord);
          sentences.push(sentence);
        }
      }
    }
  }
  console.log('Found ' + misspelledWords.length + ' misspelled words in article: ' + articleTitle);
  addNewArticle(misspelledWords, sentences, articleId, authorEmail, articleTitle); // Add the misspelled words to MongoDB
  console.log('------------------------------------');
}

function cleanWord (word) {
  const invalidChars = /[ A-ZÅÄÖ!✓▪•►”–@#$%^&*()_+\-=[\]{};':"\\|,.<>/?1234567890]/;
  if (invalidChars.test(word) || word === '') {
    return undefined; // The word contains invalid characters, returning undefined and skipping it later.
  } else {
    return word;
  }
}

function addNewArticle (words, sentences, articleId, authorEmail, articleTitle) {
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
      discordMessageId: messageId,
      articleTitle: articleTitle
    });
    newArticle.save(function (err) {
      if (err) {
        if (err.code === 11000) {
          console.log(articleId + ' has already been checked for errors.');
        } else {
          throw err;
        }
      } else {
        sendDiscordAlert(articleId, new Date(), words, sentences, messageId, authorEmail);
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
    let addedWords = 0;
    let ignoredWords = 0;
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
          addedWords = addedWords + 1;
        } else {
          // Dont add it to the dictionary (Ignore the article error)
          ignoredWords = ignoredWords + 1;
        }
      } else {
        words.push(doc.words[i]);
        sentences.push(doc.sentences[i]);
      }
    }
    doc.words = words;
    doc.sentences = sentences;
    doc.save();
    addedWords ? client.channels.get(config.discordChannelId).send('Added ' + addedWords + ' words for article: ' + articleId) : client.channels.get(config.discordChannelId).send('Ignored ' + ignoredWords + ' words for article: ' + articleId);
    sendDiscordAlert(doc._id, doc.date, words, sentences, doc.discordMessageId, doc.authorEmail);
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

function sendDiscordAlert (articleId, articleDate, words, sentences, discordMessageId, authorEmail) {
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
    'author': {
      'name': authorEmail,
      'icon_url': 'https://i.imgur.com/CMkUWBo.png'
    },
    'fields': [
      {
        'name': 'Misspelled words',
        'value': sendWords
      }, {
        'name': 'The words in sentence',
        'value': sentences.length > 15 ? 'To many errors to show.' : sendSentences
      }
    ]
  };

  client.channels.get(config.discordChannelId).fetchMessage(discordMessageId)
    .then(message => {
      if (sendWords.length === 0) {
        message.delete();
        client.channels.get(config.discordChannelId).send(articleId + ' has no errors remaining!');
      } else {
        message.edit('Link to article ' + config.aftonbladetBaseUrl + articleId, { embed });
      }
    });
}

function alertAftonbladet (args) {
  mongoose.connect(config.mongodbURI, {
    useNewUrlParser: true
  });

  const articleId = args[0];
  const wordId = args[1];
  Article.findOne({ '_id': articleId }, function (err, doc) {
    if (err) throw err;
    if (doc) {
      let mailOptions = {
        from: config.mailAdress,
        to: doc.authorEmail,
        subject: 'Hej! Jag har hittat ett misstag i en artikel',
        html: '<p><b>"' + doc.words[wordId] + '"</b> stavas egentligen såhär "<b>' + args[2] + '</b>"</p><br><a href="https://www.aftonbladet.se' + args[0] + '">' + doc.articleTitle + '</a>'
      };
      mailer.mail(mailOptions);
    } else {
      client.channels.get(config.discordChannelId).send("Can't find article with id: " + articleId);
    }
  });
}

// Scheudule article search every 5 minutes
schedule.scheduleJob('*/5 * * * *', function () {
  console.log('Run RrsReader...');
  readRRS();
});

schedule.scheduleJob('*/2 * * * *', function () {
  console.log('Run Normalizer...');
  normalize();
});
