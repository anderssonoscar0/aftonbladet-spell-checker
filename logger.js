const opts = {
  timestampFormat: 'YYYY-MM-DD HH:mm:ss'
}
const logger = require('simple-node-logger').createSimpleLogger(opts)

function log (logMessage) {
  logger.info(logMessage)
}

module.exports = {
  log
}
