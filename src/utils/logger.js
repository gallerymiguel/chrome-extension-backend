const pino = require("pino");

const isProd  = process.env.NODE_ENV === "production";
const logger  = pino(
  isProd
    ? { level: "info" }                // compact JSON for prod
    : { transport: {                  // human-readable in dev
        target: "pino-pretty",
        options: { colorize: true, translateTime: "SYS:standard" }
      }}
);

// quick aliases so existing console.* lines are easy to swap
module.exports = {
  log:   (...args) => logger.info(...args),
  warn:  (...args) => logger.warn(...args),
  error: (...args) => logger.error(...args),
  raw:   logger,                       // full pino instance if you need it
};
