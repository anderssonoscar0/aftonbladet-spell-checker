var HTMLParser = require('node-html-parser')
const Discord = require('discord.js')
var mongoose = require('mongoose')
var schedule = require('node-schedule')
const client = new Discord.Client()
let Parser = require('rss-parser')
let parser = new Parser()
const fs = require('fs')
var SpellChecker = require('simple-spellchecker')
var myDictionary = null
var moment = require('moment')
moment().format()

// Load dictionary.
SpellChecker.getDictionary('sv-SE', './dict', function (err, result) {
  if (!err) {
    myDictionary = result
  } else {
    console.log(err)
  }
})

const fetch = require('node-fetch')
const config = require('./config.js')
const mailer = require('./mailer.js')
const logger = require('./logger.js')
var Article = require('./schemas/article.js')

// Discord startup
client.on('ready', () => {
  logger.log('Startup success')
  readRRS()
  mongoose.connect(config.mongodbURI, {
    useNewUrlParser: true
  })
})
normalize()
client.login(config.discordToken)

// Discord listen
client.on('message', message => {
  if (!message.content.startsWith(config.discordPrefix)) return
  if (message.channel.id !== config.discordChannelId) return
  const args = message.content.slice(config.discordPrefix.length).trim().split(/ +/g)
  const command = args.shift().toLowerCase()

  if (command === 'alert') {
    const invalidChars = /[ A-z!✓•▪►”–@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/
    if (args.length < 3) {
      message.channel.send('Missing arguments')
    } else if (!invalidChars.test(args[0])) {
      message.channel.send('Command is ".alert <ArticleId> <Number> <Correct spelling>"')
    } else if (isNaN(args[1])) {
      message.channel.send('The misspelled word must be an integer')
    } else {
      sendDiscordVote(args, message)
    }
  }

  if (command === 'addword') {
    const invalidChars = /[ a-z!✓•▪►”–@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/
    if (args.length < 2) {
      message.channel.send('Missing argument')
    } else if (!invalidChars.test(args[0])) {
      message.channel.send('Command is ".addword <ArticleId> <Number>"')
    } else {
      updateArticleError(args, true, message) // Update the article AND add the words
    }
  }

  if (command === 'ignore') {
    const invalidChars = /[ !✓•▪►”–@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/
    if (args.length < 2) {
      message.channel.send('Missing argument')
    } else if (!invalidChars.test(args[0])) {
      message.channel.send('Command is ".ignore <ArticleId> <Number>"')
    } else {
      updateArticleError(args, false, message) // Update the article and IGNORE the words
    }
  }

  if (command === 'clear') {
    cleanChannel() // Clean #aftonbladet
  }
  if (command === 'checkvotes') {
    checkErrorVotes()
  }
})

function readRRS () {
  (async () => {
    let feed = await parser.parseURL('https://www.aftonbladet.se/rss.xml')
    feed.items.forEach(item => {
      let articleId = item.link.substr(0, item.link.lastIndexOf('/')).slice(-9)
      Article.findOne({ '_id': articleId }, function (err, doc) {
        if (err) throw err
        if (doc === null) {
          fetch(item.link)
            .then(res => res.text())
            .then(htmlbody => {
              let parsedBody = HTMLParser.parse(htmlbody)
              let authorName = parsedBody.querySelector('._38DY_')
              const articleTitle = parsedBody.querySelector('._11S-G').rawText
              if (authorName !== null) {
                authorName = authorName.rawText.toLowerCase().replace(' ', '.') // Replace first space with a dot
                authorName = authorName.replace(' ', '') // Remove second space
                const invalidChars = /[ ÅÄÖåäöé,]/
                if (invalidChars.test(authorName)) {
                  authorName = authorName.replace('å', 'a')
                  authorName = authorName.replace('ä', 'a')
                  authorName = authorName.replace('ö', 'o')
                  authorName = authorName.replace('é', 'e')
                  authorName = authorName.replace(',', '')
                }
                const authorEmail = authorName === 'tt' ? 'webbnyheter@aftonbladet.se' : authorName + '@aftonbladet.se' // If authorName 'TT' -> newsroom is the author
                let articleBody = parsedBody.querySelector('._3p4DP._1lEgk').rawText.replace(/\./g, ' ')
                checkSpelling(articleBody, authorEmail, articleId, articleTitle, item.link)
              }
            })
        }
      })
    })
  })()
}

function checkSpelling (html, authorEmail, articleId, articleTitle, url) {
  let wordArray = html.split(' ')
  var misspelledWords = []
  var sentences = []
  const breakOnReadMore = /[LÄS]+[OCKSÅ]+/
  const breakOnArticleAbout = /[ARTIKELN ]+[HANDLAR ]+[OM]+/
  for (var i = 0; i < wordArray.length; i++) {
    if (breakOnReadMore.test(wordArray[i] + wordArray[i + 1]) || breakOnArticleAbout.test(wordArray[i] + wordArray[i + 1] + wordArray[i + 2])) {
      break
    }
    const cleanedWord = cleanWord(wordArray[i])
    if (cleanedWord === undefined || encodeURI(wordArray[i]) === '%E2%81%A0') {
      // Word got 'removed' at cleaning. SKIPPING
    } else {
      var isWordInDictionary = myDictionary.spellCheck(cleanedWord)
      var isWordMisspelled = myDictionary.isMisspelled(cleanedWord)
      if (isWordInDictionary === false && isWordMisspelled === true) {
        const sentence = wordArray[i - 3] + ' ' + wordArray[i - 2] + ' ' + wordArray[i - 1] + ' ' +
        wordArray[i].toUpperCase() + ' ' + wordArray[i + 1] + ' ' + wordArray[i + 2] + ' ' + wordArray[i + 3]
        // Check if the sentence contains invalid characters
        const invalidChars = /[!•►✓▪”–@#$%^&*()_+\-=[\]{};':"\\|,.<>/?1234567890]/
        if (invalidChars.test(sentence)) {
          // Sentence contains invalid characters. SKIPPING
        } else {
          if (!(misspelledWords.indexOf(cleanedWord) > -1)) {
            misspelledWords.push(cleanedWord)
            sentences.push(sentence)
          }
        }
      }
    }
  }
  logger.log(articleId + ' has ' + misspelledWords.length + ' misspelled words')
  addNewArticle(misspelledWords, sentences, articleId, authorEmail, articleTitle, url) // Add the misspelled words to MongoDB
}

function cleanWord (word) {
  const invalidChars = /[ A-ZÅÄÖ!✓▪•►”–@#$%^&*()_+\-=[\]{};':"\\|,.<>/?1234567890]/
  if (invalidChars.test(word) || word === '') {
    return undefined // The word contains invalid characters, returning undefined and skipping it later.
  }
  return word
}

function addNewArticle (words, sentences, articleId, authorEmail, articleTitle, url) {
  if (words.length === 0) return
  client.channels.get(config.discordChannelId).send(articleId + ' was just checked. THIS MESSAGE SHOULD UPDATE SOON')
  client.channels.get(config.discordChannelId).fetchMessages({ limit: 1 }).then(messages => {
    const messageId = messages.first().id
    const newArticle = new Article({
      _id: articleId,
      words: words,
      articleUrl: url,
      sentences: sentences,
      authorEmail: authorEmail,
      discordMessageId: messageId,
      articleTitle: articleTitle
    })
    newArticle.save(function (err) {
      if (err) {
        if (err.code === 11000) {
          logger.log(articleId + ' already checked.')
        } else {
          throw err
        }
      } else {
        sendDiscordAlert(articleId, new Date(), words, sentences, messageId, authorEmail)
      }
    })
  })
}

function updateArticleError (args, addToDictionary, message) {
  // Adding word to Dictionary
  const articleId = args[0]
  args.shift() // Remove the first item in args (The article ID)
  Article.findOne({ '_id': articleId }, function (err, doc) {
    if (err) throw err
    if (doc) {
      let words = []
      let sentences = []
      let wordsAdded = ''
      let addedWords = 0
      let ignoredWords = 0
      if (args[0] === 'all') { args = Array(doc.words.length).fill().map((x, i) => i.toString()) }
      if (doc.words.length < 1) return
      for (var i = 0; i < doc.words.length; i++) {
        if (args.includes(i.toString())) {
          if (addToDictionary === true) {
          // Add the word to the dictionary
            try {
              fs.appendFileSync('./dict/sv-SE.dic', '\n' + doc.words[i])
            } catch (err) {
            /* Handle the error */
              throw err
            }
            addedWords = addedWords + 1
            wordsAdded = wordsAdded + doc.words[i] + '\n'
          } else {
          // Dont add it to the dictionary (Ignore the article error)
            ignoredWords = ignoredWords + 1
          }
        } else {
          words.push(doc.words[i])
          sentences.push(doc.sentences[i])
        }
      }
      doc.words = words
      doc.sentences = sentences
      doc.save()
        .then(() => {
          normalize()
        })
      if (addToDictionary) {
        logger.log(articleId + ' (' + message.author.username + ') Added ' + addedWords + ' words')
        message.react('✅')
        const addedWordsEmbed = {
          'embed': {
            'color': 1376000,
            'timestamp': new Date(),
            'fields': [
              {
                'name': message.author.username + ' - added ' + addedWords + ' words',
                'value': '```\n' + wordsAdded + '```'
              }
            ]
          }
        }
        client.channels.get(config.addwordChannelId).send(addedWordsEmbed)
      }
      sendDiscordAlert(doc._id, doc.date, words, sentences, doc.discordMessageId, doc.authorEmail)
    } else {
      message.react('❌')
    }
  })
}

function normalize () {
  SpellChecker.normalizeDictionary('./dict/sv-SE.dic', './dict/sv-SE.dic', function (err, success) {
    if (success) logger.log('Normalized dictionary')
    if (err) throw err
  })
}

function sendDiscordAlert (articleId, articleDate, words, sentences, discordMessageId, authorEmail) {
  let sendWords = ''
  let sendSentences = ''
  for (var i = 0; i < words.length; i++) {
    sendWords = sendWords + '(' + [i] + ') - ' + words[i] + '\n'
    sendSentences = sendSentences + '(' + [i] + ') - ' + sentences[i] + '\n'
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
  }

  client.channels.get(config.discordChannelId).fetchMessage(discordMessageId)
    .then(message => {
      sendWords.length === 0
        ? message.delete()
        : message.edit('Link to article ' + config.aftonbladetBaseUrl + articleId, { embed })
    })
}

function alertAftonbladet (misspelledWord, correctWord, articleUrl, articleTitle, articleId, authorEmail) {
  let mailOptions = {
    from: config.mailAdress,
    to: 'anderssonoscar0@gmail.com, saveljeffjonatan@gmail.com', // authorEmail
    subject: 'Hej! Jag har hittat ett misstag i en artikel',
    html: '<p><b>"' + misspelledWord + '"</b> stavas egentligen såhär "<b>' + correctWord + '</b>"</p><br><a href="' + articleUrl + '">' + articleTitle + '</a>'
  }
  mailer.mail(mailOptions)
  client.channels.get(config.alertChannelId).send('Article ' + articleId + ' received 5 votes. Misspelled word was: (' + misspelledWord + ') and the correct spelling is (' + correctWord + ')')
}

function sendDiscordVote (args, message) {
  const articleId = args[0]
  const wordId = args[1]
  const correctWord = args[2]

  Article.findOne({ '_id': articleId }, function (err, doc) {
    if (err) throw err
    if (doc) {
      const embed = {
        'embed': {
          'title': doc.authorEmail,
          'url': doc.articleUrl,
          'color': 16711710,
          'author': {
            'name': doc.articleTitle,
            'url': doc.articleUrl
          },
          'timestamp': doc.date,
          'footer': {
            'text': doc._id
          },
          'fields': [
            {
              'name': 'Misspelled word:',
              'value': doc.words[wordId]
            },
            {
              'name': 'Correct word:',
              'value': correctWord
            }
          ]
        }
      }
      client.channels.get(config.voteChannelId).send('', embed).then(message => {
        message.react('⭐')
        client.channels.get(config.voteChannelId).fetchMessage(message.id)
          .then(message => {
            message.react('❌')
          })
      })
      args.splice(-1, 1)
      updateArticleError(args, false, message)
    } else {
      message.react('❌')
    }
  })
}

// Scheudule article search every 5 minutes
schedule.scheduleJob('*/10 * * * *', function () {
  logger.log('(SCHEDULE-JOB) - Running RRS reader')
  readRRS()
})

schedule.scheduleJob('*/5 * * * *', function () {
  logger.log('(SCHEDULE-JOB) - Running vote checker')
  checkErrorVotes()
})

schedule.scheduleJob('*/10 * * * *', function () {
  logger.log('(SCHEDULE-JOB) - Running cleaning of #aftonbladet')
  cleanChannel()
})

function checkErrorVotes () {
  client.channels.get(config.voteChannelId).fetchMessages()
    .then(function (list) {
      const listOfMessages = list.array()
      for (var i = 0; i < listOfMessages.length;) {
        const reactions = listOfMessages[i].reactions.array()
        if (reactions.length > 0) {
          const reactionArray = reactions[0].message.reactions.array()
          const crossCount = reactionArray[0]._emoji.name === '❌' ? reactionArray[0].count : reactionArray[1].count
          const starCount = reactionArray[1]._emoji.name === '⭐' ? reactionArray[1].count : reactionArray[0].count
          if (starCount > 2) {
            // Get article stuffs
            const embedInfo = reactionArray[0].message.embeds[0]
            const articleId = embedInfo.footer.text
            const articleTitle = embedInfo.author.name
            const articleUrl = embedInfo.url
            const authorEmail = embedInfo.title
            const misspelledWord = embedInfo.fields[0].value
            const correctWord = embedInfo.fields[1].value
            alertAftonbladet(misspelledWord, correctWord, articleUrl, articleTitle, articleId, authorEmail)
            listOfMessages[i].delete()
          }
          if (crossCount > 1) listOfMessages[i].delete()
        }
        i++
      }
    }, function (err) { throw err })
}

function cleanChannel () {
  logger.log('Cleaning #aftonbladet')
  client.channels.get(config.discordChannelId).fetchMessages()
    .then(function (list) {
      const messageList = list.array()
      for (var i = 0; i < messageList.length;) {
        if (messageList[i].embeds.length > 0) {
          const messageTimestamp = messageList[i].embeds[0].message.createdTimestamp
          if (moment(messageTimestamp).isBefore(moment().subtract(3, 'hours'))) {
            messageList[i].delete()
          }
        } else {
          messageList[i].delete()
        }
        i++
      }
    })
  logger.log('Cleaned #aftonbladet')
}
