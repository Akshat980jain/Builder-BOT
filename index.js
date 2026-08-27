'use strict';

const express = require('express');
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { pyramid, tower, dome } = require('./src/shapes');
const { Builder } = require('./src/builder');

// ---------------------------------------------------------------------------
// Config & ViaProxy Bridge
// ---------------------------------------------------------------------------
// The bot connects to a local ViaProxy instance (started by start.sh in Docker)
// speaking standard 1.21.4 protocol, and ViaProxy translates all packets to 
// 26.2 (Protocol 776) on the wire to your real Aternos server.

const REAL_SERVER_HOST = process.env.MC_HOST || process.env.SERVER_HOST || 'localhost';
const REAL_SERVER_PORT = process.env.MC_PORT || process.env.SERVER_PORT || '25565';
const REAL_SERVER_VERSION = process.env.MC_VERSION || '26.2';

const VIAPROXY_HOST = '127.0.0.1';
const VIAPROXY_PORT = process.env.VIAPROXY_PORT || '25577';

const BOT_PROTOCOL_VERSION = process.env.BOT_PROTOCOL_VERSION || '1.21.4';
const BOT_USERNAME = process.env.BOT_USERNAME || process.env.BOT_NAME || 'BuilderBot';
const RECONNECT_DELAY_MS = 10_000;
const HTTP_PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Express Keep-Alive & Status Dashboard
// ---------------------------------------------------------------------------
const app = express();
let botStatus = 'Starting ViaProxy & Bot...';

app.get('/', (req, res) => {
  const botPos = bot && bot.entity ? `${Math.round(bot.entity.position.x)}, ${Math.round(bot.entity.position.y)}, ${Math.round(bot.entity.position.z)}` : 'Connecting...';
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Builder Bot - 24/7 Cloud Dashboard (26.2 Bridge)</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&display=swap" rel="stylesheet">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Outfit', sans-serif; }
        body { background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px; }
        .card { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 32px; width: 100%; max-width: 500px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
        .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
        .title { font-size: 24px; font-weight: 800; color: #f59e0b; display: flex; align-items: center; gap: 8px; }
        .badge { font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 999px; background: #0284c7; color: #fff; }
        .row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #334155; }
        .label { color: #94a3b8; font-size: 14px; }
        .val { font-weight: 600; font-size: 14px; color: #38bdf8; }
        .commands { margin-top: 20px; font-size: 13px; color: #94a3b8; }
        code { background: #0f172a; padding: 2px 6px; border-radius: 4px; color: #f59e0b; }
    </style>
</head>
<body>
    <div class="card">
        <div class="header">
            <div class="title">🤖 Builder Bot</div>
            <div class="badge">24/7 Cloud (26.2)</div>
        </div>
        <div class="row">
            <span class="label">Target Server:</span>
            <span class="val">${REAL_SERVER_HOST}:${REAL_SERVER_PORT} (26.2)</span>
        </div>
        <div class="row">
            <span class="label">Bot Name:</span>
            <span class="val">${BOT_USERNAME}</span>
        </div>
        <div class="row">
            <span class="label">Status:</span>
            <span class="val" style="color: ${botStatus.includes('Connected') || botStatus.includes('Online') ? '#4ade80' : '#f87171'}">${botStatus}</span>
        </div>
        <div class="row">
            <span class="label">World Position:</span>
            <span class="val">${botPos}</span>
        </div>

        <div class="commands">
            <b>In-Game Chat Commands:</b><br>
            <code>!pyramid &lt;size&gt;</code>, <code>!dome &lt;radius&gt;</code>, <code>!tower &lt;r&gt; &lt;h&gt;</code>, <code>!come</code>, <code>!undo</code>, <code>!stop</code>
        </div>
    </div>
</body>
</html>
  `);
});

app.listen(HTTP_PORT, () => {
  console.log(`[HTTP] Keep-alive dashboard listening on :${HTTP_PORT}`);
});

// ---------------------------------------------------------------------------
// Bot Lifecycle
// ---------------------------------------------------------------------------
let bot = null;
let builder = null;
let reconnectTimer = null;

function createBot() {
  console.log(
    `[Bot] Connecting to ViaProxy at ${VIAPROXY_HOST}:${VIAPROXY_PORT} ` +
      `as ${BOT_USERNAME} -> Real Server ${REAL_SERVER_HOST}:${REAL_SERVER_PORT} (v${REAL_SERVER_VERSION})...`
  );
  botStatus = `Connecting via ViaProxy to ${REAL_SERVER_HOST}:${REAL_SERVER_PORT}...`;

  bot = mineflayer.createBot({
    host: VIAPROXY_HOST,
    port: Number(VIAPROXY_PORT),
    username: BOT_USERNAME,
    version: BOT_PROTOCOL_VERSION,
    auth: process.env.MC_AUTH || 'offline',
    checkTimeoutInterval: 120000,
    keepAlive: true,
    hideErrors: true
  });

  bot.loadPlugin(pathfinder);
  builder = new Builder(bot, { blockName: process.env.BUILD_BLOCK || 'cobblestone' });

  bot.once('spawn', () => {
    botStatus = 'Online (In World)';
    console.log('[Bot] 🎉 Spawned successfully in Minecraft 26.2 world!');

    const defaultMove = new Movements(bot);
    bot.pathfinder.setMovements(defaultMove);

    setTimeout(() => {
      try {
        bot.chat(`🤖 ${BOT_USERNAME} online in 26.2! Commands: !pyramid <size>, !dome <r>, !tower <r> <h>, !come, !undo, !stop`);
      } catch (e) {}
    }, 1500);
  });

  bot.on('messagestr', (message) => {
    handleChatCommand(message);
  });

  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    handleCommandArgs(username, message);
  });

  bot.on('builder_place_error', (pos, err) => {
    console.warn(`[Builder] Failed to place at ${pos}: ${err.message}`);
  });

  bot.on('builder_undo_error', (pos, err) => {
    console.warn(`[Builder] Failed to undo at ${pos}: ${err.message}`);
  });

  bot.on('kicked', (reason) => {
    const reasonStr = typeof reason === 'object' ? JSON.stringify(reason) : String(reason);
    console.error('[Bot] Kicked:', reasonStr);
    botStatus = `Kicked: ${reasonStr}`;
    scheduleReconnect();
  });

  bot.on('error', (err) => {
    console.error('[Bot] Error:', err.message);
  });

  bot.on('end', (reason) => {
    botStatus = 'Disconnected. Retrying...';
    console.log(`[Bot] Disconnected (${reason}). Reconnecting in ${RECONNECT_DELAY_MS / 1000}s...`);
    scheduleReconnect();
  });
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    createBot();
  }, RECONNECT_DELAY_MS);
}

// ---------------------------------------------------------------------------
// Chat Command Handling
// ---------------------------------------------------------------------------
const CHAT_LINE_RE = /^<([^>]+)>\s*(.+)$/;

function handleChatCommand(message) {
  const clean = message.trim();
  console.log(`[Chat] ${clean}`);

  const match = clean.match(CHAT_LINE_RE);
  if (match) {
    const [, username, text] = match;
    if (username !== bot.username) {
      handleCommandArgs(username, text);
    }
    return;
  }

  if (clean.includes('!')) {
    const cmdIndex = clean.indexOf('!');
    const commandText = clean.substring(cmdIndex);
    handleCommandArgs('player', commandText);
  }
}

function handleCommandArgs(username, text) {
  if (!text.startsWith('!')) return;

  const args = text.trim().slice(1).split(/\s+/);
  const cmd = args.shift().toLowerCase();

  switch (cmd) {
    case 'pyramid':
      return runBuild(username, pyramid(parseInt(args[0], 10) || 5));
    case 'dome':
      return runBuild(username, dome(parseInt(args[0], 10) || 6));
    case 'tower':
      return runBuild(username, tower(parseInt(args[0], 10) || 2, parseInt(args[1], 10) || 10));
    case 'come':
      return comeToPlayer(username);
    case 'undo':
      return runUndo(username);
    case 'stop':
      return stopBuild(username);
    default:
      return;
  }
}

async function runBuild(requester, offsets) {
  if (builder.isBuilding()) {
    bot.chat(`Already building — send !stop first, ${requester}.`);
    return;
  }

  const player = bot.players[requester]?.entity;
  const origin = player ? player.position.floored() : bot.entity.position.floored();

  builder.enqueue(offsets, origin);
  bot.chat(`🏗 Building ${offsets.length} blocks near ${requester}...`);

  try {
    const result = await builder.run((placed, total, done) => {
      if (done) {
        bot.chat(`🎉 Build ${result?.cancelled ? 'cancelled' : 'complete'}: ${placed}/${total} placed.`);
      }
    });
    if (!result.cancelled) {
      bot.chat(`Done. Placed ${result.placed}/${result.total} blocks.`);
    }
  } catch (err) {
    bot.chat(`Build failed: ${err.message}`);
  }
}

async function runUndo(requester) {
  if (builder.isBuilding()) {
    bot.chat(`Can't undo mid-build — send !stop first, ${requester}.`);
    return;
  }
  bot.chat('⏪ Undoing last build...');
  const result = await builder.undo();
  bot.chat(`✔ Undo complete: removed ${result.undone}/${result.total} blocks.`);
}

function stopBuild(requester) {
  if (!builder.isBuilding()) {
    bot.chat(`Nothing in progress, ${requester}.`);
    return;
  }
  builder.cancel();
  bot.chat('⏹ Stopping after current block...');
}

async function comeToPlayer(requester) {
  const player = bot.players[requester]?.entity;
  if (!player) {
    bot.chat(`Can't see you, ${requester}. Stand closer.`);
    return;
  }
  const pos = player.position;
  bot.pathfinder.setGoal(new goals.GoalNear(pos.x, pos.y, pos.z, 2));
}

process.on('unhandledRejection', (err) => {
  console.error('[Process] Unhandled rejection:', err);
});

createBot();
