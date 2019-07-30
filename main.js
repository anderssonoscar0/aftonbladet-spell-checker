/* eslint-disable import/no-nodejs-modules */
/* eslint-disable no-sync */
const HTMLParser = require('node-html-parser')
const Discord = require('discord.js')
const mongoose = require('mongoose')
const schedule = require('node-schedule')
const client = new Discord.Client()
const Parser = require('rss-parser')
const parser = new Parser()
const fetch = require('node-fetch')
const fs = require('fs')
const SpellChecker = require('simple-spellchecker')
const moment = require('moment')
moment().format()

getUpdatedDictionary()

let myDictionary = null
const config = require('./config.js')
const mailer = require('./mailer.js')
const logger = require('./logger.js')
const Article = require('./schemas/article.js')

// Global variables
const breakOnReadMore = /[LÄS]+[OCKSÅ]+/
const breakOnArticleAbout = /[ARTIKELN ]+[HANDLAR ]+[OM]+/

// Discord startup
client.on('ready', () => {
  logger.log('STARTUP', 'Success')
  readRRS()
  checkErrorVotes()
  checkForArticleFixes()
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
    let clean = false
    if (args.length > 0) clean = true
    cleanChannel(clean) // Clean #aftonbladet
  }
  if (command === 'checkvotes') checkErrorVotes()
})

function readRRS () {
  (async () => {
    const feed = await parser.parseURL('https://www.aftonbladet.se/rss.xml')
    feed.items.forEach(item => {
      const skipTvArticles = /[t][v]./
      const skipDebattArticles = /\Wdebatt\W/
      if (skipTvArticles.test(item.link)) return
      if (skipDebattArticles.test(item.link)) return
      const articleId = item.link.substr(0, item.link.lastIndexOf('/')).slice(-9)
      Article.findOne({ '_id': articleId }, (err, doc) => {
        if (err) throw err
        if (doc === null) {
          fetch(item.link)
            .then(res => res.text())
            .then(htmlbody => {
              const parsedBody = HTMLParser.parse(htmlbody)
              const twitterNodes = parsedBody.querySelectorAll('._3sD2l')
              if (twitterNodes.length > 0) twitterNodes.forEach(node => { node.parentNode.removeChild(node) }) // Remove twitter embeds
              try {
                const authorName = parsedBody.querySelector('._2atUs.abRedLink._1zkyS').rawAttributes.href
                const authorEmail = authorName.substring(7, authorName.indexOf('?')).split(',')
                const articleTitle = parsedBody.querySelector('._11S-G').rawText
                const articleBody = parsedBody.querySelector('._3p4DP._1lEgk').rawText.replace(/\./g, ' ')
                checkSpelling(articleBody, authorEmail, articleId, articleTitle, item.link)
              } catch {
                try {
                  const getAuthorlink = config.aftonbladetBaseUrl + parsedBody.querySelector('._38DY_').rawAttributes.href
                  fetch(getAuthorlink)
                    .then(res => res.text())
                    .then(authorHtmlBody => {
                      const parsedAuthorBody = HTMLParser.parse(authorHtmlBody)
                      const articleBody = parsedBody.querySelector('._3p4DP._1lEgk').rawText.replace(/\./g, ' ')
                      const articleTitle = parsedBody.querySelector('._11S-G').rawText
                      let authorName
                      let authorEmail
                      if (parsedAuthorBody.querySelector('._1xwBj.abIconMail.abRedLink') !== null) {
                        authorName = parsedAuthorBody.querySelector('._1xwBj.abIconMail.abRedLink').rawAttributes.href
                        authorEmail = authorName.substring(7).split(',')
                      } else {
                        const authorInfo = getAuthorByLink(getAuthorlink)
                        if (authorInfo) {
                          authorEmail = authorInfo.authorEmail
                          authorName = authorInfo.authorName
                        } else {
                          logger.log(articleId, 'Can\'t find article author with the following link: ' + getAuthorlink)
                          return
                        }
                      }
                      checkSpelling(articleBody, authorEmail, articleId, articleTitle, item.link)
                    })
                } catch {
                  // Skipping because + article
                }
              }
            })
        }
      })
    })
  })()
}

async function checkSpelling (html, authorEmail, articleId, articleTitle, url) {
  const wordArray = html.split(' ')
  const misspelledWords = []
  const sentences = []
  const addWords = []
  for (let i = 0; i < wordArray.length; i++) {
    if (breakOnReadMore.test(wordArray[i] + wordArray[i + 1]) || breakOnArticleAbout.test(wordArray[i] + wordArray[i + 1] + wordArray[i + 2])) break
    const cleanedWord = await cleanWord(wordArray[i])
    if (cleanedWord === undefined || encodeURI(wordArray[i]) === '%E2%81%A0') {
      // Word got 'removed' at cleaning. SKIPPING
    } else {
      const isWordInDictionary = await myDictionary.spellCheck(cleanedWord)
      const isWordMisspelled = await myDictionary.isMisspelled(cleanedWord)
      if (isWordInDictionary === false && isWordMisspelled === true) {
        await fetch('https://svenska.se/tri/f_saol.php?sok=' + encodeURI(cleanedWord))
          .then(async res => {
            const htmlbody = await res.textConverted()
            const parsedBody = await HTMLParser.parse(htmlbody)
            const test = await parsedBody.structuredText
            if (await test.includes('gav inga svar')) {
              logger.log(articleId, 'NOT IN DICT: ' + cleanedWord)
              const sentence = wordArray[i - 3] + ' ' + wordArray[i - 2] + ' ' + wordArray[i - 1] + ' ' +
                wordArray[i].toUpperCase() + ' ' + wordArray[i + 1] + ' ' + wordArray[i + 2] + ' ' + wordArray[i + 3]
              // Check if the sentence contains invalid characters
              if (!(misspelledWords.indexOf(cleanedWord) > -1)) {
                misspelledWords.push(cleanedWord)
                sentences.push(sentence)
              }
            } else if (await !(addWords.indexOf(cleanedWord) > -1)) {
              await addWords.push(cleanedWord)
              await logger.log(articleId, 'Adding to DICT: ' + cleanedWord)
              await fs.appendFileSync('./dict/sv-SE.dic', '\n' + cleanedWord)
            }
          })
      }
    }
  }

  if (addWords.length > 0) await normalize()
  if (misspelledWords.length > 0) await addNewArticle(misspelledWords, sentences, articleId, authorEmail, articleTitle, url) // Add the misspelled words to MongoDB
}

function cleanWord (word) {
  const invalidChars = /[ A-ZÄÅÖ!✓▪…•►”’–@#$%^&*()_+\-=[\]{};':"\\|,.<>/?1234567890]/
  if (invalidChars.test(word) || word === '') return undefined // The word contains invalid characters, returning undefined and skipping it later.
  return word
}

function addNewArticle (words, sentences, articleId, authorEmail, articleTitle, url) {
  client.channels.get(config.discordChannelId).send(articleId + ' was just checked. THIS MESSAGE SHOULD UPDATE SOON')
    .then(message => {
      const messageId = message.id
    const newArticle = new Article({
      _id: articleId,
      words,
      articleUrl: url,
      sentences,
      authorEmail: authorEmail.toString(),
      discordMessageId: messageId,
      articleTitle
    })
    newArticle.save((err) => {
      if (err) throw err
      logger.log(articleId, 'Contains ' + words.length + ' misspelled words')
      sendDiscordAlert(articleId, new Date(), words, sentences, messageId, authorEmail.toString())
    })
  })
}

function updateArticleError (args, addToDictionary, message) {
  // Adding word to Dictionary
  const articleId = args[0]
  args.shift() // Remove the first item in args (The article ID)
  Article.findOne({ '_id': articleId }, (err, doc) => {
    if (err) throw err
    if (doc) {
      const words = []
      const sentences = []
      let wordsAdded = ''
      let addedWords = 0
      if (args[0] === 'all') { args = Array(doc.words.length).fill().map((x, i) => i.toString()) }
      if (doc.words.length < 1) return
      for (let i = 0; i < doc.words.length; i++) {
        if (args.includes(i.toString())) {
          if (addToDictionary === true) {
            // Add the word to the dictionary
            fs.appendFileSync('./dict/sv-SE.dic', '\n' + doc.words[i])
            addedWords += 1
            wordsAdded = wordsAdded + doc.words[i] + '\n'
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
        logger.log(articleId, message.author.username + ' Added ' + addedWords + ' words')
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
  SpellChecker.normalizeDictionary('./dict/sv-SE.dic', './dict/sv-SE.dic', (err, success) => {
    if (success) logger.log('NORMALIZER', 'Normalized dictionary')
    if (err) throw err
  })
}

function sendDiscordAlert (articleId, articleDate, words, sentences, discordMessageId, authorEmail) {
  logger.log(articleId, 'Sending discord embed with misspelled words')
  let sendWords = ''
  let sendSentences = ''
  for (let i = 0; i < words.length; i++) {
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

function alertAftonbladet (embedInfo) {
  const articleId = embedInfo.footer.text
  const articleTitle = embedInfo.author.name
  const articleUrl = embedInfo.url
  const authorEmail = embedInfo.title
  const misspelledWord = embedInfo.fields[0].value
  const correctWord = embedInfo.fields[1].value
  logger.log(articleId, 'Sending email alert to Aftonbladet')
  const mailOptions = {
    from: config.mailAdress,
    to: authorEmail, // CHANGE THIS LINE TO SEND TEST MAIL!!!!!!!!!!!
    subject: 'Hej! Jag har hittat ett misstag i en artikel',
    html: '<p><b>"' + misspelledWord + '"</b> stavas egentligen såhär "<b>' + correctWord + '</b>"</p><br><a href="' + articleUrl + '">' + articleTitle + '</a><br><br>Ha en fortsatt bra dag!<br><br>Med vänliga hälsningar<br>Teamet bakom AftonbladetSpellchecker'
  }
  mailer.mail(mailOptions)
}

function sendDiscordVote (args, message) {
  const articleId = args[0]
  const wordId = args[1]
  const correctWord = args[2]
  logger.log(articleId, 'Sending discord voting embed...')
  Article.findOne({ '_id': articleId }, (err, doc) => {
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
      client.channels.get(config.voteChannelId).send('Voting time! @everyone', embed).then(async message => {
        await message.react('⭐')
        await message.react('❌')
      })
      args.splice(-1, 1)
      updateArticleError(args, false, message)
    } else {
      message.react('❌')
    }
  })
}

// Scheudule article search every 5 minutes
schedule.scheduleJob('*/5 * * * *', () => {
  logger.log('(SCHEDULE-JOB)', 'Running RRS reader')
  readRRS()
})

schedule.scheduleJob('*/1 * * * *', () => {
  logger.log('(SCHEDULE-JOB)', 'Running vote checker')
  checkErrorVotes()
})

schedule.scheduleJob('*/10 * * * *', () => {
  logger.log('(SCHEDULE-JOB)', 'Running cleaning of #aftonbladet')
  cleanChannel(false)
})

schedule.scheduleJob('*/5 * * * *', () => {
  logger.log('(SCHEDULE-JOB)', 'Update dictionary')
  getUpdatedDictionary()
})

schedule.scheduleJob('*/5 * * * *', () => {
  logger.log('(SCHEDULE-JOB)', 'Checking for fixed errors')
  checkForArticleFixes()
})

function checkErrorVotes () {
  client.channels.get(config.voteChannelId).fetchMessages()
    .then((list) => {
      list.forEach(message => {
        const crosss = message.reactions.filter(reaction => reaction._emoji.name === '❌').first()
        const stars = message.reactions.filter(reaction => reaction._emoji.name === '⭐').first()
        if (crosss.count > 1) message.delete()
        if (stars.count > 1) {
          const embedInfo = message.embeds[0] // Get embed info for moving and alerting
            alertAftonbladet(embedInfo)
            moveEmbed(embedInfo, 16711710, config.notFixedWordChannelID)
          message.delete()
      }
      })
    }, (err) => { throw err })
}

function cleanChannel (deleteAll) {
  client.channels.get(config.discordChannelId).fetchMessages()
    .then((list) => {
      list.forEach(message => {
        if (deleteAll) message.delete()
        if (message.embeds.length === 0) message.delete()
        const messageTimestamp = message.createdTimestamp
        if (moment(messageTimestamp).isBefore(moment().subtract(3, 'hours'))) message.delete()
      })
    })
}

function checkForArticleFixes () {
  const channelsToCheck = [config.notFixedWordChannelID, config.voteChannelId]
  channelsToCheck.forEach(channel => {
    client.channels.get(channel).fetchMessages()
    .then((list) => {
      const messageList = list.array()
      for (let y = 0; y < messageList.length; y++) {
        const embedInfo = messageList[y].embeds[0]
        const misspelledWord = embedInfo.fields[0].value
        fetch(embedInfo.url)
          .then(res => res.text())
          .then(htmlbody => {
            const parsedBody = HTMLParser.parse(htmlbody)
            const articleBody = parsedBody.querySelector('._3p4DP._1lEgk').rawText.replace(/\./g, ' ')
            const wordArray = articleBody.split(' ')
            let fixed = true
            for (let i = 0; i < wordArray.length; i++) {
              if (misspelledWord === wordArray[i]) {
                fixed = false
                if (moment(embedInfo.timestamp).isBefore(moment().subtract(3, 'hours'))) messageList[y].react('🚨') // React with a siren after 3 hours
                continue
              }
              if (fixed && i === wordArray.length - 1) {
                logger.log('FIXED', 'Author has fixed the misspelled word, moving embed to fixed errors log')
                messageList[y].delete()
                moveEmbed(embedInfo, 1441536, config.fixedWordChannelId)
              }
            }
          })
      }
    })
  })
}

function getUpdatedDictionary () {
  SpellChecker.getDictionary('sv-SE', './dict', (err, result) => {
    if (!err) {
      myDictionary = result
    } else {
      logger.log('DICTIONARY', 'Failed to grab latest version of the dictionary')
    }
  })
}

function moveEmbed (embedInfo, embedColor, toVoiceChannel) {
  const articleId = embedInfo.footer.text
  const articleTitle = embedInfo.author.name
  const articleUrl = embedInfo.url
  const authorEmail = embedInfo.title
  const misspelledWord = embedInfo.fields[0].value
  const correctWord = embedInfo.fields[1].value
  const embed = {
    'embed': {
      'title': authorEmail,
      'url': articleUrl,
      'color': embedColor,
      'author': {
        'name': articleTitle,
        'url': articleUrl
      },
      'timestamp': embedInfo.timestamp,
      'footer': {
        'text': articleId
      },
      'fields': [
        {
          'name': 'Misspelled word:',
          'value': misspelledWord
        },
        {
          'name': 'Correct word:',
          'value': correctWord
        }
      ]
    }
  }
  client.channels.get(toVoiceChannel).send('', embed)
}

function getAuthorByLink (authorLink) {
  const authorLinks = require('./authors.js')
  const authorInfo = authorLinks.authors.filter(author => author.id === authorLink)[0]
  return authorInfo
}
