"use strict";

const MAX_LOGS = 400;
const logs = [];

function addLog(message, category = "General") {
  const time = new Date().toLocaleTimeString();
  const entry = {
    id: Date.now() + Math.random(),
    time,
    category,
    message: typeof message === "object" ? JSON.stringify(message) : String(message),
    formatted: `[${time}] [${category}] ${typeof message === "object" ? JSON.stringify(message) : message}`
  };

  console.log(entry.formatted);
  logs.push(entry);

  if (logs.length > MAX_LOGS) {
    logs.shift();
  }
}

function getLogs() {
  return logs;
}

function clearLogs() {
  logs.length = 0;
}

module.exports = { addLog, getLogs, clearLogs };
