const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();

function log(level, tag, message, extra) {
  if (LOG_LEVELS[level] < LOG_LEVELS[LEVEL]) return;
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level.toUpperCase()}] [${tag}] ${message}`;
  if (extra) {
    const suffix = typeof extra === 'string' ? extra : JSON.stringify(extra);
    console[level === 'error' ? 'error' : 'log'](line, suffix);
  } else {
    console[level === 'error' ? 'error' : 'log'](line);
  }
}

module.exports = {
  debug: (tag, msg, extra) => log('debug', tag, msg, extra),
  info: (tag, msg, extra) => log('info', tag, msg, extra),
  warn: (tag, msg, extra) => log('warn', tag, msg, extra),
  error: (tag, msg, extra) => log('error', tag, msg, extra),
};
