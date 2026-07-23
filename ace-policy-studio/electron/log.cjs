// Rolling main-process log — the raw material for Support tickets.
// Lives in userData/logs/main.log; rotates once past ~256 KB.
const fs = require('node:fs');
const path = require('node:path');

let logFile = null;

function initLog(app) {
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    logFile = path.join(dir, 'main.log');
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 256 * 1024) {
      fs.renameSync(logFile, `${logFile}.old`);
    }
  } catch {
    logFile = null;
  }
}

function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts
    .map((p) => {
      if (typeof p === 'string') return p;
      try {
        return JSON.stringify(p);
      } catch {
        return String(p);
      }
    })
    .join(' ')}\n`;
  try {
    if (logFile) fs.appendFileSync(logFile, line);
  } catch {
    // Logging must never break the app.
  }
}

function tail(lines = 200) {
  try {
    if (!logFile || !fs.existsSync(logFile)) return '(no log entries yet)';
    const txt = fs.readFileSync(logFile, 'utf8');
    return txt.split('\n').slice(-lines).join('\n').trim() || '(no log entries yet)';
  } catch (err) {
    return `(could not read log: ${String((err && err.message) || err)})`;
  }
}

module.exports = {
  initLog,
  log,
  tail,
  getLogPath: () => logFile,
};
