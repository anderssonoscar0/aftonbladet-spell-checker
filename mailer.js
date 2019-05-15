var nodemailer = require('nodemailer')

// Import config
const config = require('./config.js')

var transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: config.mailAdress,
    pass: config.mailPassword
  }
})

function mail (mailOptions) {
  transporter.sendMail(mailOptions, function (error, info) {
    if (error) {
      console.log(error)
    } else {
      console.log('Email sent: ' + info.response)
    }
  })
}

module.exports = {
  mail
}
