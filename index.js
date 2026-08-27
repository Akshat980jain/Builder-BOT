'use strict';

const express = require('express');
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { pyramid, tower, dome } = require('./src/shapes');
const { Builder } = require('./src/builder');

// ---------------------------------------------------------------------------
// Configuration & Environment Settings
// ---------------------------------------------------------------------------
const REAL_SERVER_HOST = process.env.MC_HOST || process.env.SERVER_HOST || 'localhost';
const REAL_SERVER_PORT = process.env.MC_PORT || process.env.SERVER_PORT || '25565';
const REAL_SERVER_VERSION = process.env.MC_VERSION || '26.2';

const VIAPROXY_HOST = '127.0.0.1';
const VIAPROXY_PORT = process.env.VIAPROXY_PORT || '25577';

const BOT_PROTOCOL_VERSION = process.env.BOT_PROTOCOL_VERSION || '1.21.4';
const BOT_USERNAME = process.env.BOT_USERNAME || process.env.BOT_NAME || 'BuilderBot';
const BOT_PASSWORD = process.env.BOT_PASSWORD || process.env.AUTH_PASSWORD || '';
const HTTP_PORT = process.env.PORT || 3000;

// Logging buffer for the Web Console
const webLogs = [];
function logSystem(msg) {
  const timestamp = new Date().toLocaleTimeString();
  const entry = `[${timestamp}] ${msg}`;
  console.log(entry);
  webLogs.push(entry);
  if (webLogs.length > 80) webLogs.shift();
}

// ---------------------------------------------------------------------------
// Express Keep-Alive & Interactive Web Command Center
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());

let bot = null;
let builder = null;
let reconnectTimer = null;
let botStatus = 'Starting ViaProxy & Bot...';
let reconnectAttempts = 0;

app.get('/api/status', (req, res) => {
  const pos = bot && bot.entity ? bot.entity.position : null;
  res.json({
    status: botStatus,
    username: BOT_USERNAME,
    target: `${REAL_SERVER_HOST}:${REAL_SERVER_PORT}`,
    version: REAL_SERVER_VERSION,
    health: bot ? Math.round(bot.health || 20) : 0,
    food: bot ? Math.round(bot.food || 20) : 0,
    position: pos ? { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) } : null,
    logs: webLogs
  });
});

app.post('/api/command', (req, res) => {
  const cmd = (req.body.command || '').trim();
  if (!cmd) return res.json({ success: false, msg: 'Empty command.' });

  logSystem(`[Web Console] > ${cmd}`);

  if (cmd.startsWith('!')) {
    handleCommandArgs('WebAdmin', cmd);
    return res.json({ success: true, msg: `Executed build command: ${cmd}` });
  }

  if (cmd.startsWith('/')) {
    safeChat(cmd);
    return res.json({ success: true, msg: `Sent server command: ${cmd}` });
  }

  safeChat(cmd);
  return res.json({ success: true, msg: `Sent chat: ${cmd}` });
});

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>BuilderBot - 24/7 Command Center</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Outfit', sans-serif; }
        body { background: #090d16; color: #f1f5f9; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 16px; }
        .dashboard { width: 100%; max-width: 680px; background: #111827; border: 1px solid #1f2937; border-radius: 20px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7); overflow: hidden; }
        .header { background: linear-gradient(135deg, #1e1b4b 0%, #1e293b 100%); padding: 24px; border-bottom: 1px solid #334155; display: flex; justify-content: space-between; align-items: center; }
        .title-group h1 { font-size: 22px; font-weight: 800; color: #fbbf24; display: flex; align-items: center; gap: 8px; }
        .title-group p { font-size: 13px; color: #94a3b8; margin-top: 4px; }
        .badge { padding: 6px 14px; border-radius: 9999px; font-size: 12px; font-weight: 700; background: #059669; color: #fff; letter-spacing: 0.5px; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; padding: 20px; background: #0f172a; border-bottom: 1px solid #1f2937; }
        .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 14px; text-align: center; }
        .card-label { font-size: 11px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
        .card-val { font-size: 16px; font-weight: 700; color: #38bdf8; margin-top: 4px; }
        .console-section { padding: 20px; }
        .console-header { font-size: 13px; font-weight: 700; color: #cbd5e1; margin-bottom: 10px; display: flex; justify-content: space-between; }
        .terminal { background: #030712; border: 1px solid #1f2937; border-radius: 12px; height: 220px; padding: 14px; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #a5f3fc; overflow-y: auto; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
        .command-bar { display: flex; gap: 8px; margin-top: 14px; }
        .cmd-input { flex: 1; background: #030712; border: 1px solid #334155; border-radius: 10px; padding: 12px 16px; color: #f8fafc; font-family: 'JetBrains Mono', monospace; font-size: 13px; outline: none; transition: border-color 0.2s; }
        .cmd-input:focus { border-color: #38bdf8; }
        .send-btn { background: #2563eb; color: #fff; border: none; border-radius: 10px; padding: 0 20px; font-weight: 700; font-size: 14px; cursor: pointer; transition: background 0.2s; }
        .send-btn:hover { background: #1d4ed8; }
        .quick-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
        .quick-btn { background: #1e293b; border: 1px solid #334155; color: #cbd5e1; border-radius: 8px; padding: 6px 12px; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.2s; }
        .quick-btn:hover { background: #334155; color: #38bdf8; }
    </style>
</head>
<body>
    <div class="dashboard">
        <div class="header">
            <div class="title-group">
                <h1>🤖 BuilderBot 24/7</h1>
                <p>Autonomous Builder & AFK Server Keeper (Protocol 776 / 26.2)</p>
            </div>
            <div id="statusBadge" class="badge">Starting...</div>
        </div>

        <div class="grid">
            <div class="card">
                <div class="card-label">Target Server</div>
                <div id="targetServer" class="card-val">${REAL_SERVER_HOST}:${REAL_SERVER_PORT}</div>
            </div>
            <div class="card">
                <div class="card-label">Health / Food</div>
                <div id="healthFood" class="card-val">20 ❤️ | 20 🍗</div>
            </div>
            <div class="card">
                <div class="card-label">Coordinates</div>
                <div id="coords" class="card-val">~, ~, ~</div>
            </div>
        </div>

        <div class="console-section">
            <div class="console-header">
                <span>Live Bot Console & Log Feed</span>
                <span style="color:#64748b; font-size:11px;">Auto-Refreshing</span>
            </div>
            <div id="terminal" class="terminal">Connecting to log stream...</div>

            <div class="command-bar">
                <input id="cmdInput" class="cmd-input" type="text" placeholder="Type !pyramid 8, !dome 6, !come, /say hello, or server commands..." onkeydown="if(event.key==='Enter') sendCmd()">
                <button class="send-btn" onclick="sendCmd()">Send</button>
            </div>

            <div class="quick-actions">
                <button class="quick-btn" onclick="sendQuick('!come')">🏃 !come</button>
                <button class="quick-btn" onclick="sendQuick('!pyramid 5')">🔺 !pyramid 5</button>
                <button class="quick-btn" onclick="sendQuick('!dome 6')">🌐 !dome 6</button>
                <button class="quick-btn" onclick="sendQuick('!tower 3 10')">🗼 !tower 3 10</button>
                <button class="quick-btn" onclick="sendQuick('!undo')">⏪ !undo</button>
                <button class="quick-btn" onclick="sendQuick('!stop')">⏹ !stop</button>
            </div>
        </div>
    </div>

    <script>
        async function fetchStatus() {
            try {
                const res = await fetch('/api/status');
                const data = await res.json();
                
                const badge = document.getElementById('statusBadge');
                badge.innerText = data.status;
                badge.style.background = (data.status.includes('Online') || data.status.includes('World')) ? '#059669' : '#dc2626';

                document.getElementById('healthFood').innerText = (data.health || 20) + ' ❤️ | ' + (data.food || 20) + ' 🍗';
                document.getElementById('coords').innerText = data.position ? (data.position.x + ', ' + data.position.y + ', ' + data.position.z) : 'Connecting...';

                const term = document.getElementById('terminal');
                term.innerText = (data.logs || []).join('\\n');
                term.scrollTop = term.scrollHeight;
            } catch (e) {}
        }

        async function sendCmd() {
            const input = document.getElementById('cmdInput');
            const command = input.value.trim();
            if (!command) return;
            input.value = '';

            await fetch('/api/command', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ command })
            });
            fetchStatus();
        }

        function sendQuick(cmd) {
            document.getElementById('cmdInput').value = cmd;
            sendCmd();
        }

        setInterval(fetchStatus, 2500);
        fetchStatus();
    </script>
</body>
</html>
  `);
});

app.listen(HTTP_PORT, () => {
  logSystem(`[HTTP] Keep-Alive & Command Center listening on :${HTTP_PORT}`);
});

// ---------------------------------------------------------------------------
// Bot Lifecycle & Survival Automation
// ---------------------------------------------------------------------------
function safeChat(msg) {
  if (!bot) return;
  try {
    bot.chat(msg);
  } catch (e) {
    logSystem(`[Bot Chat Notice] ${e.message}`);
  }
}

// Auto-Eat System (From SoloPlayz)
function handleAutoEat() {
  if (!bot || bot.food >= 16) return;
  const foodItem = bot.inventory.items().find(i => 
    i.name.includes('bread') || i.name.includes('apple') || i.name.includes('cooked') || 
    i.name.includes('steak') || i.name.includes('porkchop') || i.name.includes('carrot') || i.name.includes('baked_potato')
  );
  if (foodItem) {
    bot.equip(foodItem, 'hand').then(() => {
      bot.consume().then(() => {
        logSystem(`[Survival] Bot auto-consumed ${foodItem.name} (Food: ${bot.food}/20)`);
      }).catch(() => {});
    }).catch(() => {});
  }
}

// Hostile Mob Defense System (From SoloPlayz)
function handleMobDefense() {
  if (!bot || !bot.entity || (builder && builder.isBuilding())) return;
  const hostile = bot.nearestEntity(e => {
    if (!e || e.type !== 'mob') return false;
    const name = (e.name || '').toLowerCase();
    return name.includes('zombie') || name.includes('skeleton') || name.includes('spider') || name.includes('creeper');
  });

  if (hostile && hostile.position.distanceTo(bot.entity.position) < 3.5) {
    const weapon = bot.inventory.items().find(i => i.name.includes('sword') || i.name.includes('axe'));
    if (weapon) bot.equip(weapon, 'hand').catch(() => {});
    bot.attack(hostile);
    logSystem(`[Defense] Attacked nearby hostile mob: ${hostile.name}`);
  }
}

function createBot() {
  logSystem(`[Bot] Connecting to ViaProxy at ${VIAPROXY_HOST}:${VIAPROXY_PORT} -> Real Server ${REAL_SERVER_HOST}:${REAL_SERVER_PORT} (v${REAL_SERVER_VERSION})...`);
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
    reconnectAttempts = 0;
    logSystem('[Bot] 🎉 Spawned successfully in Minecraft 26.2 world!');

    const defaultMove = new Movements(bot);
    bot.pathfinder.setMovements(defaultMove);

    // Auto-Auth Login Support (From SoloPlayz)
    if (BOT_PASSWORD) {
      setTimeout(() => {
        safeChat(`/login ${BOT_PASSWORD}`);
        safeChat(`/register ${BOT_PASSWORD} ${BOT_PASSWORD}`);
        logSystem('[Auth] Auto-login credentials sent.');
      }, 1000);
    }

    setTimeout(() => {
      safeChat(`🤖 ${BOT_USERNAME} online in 26.2! Commands: !pyramid <size>, !dome <r>, !tower <r> <h>, !come, !undo, !stop`);
    }, 2000);
  });

  // Survival Interval Hooks
  bot.on('health', () => {
    handleAutoEat();
  });

  const defenseInterval = setInterval(() => {
    if (bot && bot.entity) handleMobDefense();
  }, 1500);

  bot.on('messagestr', (message) => {
    handleChatCommand(message);
  });

  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    handleCommandArgs(username, message);
  });

  bot.on('builder_place_error', (pos, err) => {
    logSystem(`[Builder Error] Failed at ${pos}: ${err.message}`);
  });

  bot.on('builder_undo_error', (pos, err) => {
    logSystem(`[Undo Error] Failed at ${pos}: ${err.message}`);
  });

  bot.on('kicked', (reason) => {
    const reasonStr = typeof reason === 'object' ? JSON.stringify(reason) : String(reason);
    logSystem(`[Bot Kicked] ${reasonStr}`);
    botStatus = `Kicked: ${reasonStr}`;
    clearInterval(defenseInterval);
    scheduleReconnect('kicked');
  });

  bot.on('error', (err) => {
    logSystem(`[Bot Error] ${err.message}`);
  });

  bot.on('end', (reason) => {
    botStatus = 'Disconnected. Retrying...';
    logSystem(`[Bot Disconnected] Reason: ${reason}. Scheduling smart reconnect...`);
    clearInterval(defenseInterval);
    scheduleReconnect('end');
  });
}

// Anti-Throttle Smart Reconnect (From SoloPlayz)
function scheduleReconnect(reason) {
  if (reconnectTimer) return;
  reconnectAttempts++;

  // Fast reconnect 8-15s, exponential backoff if throttled
  let delay = 10000;
  if (reconnectAttempts > 3) delay = 20000;
  if (reconnectAttempts > 6) delay = 35000;

  logSystem(`[Reconnect] Attempt ${reconnectAttempts} in ${Math.round(delay / 1000)}s (Trigger: ${reason})`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    createBot();
  }, delay);
}

// ---------------------------------------------------------------------------
// Chat & Construction Command Processing
// ---------------------------------------------------------------------------
const CHAT_LINE_RE = /^<([^>]+)>\s*(.+)$/;

function handleChatCommand(message) {
  const clean = message.trim();
  logSystem(`[Chat] ${clean}`);

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
    safeChat(`Already building — send !stop first, ${requester}.`);
    return;
  }

  const player = bot.players[requester]?.entity;
  const origin = player ? player.position.floored() : bot.entity.position.floored();

  builder.enqueue(offsets, origin);
  safeChat(`🏗 Building ${offsets.length} blocks near ${requester}...`);
  logSystem(`[Builder] Started construction of ${offsets.length} blocks requested by ${requester}`);

  try {
    const result = await builder.run((placed, total, done) => {
      if (done) {
        safeChat(`🎉 Build ${result?.cancelled ? 'cancelled' : 'complete'}: ${placed}/${total} placed.`);
      }
    });
    if (!result.cancelled) {
      safeChat(`Done. Placed ${result.placed}/${result.total} blocks.`);
      logSystem(`[Builder] Finished build: ${result.placed}/${result.total} placed.`);
    }
  } catch (err) {
    safeChat(`Build failed: ${err.message}`);
    logSystem(`[Builder Error] ${err.message}`);
  }
}

async function runUndo(requester) {
  if (builder.isBuilding()) {
    safeChat(`Can't undo mid-build — send !stop first, ${requester}.`);
    return;
  }
  safeChat('⏪ Undoing last build...');
  const result = await builder.undo();
  safeChat(`✔ Undo complete: removed ${result.undone}/${result.total} blocks.`);
  logSystem(`[Builder Undo] Undone ${result.undone}/${result.total} blocks.`);
}

function stopBuild(requester) {
  if (!builder.isBuilding()) {
    safeChat(`Nothing in progress, ${requester}.`);
    return;
  }
  builder.cancel();
  safeChat('⏹ Stopping after current block...');
  logSystem(`[Builder] Build cancelled by ${requester}`);
}

async function comeToPlayer(requester) {
  const player = bot.players[requester]?.entity;
  if (!player) {
    safeChat(`Can't see you, ${requester}. Stand closer.`);
    return;
  }
  const pos = player.position;
  bot.pathfinder.setGoal(new goals.GoalNear(pos.x, pos.y, pos.z, 2));
  logSystem(`[Movement] Pathfinding to player ${requester} at (${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)})`);
}

process.on('unhandledRejection', (err) => {
  logSystem(`[Process Error] ${err.message}`);
});

createBot();
