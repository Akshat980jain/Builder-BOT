'use strict';

const express = require('express');
const multer = require('multer');
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const nbt = require('prismarine-nbt');
const zlib = require('zlib');
const path = require('path');
const fs = require('fs');
const { pyramid, tower, dome } = require('./src/shapes');
const { Builder } = require('./src/builder');
const { installChatCompat } = require('./src/chatCompat');
const { parseLitematicBlocks, parseStructureNbtBlocks } = require('./src/schematic');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const REAL_SERVER_HOST = process.env.MC_HOST || 'akshat980jain-llhY.aternos.me';
const REAL_SERVER_PORT = process.env.MC_PORT || '30929';
const REAL_SERVER_VERSION = process.env.MC_VERSION || '26.2';

const VIAPROXY_HOST = '127.0.0.1';
const VIAPROXY_PORT = process.env.VIAPROXY_PORT || '25577';
const BOT_PROTOCOL_VERSION = process.env.BOT_PROTOCOL_VERSION || '1.21.4';

const BOT_USERNAME = process.env.BOT_USERNAME || 'BuilderBot';
const RECONNECT_DELAY_MS = 10_000;
const DUPLICATE_LOGIN_RECONNECT_DELAY_MS = 18_000;
const HTTP_PORT = process.env.PORT || 8080;

// ---------------------------------------------------------------------------
// Express keep-alive & Schematic Upload Server
// ---------------------------------------------------------------------------
const app = express();
let botStatus = 'starting';
const logs = [];

function logSystem(msg) {
  const time = new Date().toLocaleTimeString();
  const entry = `[${time}] ${msg}`;
  logs.push(entry);
  if (logs.length > 200) logs.shift();
  console.log(entry);
}

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

app.get('/api/status', (req, res) => {
  const pos = bot?.entity ? bot.entity.position : null;
  res.json({
    status: botStatus,
    username: BOT_USERNAME,
    health: bot?.health ?? 20,
    food: bot?.food ?? 20,
    position: pos ? { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) } : null,
    isBuilding: builder?.isBuilding() ?? false,
    gameMode: bot?.game?.gameMode ?? 'unknown',
    logs,
  });
});

app.get('/', (req, res) => {
  res.json({ status: botStatus, username: BOT_USERNAME, uptime: process.uptime() });
});

app.listen(HTTP_PORT, () => {
  logSystem(`[HTTP] Keep-alive and upload server listening on :${HTTP_PORT}`);
});

// ---------------------------------------------------------------------------
// Schematic Loader
// ---------------------------------------------------------------------------
async function loadSchematicBlocks(name, rotation = 0) {
  const cleanName = name.replace(/[\s._-]+/g, '').toLowerCase();
  const files = fs.readdirSync(SCHEMATICS_DIR);

  let match = files.find(f => f.toLowerCase() === name.toLowerCase());
  if (!match) {
    match = files.find(f => {
      const c = f.replace(/[\s._-]+/g, '').toLowerCase();
      return c.includes(cleanName) || cleanName.includes(c);
    });
  }

  if (!match) return null;
  const filePath = path.join(SCHEMATICS_DIR, match);

  const raw = fs.readFileSync(filePath);
  const decompressed = raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw) : raw;
  const { parsed } = await nbt.parse(decompressed);
  const simplified = nbt.simplify(parsed);

  if (filePath.endsWith('.litematic')) {
    return parseLitematicBlocks(simplified, rotation);
  }
  return parseStructureNbtBlocks(simplified, rotation);
}

// ---------------------------------------------------------------------------
// Bot Lifecycle
// ---------------------------------------------------------------------------
let bot = null;
let builder = null;
let reconnectTimer = null;

function safeChat(msg) {
  if (bot && bot.entity && typeof bot.chat === 'function') {
    const clean = String(msg || '').replace(/[^\x20-\x7E]/g, '');
    bot.chat(clean);
  }
}

function createBot() {
  logSystem(
    `[Bot] Connecting to ViaProxy at ${VIAPROXY_HOST}:${VIAPROXY_PORT} ` +
      `-> ${REAL_SERVER_HOST}:${REAL_SERVER_PORT} (v${REAL_SERVER_VERSION})...`
  );

  bot = mineflayer.createBot({
    host: VIAPROXY_HOST,
    port: Number(VIAPROXY_PORT),
    username: BOT_USERNAME,
    version: BOT_PROTOCOL_VERSION,
    auth: 'offline',
  });

  bot.loadPlugin(pathfinder);
  installChatCompat(bot);
  builder = new Builder(bot, { blockName: process.env.BUILD_BLOCK || 'cobblestone' });

  bot.once('spawn', () => {
    botStatus = 'connected';
    logSystem(`[Bot] Spawned successfully in Minecraft world!`);

    const defaultMove = new Movements(bot);
    bot.pathfinder.setMovements(defaultMove);

    safeChat('[BuilderBot] Online! Use key B or: !schematic <name> [x y z] [rot], !pyramid, !dome, !tower, !come, !undo, !stop');
  });

  let lastCmdTime = 0;
  let lastCmdText = '';

  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    const now = Date.now();
    const clean = message.trim();
    if (clean === lastCmdText && (now - lastCmdTime) < 1000) return;
    lastCmdTime = now;
    lastCmdText = clean;
    handleChatLine(username, clean);
  });

  bot.on('whisper', (username, message) => {
    if (username === bot.username) return;
    logSystem(`[Whisper from ${username}] ${message}`);
    const clean = message.trim().startsWith('!') ? message.trim() : '!' + message.trim();
    handleChatLine(username, clean);
  });

  bot.on('builder_place_error', (pos, err) => {
    logSystem(`[Builder Error] Failed at ${pos}: ${err.message}`);
  });

  bot.on('builder_undo_error', (pos, err) => {
    logSystem(`[Undo Error] Failed at ${pos}: ${err.message}`);
  });

  bot.on('kicked', (reason) => {
    const reasonStr = describeDisconnectReason(reason);
    logSystem(`[Bot Kicked] ${reasonStr}`);
    botStatus = `Kicked: ${reasonStr}`;
    scheduleReconnect(RECONNECT_DELAY_MS);
  });

  bot.on('error', (err) => {
    logSystem(`[Bot Error] ${err.message}`);
  });

  bot.on('end', (reason) => {
    botStatus = 'disconnected';
    const desc = describeDisconnectReason(reason);
    const delay = desc.toLowerCase().includes('duplicate_login')
      ? DUPLICATE_LOGIN_RECONNECT_DELAY_MS
      : RECONNECT_DELAY_MS;
    logSystem(`[Bot Disconnected] Reason: ${desc}. Reconnecting in ${delay / 1000}s...`);
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
  const player = bot.players[requester]?.entity;
  return player ? player.position.floored() : (bot.entity ? bot.entity.position.floored() : new Vec3(0, 64, 0));
}

function handleChatLine(username, text) {
  if (!text.startsWith('!')) return;
  const args = text.trim().slice(1).split(/\s+/);
  const cmd = args.shift().toLowerCase();

  switch (cmd) {
    case 'pyramid':
      return runBuild(username, pyramid(parseInt(args[0], 10) || 5), parseCoordsAndRotation(args.slice(1)));
    case 'dome':
      return runBuild(username, dome(parseInt(args[0], 10) || 6), parseCoordsAndRotation(args.slice(1)));
    case 'tower':
      return runBuild(
        username,
        tower(parseInt(args[0], 10) || 2, parseInt(args[1], 10) || 10),
        parseCoordsAndRotation(args.slice(2))
      );
    case 'stairs':
      return runBuild(
        username,
        tower(parseInt(args[0], 10) || 3, parseInt(args[1], 10) || 12),
        parseCoordsAndRotation(args.slice(2))
      );
    case 'schematic':
      return runSchematicBuild(username, args[0], parseCoordsAndRotation(args.slice(1)));
    case 'come':
      return comeToPlayer(username);
    case 'undo':
      return runUndo(username);
    case 'stop':
      return stopBuild(username);
    case 'status':
      const pos = bot.entity ? bot.entity.position : null;
      const posStr = pos ? `(${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)})` : 'unknown';
      safeChat(`[Status] Health: ${Math.round(bot.health || 20)}/20 | Mode: ${bot.game?.gameMode || 'survival'} | Pos: ${posStr} | Building: ${builder.isBuilding() ? 'Active' : 'Idle'}`);
      return;
    case 'help':
      safeChat('[Commands] !schematic <name> [x y z] [rot], !pyramid <size>, !dome <r>, !tower <r> <h>, !come, !undo, !stop');
      return;
    default:
      return;
  }
}

async function runBuild(requester, offsets, coordInfo = { origin: null, rotation: 0 }) {
  if (builder.isBuilding()) {
    safeChat(`Already building — send !stop first, ${requester}.`);
    return;
  }
  const origin = resolveOrigin(requester, coordInfo.origin);
  builder.enqueue(offsets, origin);
  safeChat(`[Builder] Building ${offsets.length} blocks at ${origin.x} ${origin.y} ${origin.z}...`);
  await executeBuild();
}

async function runSchematicBuild(requester, name, coordInfo = { origin: null, rotation: 0 }) {
  if (!name) {
    safeChat('Usage: !schematic <name> [x y z] [rotation 0|90|180|270]');
    return;
  }
  if (builder.isBuilding()) {
    safeChat(`Already building — send !stop first, ${requester}.`);
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
    safeChat(`Schematic "${name}" not found on server — upload it or check name.`);
    return;
  }
  if (blocks.length === 0) {
    safeChat(`Schematic "${name}" contains no non-air blocks.`);
    return;
  }

  const origin = resolveOrigin(requester, coordInfo.origin);
  builder.enqueue(blocks, origin);
  safeChat(
    `[Builder] Building "${name}" (${blocks.length} blocks, rot ${coordInfo.rotation}°) ` +
      `at ${origin.x} ${origin.y} ${origin.z}...`
  );
  await executeBuild();
}

async function executeBuild() {
  try {
    const result = await builder.run((placed, total, done) => {
      if (done) {
        logSystem(`[Builder] Build complete: ${placed}/${total} placed.`);
      }
    });
    if (result && !result.cancelled) {
      safeChat(`[Builder] Done. Placed ${result.placed}/${result.total} blocks (${result.mode} mode).`);
    } else if (result && result.cancelled) {
      safeChat(`[Builder] Build stopped: ${result.placed}/${result.total} placed.`);
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
  builder.cancel();
  safeChat('[Stop] Stopping after current block...');
}

async function comeToPlayer(requester) {
  let player = bot.players[requester]?.entity;
  if (!player) {
    player = Object.values(bot.entities).find(e => e.type === 'player' && e.username && e.username.toLowerCase() === requester.toLowerCase());
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
