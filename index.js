'use strict';

// Self-healing check for broken dependencies on cloud hosts with stale build caches
try {
  require('smart-buffer');
} catch (e) {
  console.log('[System] smart-buffer missing or corrupt in build cache, self-healing now...');
  try {
    require('child_process').execSync('npm install smart-buffer@4.2.0 --force', { stdio: 'inherit' });
    console.log('[System] smart-buffer successfully repaired.');
  } catch (err) {
    console.error('[System] Failed to auto-repair smart-buffer:', err.message);
  }
}

const express = require('express');
const multer = require('multer');
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const nbt = require('prismarine-nbt');
const zlib = require('zlib');
const path = require('path');
const fs = require('fs');

let config = {};
try {
  config = require('./settings.json');
} catch (e) {
  config = {
    server: { ip: 'akshat908-qceo.aternos.me', port: 14539, version: '1.21.4', tryCreative: true },
    bot: { username: 'BuilderBot', password: '', type: 'offline' },
    swarm: { enabled: true, targetCount: 10, autoSpawnAll: true, staggerJoinDelay: 6000, autoAuthPassword: 'chalol78', antiAfk: true },
    utils: { 'auto-auth': { enabled: true, password: 'chalol78' }, 'auto-reconnect': true }
  };
}

const { Builder } = require('./src/builder');
const { SwarmManager } = require('./src/swarm');
const { installChatCompat } = require('./src/chatCompat');
const { installFabricSpoof } = require('./src/fabricSpoof');
const { installPacketDebugger } = require('./src/debugPackets');
const { parseLitematicBlocks, parseStructureNbtBlocks, parseLegacySchematicBlocks } = require('./src/schematic');

// ---------------------------------------------------------------------------
// Configuration Resolution
// ---------------------------------------------------------------------------
const USE_VIAPROXY = config.server?.viaProxy?.enabled || false;
const REAL_SERVER_HOST = process.env.SERVER_HOST || process.env.MC_HOST || config.server?.ip || 'akshat908-qceo.aternos.me';
const REAL_SERVER_PORT = process.env.SERVER_PORT || process.env.MC_PORT || config.server?.port || 14539;
const REAL_SERVER_VERSION = process.env.BOT_VERSION || process.env.MC_VERSION || config.server?.version || '1.21.4';

const TARGET_HOST = USE_VIAPROXY ? (config.server.viaProxy.host || '127.0.0.1') : REAL_SERVER_HOST;
const TARGET_PORT = USE_VIAPROXY ? Number(config.server.viaProxy.port || 25577) : Number(REAL_SERVER_PORT);
const TARGET_VERSION = USE_VIAPROXY ? '1.21.4' : (REAL_SERVER_VERSION !== 'auto' ? REAL_SERVER_VERSION : false);

const BOT_USERNAME = process.env.BOT_NAME || process.env.BOT_USERNAME || config.bot?.username || 'BuilderBot';
const RECONNECT_DELAY_MS = config.utils?.['auto-reconnect-delay'] || 15000;
const DUPLICATE_LOGIN_RECONNECT_DELAY_MS = 20000;
const THROTTLE_RECONNECT_DELAY_MS = 90000;   // 90s when server throttles us
const MAX_RECONNECT_DELAY_MS = config.utils?.['max-reconnect-delay'] || 120000;
const HTTP_PORT = Number(process.env.PORT) || config.web?.port || 8080;
let reconnectAttempts = 0; // tracks consecutive failures for backoff

// ---------------------------------------------------------------------------
// Express Keep-Alive, Swarm Management & Schematic Web Server
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());

// Immediate Health Check & Ping routes for Render port detection
app.get(['/healthz', '/health', '/ping'], (req, res) => res.status(200).send('OK'));
app.head('*', (req, res) => res.status(200).end());

let botStatus = 'starting';
const logs = [];

function logSystem(msg) {
  const time = new Date().toLocaleTimeString();
  const entry = `[${time}] ${msg}`;
  logs.push(entry);
  if (logs.length > 200) logs.shift();
  console.log(entry);
}

// Start HTTP server immediately on 0.0.0.0 so Render detects open port in <2s!
const server = app.listen(HTTP_PORT, '0.0.0.0', () => {
  logSystem(`[HTTP] Builder Bot Dashboard & Swarm Server listening on 0.0.0.0:${HTTP_PORT}`);
  console.log(`==> Server listening on 0.0.0.0:${HTTP_PORT}`);
});
server.keepAliveTimeout = 120000;
server.headersTimeout = 125000;

const SCHEMATICS_DIR = process.env.SCHEMATICS_DIR || path.join(__dirname, 'schematics');
fs.mkdirSync(SCHEMATICS_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: SCHEMATICS_DIR,
    filename: (req, file, cb) => cb(null, path.basename(file.originalname)),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(litematic|nbt|schem|schematic)$/i.test(file.originalname);
    cb(ok ? null : new Error('Only .litematic and .nbt files are accepted'), ok);
  },
});

app.post('/schematics/upload', upload.single('schematic'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received (field name must be "schematic")' });
  logSystem(`[Schematics] Received upload: ${req.file.originalname} (${req.file.size} bytes)`);
  res.json({ ok: true, name: req.file.originalname });
});

app.get('/schematics', (req, res) => {
  const files = fs.readdirSync(SCHEMATICS_DIR).filter((f) => /\.(litematic|nbt|schem|schematic)$/i.test(f));
  res.json({ files });
});

// Swarm Fleet API Endpoints
app.get('/api/swarm/status', (req, res) => {
  if (swarm) return res.json(swarm.getSwarmStatus());
  res.json([]);
});

app.post('/api/swarm/spawn', async (req, res) => {
  const count = parseInt(req.body.count, 10) || 10;
  if (swarm) await swarm.setWorkerCount(count);
  res.json({ success: true, message: `Swarm fleet set to ${count} builder bots.` });
});

app.post('/api/swarm/reconnect', (req, res) => {
  const id = parseInt(req.body.id, 10);
  if (swarm && !isNaN(id)) {
    swarm.enqueueReconnect(id, 0);
    return res.json({ success: true, message: `Bot ${id} scheduled for reconnect.` });
  }
  res.json({ success: false, message: 'Invalid bot ID' });
});

app.post('/api/swarm/stop', (req, res) => {
  if (swarm) swarm.cancelAll();
  if (builder) builder.cancel();
  res.json({ success: true, message: 'Swarm operations stopped.' });
});

app.get('/api/schematics', (req, res) => {
  const files = listSchematicFiles();
  res.json({
    schematics: files.map((f, i) => ({
      index: i + 1,
      filename: f,
      name: f.replace(/\.(litematic|nbt|schematic)$/i, '')
    }))
  });
});

app.post('/api/build/schematic', async (req, res) => {
  const { name, origin, rotation = 0, swarmCount } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Missing schematic name' });
  }
  if (!builder) {
    return res.status(400).json({ error: 'Builder is not connected' });
  }

  if (swarmCount && Number(swarmCount) > 1 && swarm) {
    await swarm.setWorkerCount(Number(swarmCount));
  }

  let explicitOrigin = null;
  if (origin && typeof origin.x === 'number' && typeof origin.y === 'number' && typeof origin.z === 'number') {
    explicitOrigin = new Vec3(Number(origin.x), Number(origin.y), Number(origin.z));
  }

  runSchematicBuild('WebUser', name, { origin: explicitOrigin, rotation: Number(rotation) || 0 });
  res.json({ ok: true, message: `Dispatched schematic build for "${name}"` });
});

app.post('/api/command', async (req, res) => {
  const { command } = req.body;
  if (!command || typeof command !== 'string') {
    return res.status(400).json({ error: 'Missing command' });
  }
  logSystem(`[Web Console] Executing: ${command}`);
  const clean = command.trim().startsWith('!') ? command.trim() : '!' + command.trim();
  handleChatLine('WebConsole', clean);
  res.json({ ok: true, message: `Command executed: ${clean}` });
});


app.get('/api/status', (req, res) => {
  const pos = bot?.entity ? bot.entity.position.floored() : null;
  res.json({
    status: botStatus,
    username: BOT_USERNAME,
    health: bot?.health ?? 20,
    food: bot?.food ?? 20,
    position: pos ? { x: pos.x, y: pos.y, z: pos.z } : null,
    isBuilding: builder?.isBuilding() ?? false,
    workers: swarm?.getWorkerCount() ?? 1,
    gameMode: bot?.game?.gameMode ?? 'creative',
    logs,
  });
});

app.get('/logs', (req, res) => {
  res.json(logs);
});

// Full-Featured Web Dashboard
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${config.name || "Builder Bot"} Dashboard & 10-Bot Swarm Control</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0a0e17;
      --card-bg: rgba(18, 25, 41, 0.75);
      --border: rgba(255, 255, 255, 0.08);
      --accent: #38bdf8;
      --accent-glow: rgba(56, 189, 248, 0.25);
      --accent-purple: #a855f7;
      --success: #10b981;
      --danger: #ef4444;
      --warning: #f59e0b;
      --text: #f8fafc;
      --text-muted: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Outfit', sans-serif;
      background: radial-gradient(circle at 15% 15%, #131d31 0%, var(--bg) 95%);
      color: var(--text);
      min-height: 100vh;
      padding: 24px;
    }
    .container { max-width: 1240px; margin: 0 auto; }
    header {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--border);
    }
    .logo {
      font-size: 26px; font-weight: 800;
      background: linear-gradient(135deg, #38bdf8, #818cf8, #c084fc);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    }
    .nav-tabs { display: flex; gap: 8px; }
    .tab-btn {
      background: rgba(255,255,255,0.05); border: 1px solid var(--border); color: var(--text-muted);
      padding: 8px 18px; border-radius: 10px; font-weight: 700; cursor: pointer; transition: all 0.2s;
    }
    .tab-btn.active, .tab-btn:hover { background: var(--accent); color: #000; box-shadow: 0 0 12px var(--accent-glow); }
    .status-badge {
      display: inline-flex; align-items: center; gap: 8px; padding: 8px 16px; border-radius: 9999px;
      font-weight: 600; font-size: 14px; background: rgba(0,0,0,0.5); border: 1px solid var(--border);
    }
    .status-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--danger); }
    .status-dot.online { background: var(--success); box-shadow: 0 0 10px var(--success); }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
    @media (max-width: 900px) { .grid-2 { grid-template-columns: 1fr; } }
    .card {
      background: var(--card-bg); backdrop-filter: blur(16px); border: 1px solid var(--border);
      border-radius: 16px; padding: 22px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); margin-bottom: 20px;
    }
    .card h2 { font-size: 18px; margin-bottom: 16px; color: var(--accent); font-weight: 700; display: flex; align-items: center; gap: 8px; }
    .cmd-btn {
      background: var(--accent); color: #000; border: none; padding: 12px 20px; border-radius: 10px;
      font-weight: 700; cursor: pointer; transition: all 0.2s;
    }
    .cmd-btn:hover { filter: brightness(1.1); transform: scale(1.02); }
    .fleet-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; margin-top: 16px; }
    .bot-card { background: rgba(0,0,0,0.35); border: 1px solid var(--border); border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 8px; transition: all 0.2s; }
    .bot-card.online { border-color: rgba(16, 185, 129, 0.4); box-shadow: 0 0 10px rgba(16, 185, 129, 0.1); }
    .bot-card.connecting { border-color: rgba(245, 158, 11, 0.4); }
    .bot-card.offline { border-color: rgba(239, 68, 68, 0.2); opacity: 0.8; }
    .bot-card-header { display: flex; justify-content: space-between; align-items: center; }
    .bot-title { font-weight: 700; font-size: 14px; display: flex; align-items: center; gap: 6px; }
    .bot-badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; font-weight: 700; }
    .bot-badge.online { background: rgba(16, 185, 129, 0.2); color: #10b981; }
    .bot-badge.connecting { background: rgba(245, 158, 11, 0.2); color: #f59e0b; }
    .bot-badge.offline { background: rgba(239, 68, 68, 0.2); color: #ef4444; }
    .bot-meta { display: grid; grid-template-columns: 1fr 1fr; font-size: 12px; gap: 4px; color: var(--text-muted); }
    .bot-meta b { color: #fff; font-family: 'JetBrains Mono', monospace; }
    .btn-mini { background: rgba(56, 189, 248, 0.15); border: 1px solid var(--accent); color: var(--accent); border-radius: 6px; padding: 4px 10px; font-size: 11px; font-weight: 700; cursor: pointer; }
    .btn-mini:hover { background: var(--accent); color: #000; }
    .terminal {
      background: #05070d; border: 1px solid var(--border); border-radius: 12px; height: 300px;
      overflow-y: auto; padding: 14px; font-family: 'JetBrains Mono', monospace; font-size: 13px;
      line-height: 1.5; color: #a6adbb; display: flex; flex-direction: column-reverse;
    }
    .cmd-bar { display: flex; gap: 10px; margin-top: 12px; }
    .cmd-input {
      flex: 1; background: rgba(0,0,0,0.4); border: 1px solid var(--border); border-radius: 10px;
      padding: 12px 16px; color: #fff; font-family: 'JetBrains Mono', monospace; font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <div class="logo">🏗️ ${config.name || "Minecraft Builder Bot"}</div>
        <p style="color: var(--text-muted); font-size: 13px; margin-top: 4px;">Server: <b>${TARGET_HOST}:${TARGET_PORT}</b> (v${REAL_SERVER_VERSION})</p>
      </div>
      <div style="display: flex; align-items: center; gap: 14px;">
        <div class="nav-tabs">
          <button id="btn-tab-fleet" class="tab-btn active" onclick="switchTab('fleet')">🤖 10-Bot Swarm Fleet</button>
          <button id="btn-tab-builder" class="tab-btn" onclick="switchTab('builder')">🏛️ Shapes & Schematics</button>
          <button id="btn-tab-console" class="tab-btn" onclick="switchTab('console')">📜 Live Console</button>
        </div>
        <div class="status-badge">
          <div id="statusDot" class="status-dot"></div>
          <span id="statusText">Connecting...</span>
        </div>
      </div>
    </header>

    <!-- TAB 1: 10-BOT SWARM FLEET -->
    <div id="tab-fleet" class="tab-content active">
      <div class="card">
        <h2>🤖 10-Bot Swarm Fleet Live Status & 24/7 Supervisor</h2>
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 14px; background: rgba(0,0,0,0.25); padding: 14px; border-radius: 12px; border: 1px solid var(--border);">
          <div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap;">
            <div class="status-badge"><span style="color: var(--accent); font-weight: 700;">Fleet Target:</span> <span>10 Builder Bots</span></div>
            <div class="status-badge"><span style="color: var(--success); font-weight: 700;">Active Online:</span> <span id="fleetActiveCount" style="font-weight: 800; color: #10b981;">0 / 10</span></div>
            <div class="status-badge"><span style="color: #c084fc; font-weight: 700;">Supervisor:</span> <span>24/7 Self-Healing Active</span></div>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="cmd-btn" style="background: var(--success); color: #000;" onclick="spawnAllSwarm()">⚡ Connect All 10 Bots</button>
            <button class="cmd-btn" style="background: rgba(239,68,68,0.2); border: 1px solid var(--danger); color: var(--danger);" onclick="stopAllSwarm()">🛑 Stop All</button>
          </div>
        </div>
        <div id="fleetCardsContainer" class="fleet-grid">
          <!-- 10 bot cards dynamically populated -->
        </div>
      </div>
    </div>

    <!-- TAB 2: SHAPES & SCHEMATICS -->
    <div id="tab-builder" class="tab-content">
      <div class="grid-2">
        <div class="card">
          <h2>📁 Build from Schematic (Choose from Options)</h2>
          <p style="color: var(--text-muted); font-size: 13px; margin-bottom: 12px;">Select any loaded schematic to build collaboratively with your bot workforce:</p>
          <div style="margin-bottom: 12px;">
            <label style="display:block; font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">Schematic Options:</label>
            <select id="schematicSelect" style="width: 100%; background: rgba(0,0,0,0.5); border: 1px solid var(--border); color: #fff; padding: 10px 12px; border-radius: 8px; font-family: inherit; font-size: 14px;">
              <option value="">Loading schematics...</option>
            </select>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px;">
            <div>
              <label style="display:block; font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">Rotation:</label>
              <select id="schematicRot" style="width: 100%; background: rgba(0,0,0,0.5); border: 1px solid var(--border); color: #fff; padding: 8px; border-radius: 8px;">
                <option value="0">0° (Default)</option>
                <option value="90">90° Clockwise</option>
                <option value="180">180° Half Turn</option>
                <option value="270">270° Counter-CW</option>
              </select>
            </div>
            <div>
              <label style="display:block; font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">Workers (1..10):</label>
              <input id="schematicWorkers" type="number" min="1" max="10" value="3" style="width: 100%; background: rgba(0,0,0,0.5); border: 1px solid var(--border); color: #fff; padding: 8px; border-radius: 8px;">
            </div>
          </div>
          <button class="cmd-btn" style="width: 100%; background: var(--accent); color: #000; font-weight: 800;" onclick="buildSelectedSchematic()">🏗️ Build Selected Schematic</button>
        </div>

        <div class="card">
          <h2>📁 Upload New Schematic</h2>
          <p style="color: var(--text-muted); font-size: 13px; margin-bottom: 16px;">Upload a .litematic or .nbt structure file to build:</p>
          <input type="file" id="schemFile" accept=".litematic,.nbt,.schematic,.schem" style="margin-bottom: 12px; color: var(--text-muted); width: 100%;">
          <button class="cmd-btn" style="background: rgba(255,255,255,0.1); color: #fff;" onclick="uploadSchematic()">Upload to Server</button>
        </div>
      </div>
    </div>

    <!-- TAB 3: CONSOLE -->
    <div id="tab-console" class="tab-content">
      <div class="card">
        <h2>📜 Live Console & Commands</h2>
        <div id="terminal" class="terminal"></div>
        <div class="cmd-bar">
          <input id="cmdInput" class="cmd-input" type="text" placeholder="Type in-game command (e.g. !schematic <name>, !status, !stop, !swarm 10)..." onkeydown="if(event.key==='Enter') executeCommand()">
          <button class="cmd-btn" onclick="executeCommand()">Send</button>
        </div>
      </div>
    </div>
  </div>

  <script>
    function switchTab(tab) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

      if (tab === 'fleet') {
        document.getElementById('btn-tab-fleet').classList.add('active');
        document.getElementById('tab-fleet').classList.add('active');
        updateFleetStatus();
      } else if (tab === 'builder') {
        document.getElementById('btn-tab-builder').classList.add('active');
        document.getElementById('tab-builder').classList.add('active');
        loadSchematicsList();
      } else {
        document.getElementById('btn-tab-console').classList.add('active');
        document.getElementById('tab-console').classList.add('active');
      }
    }

    async function updateFleetStatus() {
      try {
        const res = await fetch('/api/swarm/status');
        const bots = await res.json();
        const container = document.getElementById('fleetCardsContainer');
        if (!container || !Array.isArray(bots)) return;

        const onlineCount = bots.filter(b => b.connected).length;
        const countEl = document.getElementById('fleetActiveCount');
        if (countEl) countEl.innerText = onlineCount + ' / 10';

        container.innerHTML = bots.map(function(b) {
          var statusClass = b.connected ? 'online' : (b.connecting ? 'connecting' : 'offline');
          var statusLabel = b.connected ? 'ONLINE' : (b.connecting ? 'CONNECTING' : 'OFFLINE');
          var roleLabel = b.id === 1 ? '👑 Primary Leader' : ('⚙️ Worker #' + b.id);
          var coordsStr = b.pos ? ('(' + b.pos.x + ', ' + b.pos.y + ', ' + b.pos.z + ')') : 'Unknown';
          var reconnectBtn = (b.id > 1 && !b.connected)
            ? '<button class="btn-mini" onclick="reconnectBot(' + b.id + ')">⚡ Reconnect</button>'
            : '';

          return '<div class="bot-card ' + statusClass + '">' +
            '<div class="bot-card-header">' +
              '<div class="bot-title">' +
                '<span>' + b.username + '</span>' +
                '<span style="font-size:11px; color: var(--accent); font-weight: 600;">' + roleLabel + '</span>' +
              '</div>' +
              '<span class="bot-badge ' + statusClass + '">' + statusLabel + '</span>' +
            '</div>' +
            '<div class="bot-meta">' +
              '<div>State: <b>' + b.state + '</b></div>' +
              '<div>Health: <b style="color:#ef4444;">' + b.health + '/20</b></div>' +
              '<div>Food: <b style="color:#f59e0b;">' + b.food + '/20</b></div>' +
              '<div>Building: <b>' + (b.isBuilding ? 'YES' : 'NO') + '</b></div>' +
              '<div style="grid-column: span 2;">Pos: <b>' + coordsStr + '</b></div>' +
            '</div>' +
            '<div style="display:flex; justify-content: flex-end; margin-top:4px;">' +
              reconnectBtn +
            '</div>' +
          '</div>';
        }).join('');
      } catch (_) {}
    }

    async function updateDashboard() {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();
        const dot = document.getElementById('statusDot');
        const txt = document.getElementById('statusText');
        const isOnline = data.status === 'connected';
        dot.className = 'status-dot ' + (isOnline ? 'online' : '');
        txt.innerText = isOnline ? 'ONLINE' : 'OFFLINE';

        const term = document.getElementById('terminal');
        if (data.logs && term) {
          term.innerHTML = data.logs.slice(-60).reverse().map(l => '<div style="margin-bottom:4px;">' + l + '</div>').join('');
        }
      } catch (_) {}
    }

    async function reconnectBot(id) {
      await fetch('/api/swarm/reconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      setTimeout(updateFleetStatus, 800);
    }

    async function spawnAllSwarm() {
      await fetch('/api/swarm/spawn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 10 })
      });
      setTimeout(updateFleetStatus, 800);
    }

    async function stopAllSwarm() {
      await fetch('/api/swarm/stop', { method: 'POST' });
      setTimeout(updateFleetStatus, 800);
    }

    async function loadSchematicsList() {
      try {
        const res = await fetch('/api/schematics');
        const data = await res.json();
        const sel = document.getElementById('schematicSelect');
        if (!sel) return;
        if (!data.schematics || data.schematics.length === 0) {
          sel.innerHTML = '<option value="">No schematics found on server</option>';
          return;
        }
        sel.innerHTML = data.schematics.map(s => '<option value="' + s.filename + '">' + s.index + ': ' + s.name + ' (' + s.filename.split('.').pop() + ')</option>').join('');
      } catch (_) {}
    }

    async function buildSelectedSchematic() {
      const sel = document.getElementById('schematicSelect');
      const filename = sel ? sel.value : null;
      if (!filename) {
        alert('Please choose a schematic from the options list!');
        return;
      }
      const rot = parseInt(document.getElementById('schematicRot')?.value || '0', 10);
      const workers = parseInt(document.getElementById('schematicWorkers')?.value || '3', 10);

      const res = await fetch('/api/build/schematic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: filename, rotation: rot, swarmCount: workers })
      });
      const data = await res.json();
      alert(data.message || 'Build started!');
    }

    async function uploadSchematic() {
      const fileInput = document.getElementById('schemFile');
      if (!fileInput.files || fileInput.files.length === 0) {
        alert('Please choose a file to upload.');
        return;
      }
      const formData = new FormData();
      formData.append('schematic', fileInput.files[0]);
      const res = await fetch('/schematics/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      alert(data.message || 'Upload complete!');
      loadSchematicsList();
    }

    async function executeCommand() {
      const input = document.getElementById('cmdInput');
      const val = input.value.trim();
      if (!val) return;
      input.value = '';
      try {
        await fetch('/api/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: val })
        });
      } catch (_) {}
    }


    setInterval(updateDashboard, 2000);
    setInterval(updateFleetStatus, 2500);
    updateDashboard();
    updateFleetStatus();
  </script>
</body>
</html>
  `);
});



// ---------------------------------------------------------------------------
// Schematic Loader & Directory Discovery
// ---------------------------------------------------------------------------
function listSchematicFiles() {
  if (!fs.existsSync(SCHEMATICS_DIR)) return [];
  return fs.readdirSync(SCHEMATICS_DIR)
    .filter((f) => f.endsWith('.litematic') || f.endsWith('.nbt') || f.endsWith('.schematic'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

async function loadSchematicBlocks(name, rotation = 0) {
  const files = listSchematicFiles();
  let match = null;

  const trimmed = String(name || '').trim();
  if (!trimmed) return null;

  // 1. Check if name is a 1-based index (e.g. "1", "2", "4" from options list)
  if (/^\d+$/.test(trimmed)) {
    const idx = parseInt(trimmed, 10) - 1;
    if (idx >= 0 && idx < files.length) {
      match = files[idx];
    }
  }

  // 2. Exact match (case-insensitive)
  if (!match) {
    match = files.find((f) => f.toLowerCase() === trimmed.toLowerCase());
  }

  // 3. Exact match without extension
  if (!match) {
    match = files.find((f) => {
      const baseName = f.replace(/\.(litematic|nbt|schematic)$/i, '');
      return baseName.toLowerCase() === trimmed.toLowerCase();
    });
  }

  // 4. Fuzzy match: spaces, dashes, underscores stripped
  if (!match) {
    const cleanQuery = trimmed.replace(/[\s._-]+/g, '').toLowerCase();
    match = files.find((f) => {
      const cleanF = f.replace(/[\s._-]+/g, '').toLowerCase();
      const cleanBase = f.replace(/\.(litematic|nbt|schematic)$/i, '').replace(/[\s._-]+/g, '').toLowerCase();
      return cleanF.includes(cleanQuery) || cleanQuery.includes(cleanBase) || cleanBase.includes(cleanQuery);
    });
  }

  if (!match) return null;
  const filePath = path.join(SCHEMATICS_DIR, match);

  const raw = fs.readFileSync(filePath);
  const decompressed = raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw) : raw;
  const { parsed } = await nbt.parse(decompressed);
  const simplified = nbt.simplify(parsed);

  const lower = filePath.toLowerCase();
  if (lower.endsWith('.litematic')) {
    return parseLitematicBlocks(simplified, rotation);
  } else if (lower.endsWith('.schematic')) {
    return parseLegacySchematicBlocks(simplified, rotation);
  }
  return parseStructureNbtBlocks(simplified, rotation);
}

// ---------------------------------------------------------------------------
// Bot Lifecycle & Swarm Manager
// ---------------------------------------------------------------------------
let bot = null;
let builder = null;
let swarm = null;
let reconnectTimer = null;
let afkInterval = null;
let kickedDelay = null; // set by 'kicked' handler, consumed by 'end' handler

function safeChat(msg) {
  if (bot && bot.entity && typeof bot.chat === 'function') {
    const clean = String(msg || '').replace(/[^\x20-\x7E]/g, '');
    bot.chat(clean);
  }
}

function createBot() {
  logSystem(
    `[Bot] Connecting ${BOT_USERNAME} to ${TARGET_HOST}:${TARGET_PORT} (Version: ${TARGET_VERSION || 'Auto'})...`
  );

  bot = mineflayer.createBot({
    host: TARGET_HOST,
    port: TARGET_PORT,
    username: BOT_USERNAME,
    version: TARGET_VERSION || undefined,
    auth: 'offline',
    checkTimeoutInterval: 120000,
    hideErrors: false,
  });

  bot.loadPlugin(pathfinder);
  installChatCompat(bot);
  installFabricSpoof(bot);
  installPacketDebugger(bot);

  builder = new Builder(bot, {
    blockName: config.builder?.defaultBlock || 'cobblestone',
    placeDelayMs: config.swarm?.placeDelayMs || 120,
  });

  if (!swarm) {
    swarm = new SwarmManager(bot, {
      host: TARGET_HOST,
      port: TARGET_PORT,
      version: TARGET_VERSION || '1.21.4',
      placeDelayMs: config.swarm?.placeDelayMs || 120,
    }, config);
  } else {
    swarm.mainBot = bot;
    swarm.mainBuilder = builder;
  }

  // Smart Dual-Auth Chat Listener
  const handleAuthMessage = (msg) => {
    const text = (typeof msg === 'string' ? msg : msg.toString()).toLowerCase();
    const pass = config.utils?.['auto-auth']?.password || 'chalol78';
    if (text.includes('/register') || text.includes('register with') || text.includes('register password')) {
      setTimeout(() => {
        try { safeChat(`/register ${pass} ${pass}`); } catch (_) {}
      }, 800);
    } else if (text.includes('/login') || text.includes('please login') || text.includes('use /login')) {
      setTimeout(() => {
        try { safeChat(`/login ${pass}`); } catch (_) {}
      }, 800);
    }
  };

  bot.on('message', handleAuthMessage);

  bot.once('spawn', () => {
    botStatus = 'connected';
    reconnectAttempts = 0; // reset backoff on successful connection
    logSystem(`[Bot] ✅ ${BOT_USERNAME} spawned successfully into Minecraft world!`);

    const mcData = require('minecraft-data')(bot.version || '1.21.4');
    const defaultMove = new Movements(bot, mcData);
    defaultMove.canDig = false;
    defaultMove.allow1by1towers = true;
    defaultMove.allowParkour = true;
    defaultMove.allowSprinting = true;
    defaultMove.maxDropDown = 4;
    bot.pathfinder.setMovements(defaultMove);

    // Register with Swarm Manager and start 24/7 supervisor
    swarm.registerMainBot(bot, builder);

    // Dual-Action Auto-Auth
    if (config.utils?.['auto-auth']?.enabled) {
      const pass = config.utils['auto-auth'].password || 'chalol78';
      setTimeout(() => {
        try { safeChat(`/register ${pass} ${pass}`); } catch (_) {}
      }, 1200);
      setTimeout(() => {
        try { safeChat(`/login ${pass}`); } catch (_) {}
      }, 2600);
    }

    // Creative mode: ensure primary bot is persistently in creative mode
    setTimeout(() => {
      safeChat(`/gamemode creative ${BOT_USERNAME}`);
    }, 1000);
    setTimeout(() => {
      safeChat(`/gamemode creative ${BOT_USERNAME}`);
    }, 3500);

    bot.on('game', () => {
      if (bot.game && bot.game.gameMode !== 'creative') {
        setTimeout(() => {
          safeChat(`/gamemode creative ${BOT_USERNAME}`);
        }, 500);
      }
    });

    // 24/7 Anti-AFK routine for primary bot
    if (afkInterval) clearInterval(afkInterval);
    let afkTick = 0;
    afkInterval = setInterval(() => {
      if (bot && botStatus === 'connected' && bot.entity) {
        try {
          afkTick++;
          bot.swingArm();
          const yaw = bot.entity.yaw;
          const pitch = bot.entity.pitch;
          const offset = afkTick % 2 === 0 ? 0.05 : -0.05;
          bot.look(yaw + offset, pitch, true).catch(() => {});
        } catch (_) {}
      }
    }, 20000);

    safeChat(`[BuilderBot] Online! Commands: !schematic <name> [x y z] [rot], !schematics, !build <name>, !swarm <count>, !status, !come, !stop`);
  });

  let lastCmdTime = 0;
  let lastCmdText = '';

  bot.on('chat', (username, message) => {
    if (username.startsWith('BuilderBot')) return;
    const now = Date.now();
    const clean = message.trim();
    if (clean === lastCmdText && now - lastCmdTime < 1000) return;
    lastCmdTime = now;
    lastCmdText = clean;
    handleChatLine(username, clean);
  });

  bot.on('whisper', (username, message) => {
    if (username.startsWith('BuilderBot')) return;
    logSystem(`[Whisper from ${username}] ${message}`);
    const clean = message.trim().startsWith('!') ? message.trim() : '!' + message.trim();
    handleChatLine(username, clean);
  });

  bot.on('messagestr', (message) => {
    if (!message) return;
    const clean = message.trim();
    const cmdMatch = clean.match(/(?:<([^>]+)>|([A-Za-z0-9_]{3,16})\s*[:»>])?\s*(![a-zA-Z0-9_-]+.*)/);
    if (cmdMatch) {
      const sender = cmdMatch[1] || cmdMatch[2] || 'Player';
      const cmdText = cmdMatch[3].trim();
      if (sender.startsWith('BuilderBot')) return;
      const now = Date.now();
      if (cmdText === lastCmdText && now - lastCmdTime < 1000) return;
      lastCmdTime = now;
      lastCmdText = cmdText;
      logSystem(`[Command via messagestr] From ${sender}: ${cmdText}`);
      handleChatLine(sender, cmdText);
    }
  });

  bot.on('builder_place_error', (pos, err) => {
    logSystem(`[Builder Error] Failed at ${pos}: ${err.message}`);
  });

  bot.on('builder_undo_error', (pos, err) => {
    logSystem(`[Undo Error] Failed at ${pos}: ${err.message}`);
  });

  // 'kicked' fires first — store the desired delay so 'end' can use it
  bot.on('kicked', (reason) => {
    const reasonStr = describeDisconnectReason(reason);
    logSystem(`[Bot Kicked] ${reasonStr}`);
    botStatus = `Kicked: ${reasonStr}`;
    const lc = reasonStr.toLowerCase();
    if (lc.includes('throttl') || lc.includes('too many') || lc.includes('please wait')) {
      kickedDelay = THROTTLE_RECONNECT_DELAY_MS;
      logSystem(`[Reconnect] Server throttle detected — will wait ${kickedDelay / 1000}s before retry.`);
    } else {
      // Calculate with current attempt count (will be incremented in 'end')
      kickedDelay = Math.min(RECONNECT_DELAY_MS * Math.pow(1.5, reconnectAttempts), MAX_RECONNECT_DELAY_MS);
    }
  });

  bot.on('error', (err) => {
    logSystem(`[Bot Error] ${err.message}`);
  });

  bot.on('end', (reason) => {
    botStatus = 'disconnected';
    reconnectAttempts++;
    if (afkInterval) {
      clearInterval(afkInterval);
      afkInterval = null;
    }

    let delay;
    if (kickedDelay !== null) {
      // Use the delay computed by the 'kicked' handler
      delay = kickedDelay;
      kickedDelay = null;
    } else {
      // Connection dropped without a kick (network error, server restart, etc.)
      const desc = describeDisconnectReason(reason);
      const lc = desc.toLowerCase();
      if (lc.includes('throttl') || lc.includes('too many') || lc.includes('please wait')) {
        delay = THROTTLE_RECONNECT_DELAY_MS;
      } else if (lc.includes('duplicate_login')) {
        delay = DUPLICATE_LOGIN_RECONNECT_DELAY_MS;
      } else {
        delay = Math.min(RECONNECT_DELAY_MS * Math.pow(1.5, Math.max(0, reconnectAttempts - 1)), MAX_RECONNECT_DELAY_MS);
      }
    }

    logSystem(`[Bot Disconnected] Reconnecting in ${(delay / 1000).toFixed(0)}s... (attempt #${reconnectAttempts})`);
    scheduleReconnect(delay);
  });
}

function describeDisconnectReason(reason) {
  if (!reason) return 'unknown';
  if (typeof reason === 'string') {
    try {
      const p = JSON.parse(reason);
      return p.text || p.translate || reason;
    } catch {
      return reason;
    }
  }
  if (typeof reason === 'object') return reason.text || reason.translate || JSON.stringify(reason);
  return String(reason);
}

function scheduleReconnect(delayMs) {
  if (reconnectTimer) return;
  logSystem(`[Reconnect] Next attempt in ${(delayMs / 1000).toFixed(0)}s...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    createBot();
  }, delayMs);
}

// ---------------------------------------------------------------------------
// Command Handling
// ---------------------------------------------------------------------------
const VALID_ROTATIONS = new Set(['0', '90', '180', '270']);

function parseCoordsAndRotation(args) {
  if (args.length >= 3 && args.slice(0, 3).every((a) => /^-?\d+$/.test(a))) {
    const [x, y, z] = args.slice(0, 3).map(Number);
    const rotation = args[3] && VALID_ROTATIONS.has(args[3]) ? parseInt(args[3], 10) : 0;
    return { origin: new Vec3(x, y, z), rotation };
  }
  return { origin: null, rotation: 0 };
}

function resolveOrigin(requester, explicitOrigin) {
  if (explicitOrigin) return explicitOrigin;
  // Always default to the bot's current exact position
  if (bot.entity) {
    return bot.entity.position.floored();
  }
  let player = bot.players[requester]?.entity;
  if (!player) {
    player = Object.values(bot.entities).find(
      (e) => e.type === 'player' && e.username && e.username.toLowerCase() === requester.toLowerCase()
    );
  }
  if (player) {
    return player.position.floored();
  }
  return new Vec3(0, 64, 0);
}

function parseSchematicCommand(args) {
  let rotation = 0;
  let origin = null;
  const nameTokens = [...args];

  let swarmCount = null;
  // Check if 'swarm <count>' is at the start
  if (nameTokens.length >= 2 && nameTokens[0].toLowerCase() === 'swarm' && /^\d+$/.test(nameTokens[1])) {
    nameTokens.shift();
    swarmCount = parseInt(nameTokens.shift(), 10);
  }
  // Check if 'swarm <count>' is at the end
  if (nameTokens.length >= 2 && nameTokens[nameTokens.length - 2].toLowerCase() === 'swarm' && /^\d+$/.test(nameTokens[nameTokens.length - 1])) {
    swarmCount = parseInt(nameTokens.pop(), 10);
    nameTokens.pop();
  }

  if (
    nameTokens.length >= 4 &&
    /^-?\d+$/.test(nameTokens[nameTokens.length - 4]) &&
    /^-?\d+$/.test(nameTokens[nameTokens.length - 3]) &&
    /^-?\d+$/.test(nameTokens[nameTokens.length - 2]) &&
    VALID_ROTATIONS.has(nameTokens[nameTokens.length - 1])
  ) {
    rotation = parseInt(nameTokens.pop(), 10);
    const z = parseInt(nameTokens.pop(), 10);
    const y = parseInt(nameTokens.pop(), 10);
    const x = parseInt(nameTokens.pop(), 10);
    origin = new Vec3(x, y, z);
  } else if (
    nameTokens.length >= 3 &&
    /^-?\d+$/.test(nameTokens[nameTokens.length - 3]) &&
    /^-?\d+$/.test(nameTokens[nameTokens.length - 2]) &&
    /^-?\d+$/.test(nameTokens[nameTokens.length - 1])
  ) {
    const z = parseInt(nameTokens.pop(), 10);
    const y = parseInt(nameTokens.pop(), 10);
    const x = parseInt(nameTokens.pop(), 10);
    origin = new Vec3(x, y, z);
  } else if (nameTokens.length >= 2 && VALID_ROTATIONS.has(nameTokens[nameTokens.length - 1])) {
    rotation = parseInt(nameTokens.pop(), 10);
  }

  const name = nameTokens.join(' ').trim();
  return { name, coordInfo: { origin, rotation }, swarmCount };
}

async function handleChatLine(username, text) {
  if (!text.startsWith('!')) return;
  const args = text.trim().slice(1).split(/\s+/);
  const cmd = args.shift().toLowerCase();

  switch (cmd) {
    case 'spawn':
    case 'spawnall':
    case 'swarmstart':
    case 'swarm': {
      const count = parseInt(args[0], 10) || 10;
      safeChat(`[Swarm] Adjusting 24/7 fleet target to ${count} builder bots...`);
      const totalWorkers = await swarm.setWorkerCount(count);
      safeChat(`[Swarm] Active workforce target: ${totalWorkers} bots. 24/7 supervisor maintaining connection.`);
      return;
    }
    case 'reconnect': {
      const id = parseInt(args[0], 10);
      if (!isNaN(id) && id >= 2 && id <= 10) {
        safeChat(`[Swarm] Scheduling immediate reconnect for Bot ${id}...`);
        swarm.enqueueReconnect(id, 0);
      } else {
        safeChat('[Swarm] Usage: !reconnect <id: 2..10>');
      }
      return;
    }
    case 'bots':
    case 'swarmstatus': {
      const list = swarm.getSwarmStatus().filter((b) => b.connected);
      safeChat(`[Swarm] Active Bots (${list.length}/10): ` + list.map((b) => `${b.username} [${b.state}]`).join(' | '));
      return;
    }
    case 'schematics':
    case 'schematic':
    case 'build': {
      if (args.length === 0 || args[0].toLowerCase() === 'list' || args[0].toLowerCase() === 'options' || args[0].toLowerCase() === 'help') {
        const files = listSchematicFiles();
        if (files.length === 0) {
          safeChat('[Schematics] No schematics found on server. Upload via web dashboard (:10000).');
          return;
        }
        const summary = files.map((f, i) => `${i + 1}: ${f.replace(/\.(litematic|nbt|schematic)$/i, '')}`).join(' | ');
        safeChat(`[Schematic Options] ${summary}`);
        safeChat(`[BuilderBot] Choose an option: !schematic <number|name> (e.g. !schematic 4 or !schematic deepslate)`);
        return;
      }
      const parsed = parseSchematicCommand(args);
      if (parsed.swarmCount && parsed.swarmCount > 1) {
        await swarm.setWorkerCount(parsed.swarmCount);
      }
      return runSchematicBuild(username, parsed.name, parsed.coordInfo);
    }
    case 'come':
      return comeToPlayer(username);
    case 'undo':
      return runUndo(username);
    case 'stop':
    case 'force-stop':
    case 'cancel':
      return stopBuild(username);
    case 'status': {
      const pos = bot.entity ? bot.entity.position.floored() : null;
      const posStr = pos ? `(${pos.x}, ${pos.y}, ${pos.z})` : 'unknown';
      const bStatus = builder.getStatus();
      const workerCount = swarm.getWorkerCount();
      if (bStatus.active) {
        safeChat(`[Status] Building: "${bStatus.name}" | ${bStatus.placed}/${bStatus.total} placed (${bStatus.left} left, ${bStatus.percent}%) | Fleet: ${workerCount}/10 bots | Pos: ${posStr}`);
      } else {
        safeChat(`[Status] Health: ${Math.round(bot.health || 20)}/20 | Fleet: ${workerCount}/10 bots online | Pos: ${posStr}`);
      }
      return;
    }
    case 'help':
      safeChat('[Commands] !schematic <number|name> [x y z] [rot], !schematics, !build <name>, !swarm <count>, !status, !come, !undo, !stop');
      return;
    default:
      return;
  }
}

async function runSchematicBuild(requester, name, coordInfo = { origin: null, rotation: 0 }) {
  if (!name) {
    safeChat('Usage: !schematic <number|name> [x y z] [rotation 0|90|180|270]');
    return;
  }

  let blocks;
  try {
    blocks = await loadSchematicBlocks(name, coordInfo.rotation);
  } catch (err) {
    safeChat(`Failed to parse schematic "${name}": ${err.message}`);
    return;
  }

  if (!blocks) {
    const files = listSchematicFiles();
    const summary = files.map((f, i) => `${i + 1}: ${f.replace(/\.(litematic|nbt|schematic)$/i, '')}`).join(', ');
    safeChat(`Schematic "${name}" not found. Available options: ${summary}. Use: !schematic <number|name>`);
    return;
  }
  if (blocks.length === 0) {
    safeChat(`Schematic "${name}" contains no non-air blocks.`);
    return;
  }

  if (builder.isBuilding()) {
    safeChat(`[Builder] Cancelling current build ("${builder.currentJob?.name || 'task'}") to start "${name}"...`);
    builder.cancel();
    if (swarm) swarm.cancelAll();
    await new Promise((r) => setTimeout(r, 400));
  }

  if (bot.game?.gameMode !== 'creative') {
    safeChat(`/gamemode creative ${BOT_USERNAME}`);
    safeChat(`[Builder] ⚠ Notice: If I am in Survival mode, please run: /gamemode creative ${BOT_USERNAME} so I can synthesize deepslate & farm blocks!`);
  }
  builder.setJob(name);
  const origin = resolveOrigin(requester, coordInfo.origin);
  if (bot.entity && bot.entity.position.distanceTo(origin) > 8) {
    safeChat(`/tp ${BOT_USERNAME} ${origin.x} ${origin.y + 1} ${origin.z}`);
    safeChat(`/tp @e[type=player,name=BuilderBot*] ${origin.x} ${origin.y + 1} ${origin.z}`);
    await new Promise((r) => setTimeout(r, 1200));
  }
  const workforce = swarm.getWorkerCount();
  safeChat(
    `[Builder] Building "${name}" (${blocks.length} blocks, rot ${coordInfo.rotation}°, workforce: ${workforce} bots) ` +
      `at ${origin.x} ${origin.y} ${origin.z}...`
  );
  await executeBuild(blocks, origin);
}

async function executeBuild(blocks, origin) {
  try {
    const jobName = builder.currentJob ? builder.currentJob.name : 'Structure';
    const result = await swarm.buildParallel(builder, blocks, origin, (placed, total, left, percent, done) => {
      if (done) {
        logSystem(`[Builder] Build complete: ${placed}/${total} placed.`);
      } else {
        safeChat(`[Progress] "${jobName}": ${placed}/${total} placed (${left} left - ${percent}%)`);
      }
    });
    if (result && !result.cancelled) {
      safeChat(`[Builder] Done! Placed ${result.placed}/${result.total} blocks for "${jobName}".`);
    } else if (result && result.cancelled) {
      safeChat(`[Builder] Build stopped: ${result.placed}/${result.total} placed for "${jobName}".`);
    }
  } catch (err) {
    safeChat(`[Builder Error] Build failed: ${err.message}`);
  }
}

async function runUndo(requester) {
  if (builder.isBuilding()) {
    safeChat(`Can't undo mid-build — send !stop first, ${requester}.`);
    return;
  }
  safeChat('[Undo] Undoing last build...');
  const result = await builder.undo();
  safeChat(`[OK] Undo complete: removed ${result.undone}/${result.total} blocks.`);
}

function stopBuild(requester) {
  if (!builder.isBuilding()) {
    safeChat(`Nothing in progress, ${requester}.`);
    return;
  }
  swarm.cancelAll();
  builder.cancel();
  safeChat('[Stop] Build stopped immediately across all fleet bots.');
}

async function comeToPlayer(requester) {
  let player = bot.players[requester]?.entity;
  if (!player) {
    player = Object.values(bot.entities).find((e) => e.type === 'player' && e.username && e.username.toLowerCase() === requester.toLowerCase());
  }
  if (!player) {
    safeChat(`Can't see you, ${requester}.`);
    return;
  }
  const pos = player.position;
  bot.pathfinder.setGoal(new goals.GoalNear(pos.x, pos.y, pos.z, 2));
  safeChat(`[Movement] Coming to you, ${requester}!`);
}

process.on('unhandledRejection', (err) => {
  logSystem(`[Process Error] ${err.message}`);
});

createBot();
