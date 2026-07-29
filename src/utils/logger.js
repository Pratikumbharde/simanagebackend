const fs = require('fs');
const path = require('path');

const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const getTimestamp = () => new Date().toISOString();

const formatMessage = (level, message, meta = {}) => {
  const timestamp = getTimestamp();
  const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
  return `[${timestamp}] ${level.toUpperCase()}: ${message}${metaStr}\n`;
};

const logger = {
  info: (message, meta = {}) => {
    const logMessage = formatMessage('info', message, meta);
    console.log('\x1b[36m%s\x1b[0m', logMessage.trim());
    appendToFile('app.log', logMessage);
  },

  error: (message, meta = {}) => {
    const logMessage = formatMessage('error', message, meta);
    console.error('\x1b[31m%s\x1b[0m', logMessage.trim());
    appendToFile('error.log', logMessage);
  },

  warn: (message, meta = {}) => {
    const logMessage = formatMessage('warn', message, meta);
    console.warn('\x1b[33m%s\x1b[0m', logMessage.trim());
    appendToFile('app.log', logMessage);
  },

  debug: (message, meta = {}) => {
    if (process.env.NODE_ENV === 'development') {
      const logMessage = formatMessage('debug', message, meta);
      console.log('\x1b[35m%s\x1b[0m', logMessage.trim());
      appendToFile('debug.log', logMessage);
    }
  },
};

const appendToFile = (filename, content) => {
  const logFile = path.join(logsDir, filename);
  fs.appendFileSync(logFile, content);
};

module.exports = logger;