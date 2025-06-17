// src/utils/logger.js
const pino = require('pino');

const isProd = process.env.NODE_ENV === 'production';
const logLevel = process.env.LOG_LEVEL || (isProd ? 'info' : 'debug');

let options = { level: logLevel };

if (!isProd) {
  // Try to load pino-pretty – if it’s missing, fall back to raw JSON
  try {
    require.resolve('pino-pretty');
    options.transport = {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:standard' }
    };
  } catch {
    console.warn('▶ pino-pretty not installed – using JSON logs');
  }
}

const logger = pino(options);

module.exports = {
  log:   (...a) => logger.info(...a),
  warn:  (...a) => logger.warn(...a),
  error: (...a) => logger.error(...a),
  raw:   logger,
};
