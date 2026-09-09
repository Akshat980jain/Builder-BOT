"use strict";

const express = require("express");
const multer = require("multer");
const http = require("http");
const path = require("path");
const fs = require("fs");
const mineflayer = require("mineflayer");
const { Vec3 } = require("vec3");

const config = require("./settings.json");
const { addLog, getLogs } = require("./logger");
const SafetyManager = require("./safety");
const BuilderManager = require("./builder");
const SwarmManager = require("./swarm");
const {
  loadSchematicFile,
  generateProceduralShape,
  calculateMaterials
} = require("./schematic");

// ============================================================
// STATE TRACKING
// ============================================================
let bot = null;
let safety = null;
let builder = null;
let swarm = null;
let isReconnecting = false;
let reconnectTimeoutId = null;

const botState = {
  connected: false,
  startTime: Date.now(),
  reconnectAttempts: 0,
  currentAction: "Idle",
  coords: { x: 0, y: 64, z: 0 },
  health: 20,
  food: 20
};

const SCHEMATICS_DIR = path.join(__dirname, "schematics");
if (!fs.existsSync(SCHEMATICS_DIR)) {
  fs.mkdirSync(SCHEMATICS_DIR, { recursive: true });
}

function listSchematicFiles() {
  try {
    return fs.readdirSync(SCHEMATICS_DIR).filter((f) => /\.(litematic|nbt|schem|schematic)$/i.test(f));
  } catch (_) {
    return [];
  }
}

// ============================================================
// EXPRESS WEB DASHBOARD & API
// ============================================================
const app = express();
app.use(express.json());
const PORT = process.env.PORT || config.web?.port || 5000;

const upload = multer({
  storage: multer.diskStorage({
    destination: SCHEMATICS_DIR,
    filename: (req, file, cb) => cb(null, path.basename(file.originalname))
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(litematic|nbt|schem|schematic)$/i.test(file.originalname);
    cb(ok ? null : new Error("Only .litematic, .nbt, .schematic, and .schem files are accepted"), ok);
  }
});

app.get("/ping", (req, res) => res.json({ status: "alive", time: Date.now() }));
app.get("/logs", (req, res) => res.json(getLogs()));

app.get("/api/bot/position", (req, res) => {
  if (bot && bot.entity) {
    const p = bot.entity.position.floored();
    return res.json({ x: p.x, y: p.y, z: p.z });
  }
  res.json({ x: 0, y: 64, z: 0 });
});

app.get("/api/build/status", (req, res) => {
  const status = builder ? builder.getStatus() : { active: false, state: "IDLE" };
  res.json({
    connected: botState.connected,
    uptime: Math.floor((Date.now() - botState.startTime) / 1000),
    coords: bot && bot.entity ? bot.entity.position.floored() : botState.coords,
    health: bot ? bot.health : 0,
    food: bot ? bot.food : 0,
    ...status
  });
});

app.get("/api/schematics", (req, res) => {
  const files = listSchematicFiles();
  res.json({
    schematics: files.map((f, i) => ({
      index: i + 1,
      filename: f,
      name: f.replace(/\.(litematic|nbt|schematic|schem)$/i, "")
    }))
  });
});

app.post("/schematics/upload", upload.single("schematic"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file received." });
  addLog(`[Schematics] Received uploaded file: ${req.file.originalname} (${req.file.size} bytes)`, "Schematic");
  res.json({ success: true, name: req.file.originalname });
});

app.post("/api/build/start", async (req, res) => {
  if (!builder || !bot || !botState.connected) {
    return res.json({ success: false, message: "Bot is not connected to server." });
  }

  const {
    type = "schematic",
    schematicName,
    proceduralType,
    proceduralOptions,
    origin,
    rotation = 0,
    swarmCount = 1
  } = req.body;

  let blocks = [];
  let jobName = "Custom Build";

  try {
    if (type === "procedural") {
      jobName = `Procedural ${proceduralType}`;
      blocks = generateProceduralShape(proceduralType, proceduralOptions, Number(rotation) || 0);
    } else {
      if (!schematicName) return res.json({ success: false, message: "Missing schematic name." });
      const fullPath = path.join(SCHEMATICS_DIR, schematicName);
      if (!fs.existsSync(fullPath)) {
        return res.json({ success: false, message: `Schematic file "${schematicName}" not found.` });
      }
      jobName = schematicName.replace(/\.(litematic|nbt|schem|schematic)$/i, "");
      blocks = await loadSchematicFile(fullPath, Number(rotation) || 0);
    }

    if (!blocks || blocks.length === 0) {
      return res.json({ success: false, message: "Parsed structure contains 0 blocks." });
    }

    const targetOrigin = origin && origin.x !== undefined
      ? new Vec3(Number(origin.x), Number(origin.y), Number(origin.z))
      : (bot.entity ? bot.entity.position.floored() : new Vec3(0, 64, 0));

    if (swarmCount && Number(swarmCount) > 1 && swarm) {
      await swarm.spawnSwarm(Number(swarmCount));
      swarm.startSwarmBuild(jobName, blocks, targetOrigin);
      addLog(`[Build API] Dispatched build across ${swarmCount} swarm bots.`, "Builder");
    } else {
      builder.startBuild(jobName, blocks, targetOrigin);
      addLog(`[Build API] Started build "${jobName}" (${blocks.length} blocks).`, "Builder");
    }

    res.json({ success: true, message: `Build "${jobName}" launched (${blocks.length} blocks).` });
  } catch (err) {
    addLog(`[Build Error] ${err.message}`, "Builder");
    res.json({ success: false, message: err.message });
  }
});

app.post("/api/build/stop", (req, res) => {
  if (builder) builder.stop("Stopped from Web Dashboard");
  if (swarm) swarm.stopSwarm("Stopped from Web Dashboard");
  res.json({ success: true, message: "Build stopped." });
});

app.post("/api/build/pause", (req, res) => {
  if (builder) builder.pause();
  res.json({ success: true, message: "Build paused." });
});

app.post("/api/build/resume", (req, res) => {
  if (builder) builder.resume();
  res.json({ success: true, message: "Build resumed." });
});

app.post("/api/build/undo", async (req, res) => {
  if (builder) {
    await builder.undo();
    return res.json({ success: true, message: "Undo executed." });
  }
  res.json({ success: false, message: "Builder not ready." });
});

app.post("/api/build/cleararea", async (req, res) => {
  const { radius = 8, height = 10, center } = req.body;
  const origin = center && center.x !== undefined ? new Vec3(Number(center.x), Number(center.y), Number(center.z)) : (bot.entity ? bot.entity.position.floored() : new Vec3(0, 64, 0));
  if (builder) {
    await builder.clearArea(origin, Number(radius), Number(height));
    return res.json({ success: true, message: "Area cleared." });
  }
  res.json({ success: false, message: "Builder not ready." });
});

app.get("/api/swarm/status", (req, res) => {
  if (swarm) return res.json(swarm.getSwarmStatus());
  res.json([]);
});

app.post("/api/swarm/spawn", async (req, res) => {
  const count = parseInt(req.body.count, 10) || 10;
  if (swarm) await swarm.spawnSwarm(count);
  res.json({ success: true, message: `Swarm fleet set to ${count} bots.` });
});

app.post("/api/swarm/stop", (req, res) => {
  if (swarm) swarm.despawnSwarm(true);
  res.json({ success: true, message: "Swarm despawned." });
});

app.post("/api/command", (req, res) => {
  const { command } = req.body;
  if (!command) return res.status(400).json({ error: "Missing command" });
  addLog(`[Console] Executing: ${command}`, "General");
  handleChatCommands("WebUser", command.trim());
  res.json({ success: true, message: `Executed: ${command}` });
});

// ============================================================
// WEB DASHBOARD HTML
// ============================================================
app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${config.name || "Minecraft Builder Bot"} - Mission Control</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: rgba(17, 24, 39, 0.75);
      --border: rgba(255, 255, 255, 0.08);
      --accent: #f59e0b;
      --accent-glow: rgba(245, 158, 11, 0.25);
      --accent-blue: #38bdf8;
      --accent-purple: #a855f7;
      --success: #10b981;
      --danger: #ef4444;
      --text: #f8fafc;
      --text-muted: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Outfit', sans-serif;
      background: radial-gradient(circle at 15% 15%, #1e1b4b 0%, var(--bg) 95%);
      color: var(--text);
      min-height: 100vh;
      padding: 24px;
    }
    .container { max-width: 1260px; margin: 0 auto; }
    
    header {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--border);
    }
    .logo {
      font-size: 26px; font-weight: 800;
      background: linear-gradient(135deg, #f59e0b, #fbbf24, #f97316);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      display: flex; align-items: center; gap: 8px;
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
    .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 20px; }
    .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 20px; }
    @media (max-width: 900px) { .grid-2, .grid-3, .grid-4 { grid-template-columns: 1fr; } }

    .card {
      background: var(--card-bg); backdrop-filter: blur(16px); border: 1px solid var(--border);
      border-radius: 16px; padding: 22px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); margin-bottom: 20px;
    }
    .card h2 { font-size: 18px; margin-bottom: 16px; color: var(--accent); font-weight: 700; display: flex; align-items: center; gap: 8px; }
    .card h3 { font-size: 13px; color: var(--text-muted); text-transform: uppercase; font-weight: 700; margin: 14px 0 8px; }

    .input-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 10px; }
    .coord-field label { font-size: 12px; font-weight: 700; color: var(--text-muted); display: block; margin-bottom: 4px; }
    .input-text, select {
      width: 100%; background: rgba(0,0,0,0.4); border: 1px solid var(--border); border-radius: 8px;
      padding: 10px 12px; color: #fff; font-family: 'JetBrains Mono', monospace; font-size: 14px; font-weight: 600;
    }
    .input-text:focus, select:focus { outline: none; border-color: var(--accent); }
    
    .btn-pos {
      background: rgba(245, 158, 11, 0.1); border: 1px dashed var(--accent); color: var(--accent);
      padding: 8px 12px; border-radius: 8px; font-size: 12px; font-weight: 700; cursor: pointer;
      width: 100%; margin-top: 4px; transition: all 0.2s;
    }
    .btn-pos:hover { background: var(--accent); color: #000; }

    .radio-pill-group { display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 8px; margin-top: 8px; }
    .radio-pill {
      background: rgba(0,0,0,0.3); border: 1px solid var(--border); border-radius: 10px; padding: 10px;
      text-align: center; cursor: pointer; transition: all 0.2s; font-size: 14px; font-weight: 600;
    }
    .radio-pill.active { background: var(--accent); color: #000; font-weight: 700; border-color: var(--accent); }

    .btn-action {
      background: linear-gradient(135deg, #f59e0b, #d97706); color: #000; border: none; border-radius: 10px;
      padding: 12px 20px; font-size: 16px; font-weight: 800; cursor: pointer; width: 100%;
      box-shadow: 0 4px 15px var(--accent-glow); transition: all 0.2s; margin-top: 12px;
    }
    .btn-action:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(245, 158, 11, 0.4); }

    .btn-group { display: flex; gap: 8px; margin-top: 10px; }
    .btn-sec {
      flex: 1; background: rgba(255,255,255,0.06); border: 1px solid var(--border); color: #fff;
      padding: 10px; border-radius: 8px; font-weight: 700; cursor: pointer; transition: all 0.2s;
    }
    .btn-sec:hover { background: rgba(255,255,255,0.12); }
    .btn-danger { background: rgba(239,68,68,0.2); border-color: var(--danger); color: var(--danger); }
    .btn-danger:hover { background: var(--danger); color: #fff; }

    /* Progress bar */
    .progress-bar-bg { width: 100%; height: 16px; background: rgba(0,0,0,0.5); border-radius: 9999px; overflow: hidden; margin: 12px 0 6px; border: 1px solid var(--border); }
    .progress-bar-fill { height: 100%; background: linear-gradient(90deg, #f59e0b, #10b981); width: 0%; transition: width 0.3s; }

    /* Telemetry metrics */
    .metric-card { background: rgba(0,0,0,0.3); border: 1px solid var(--border); border-radius: 12px; padding: 14px; text-align: center; }
    .metric-val { font-size: 24px; font-weight: 800; color: #fff; font-family: 'JetBrains Mono', monospace; }
    .metric-label { font-size: 12px; color: var(--text-muted); font-weight: 700; text-transform: uppercase; margin-top: 4px; }

    /* Table */
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border); font-size: 14px; }
    th { color: var(--text-muted); font-weight: 700; text-transform: uppercase; font-size: 12px; }

    /* Logs */
    .logs-console {
      height: 380px; background: #050810; border: 1px solid var(--border); border-radius: 12px;
      padding: 14px; font-family: 'JetBrains Mono', monospace; font-size: 13px; overflow-y: auto; color: #cbd5e1;
    }
    .log-entry { margin-bottom: 4px; line-height: 1.5; }
    .log-builder { color: #f59e0b; }
    .log-schematic { color: #38bdf8; }
    .log-swarm { color: #a855f7; }
    .log-safety { color: #ef4444; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="logo">🏗️ ${config.name || "Minecraft Builder Bot"}</div>
      <div class="nav-tabs">
        <button class="tab-btn active" onclick="showTab('tab-build')">🚀 Build Studio</button>
        <button class="tab-btn" onclick="showTab('tab-swarm')">🤖 Swarm Fleet</button>
        <button class="tab-btn" onclick="showTab('tab-progress')">📊 Live Progress</button>
        <button class="tab-btn" onclick="showTab('tab-logs')">📜 Console & Logs</button>
      </div>
      <div class="status-badge">
        <span class="status-dot" id="status-dot"></span>
        <span id="status-text">Connecting...</span>
      </div>
    </header>

    <!-- TAB 1: BUILD STUDIO -->
    <div id="tab-build" class="tab-content active">
      <div class="grid-2">
        <!-- Origin & Build Mode -->
        <div class="card">
          <h2>📍 Target Origin Coordinates</h2>
          <div class="input-row">
            <div class="coord-field">
              <label>Origin X</label>
              <input type="number" id="origin-x" class="input-text" value="0">
            </div>
            <div class="coord-field">
              <label>Origin Y</label>
              <input type="number" id="origin-y" class="input-text" value="64">
            </div>
            <div class="coord-field">
              <label>Origin Z</label>
              <input type="number" id="origin-z" class="input-text" value="0">
            </div>
          </div>
          <button class="btn-pos" onclick="useBotPosition()">📌 Use Current Bot Position</button>

          <h3>🔄 Structure Rotation</h3>
          <div class="radio-pill-group" id="rotation-group">
            <div class="radio-pill active" onclick="setRotation(0)">0°</div>
            <div class="radio-pill" onclick="setRotation(90)">90°</div>
            <div class="radio-pill" onclick="setRotation(180)">180°</div>
            <div class="radio-pill" onclick="setRotation(270)">270°</div>
          </div>

          <h3>🤖 Workforce Scale</h3>
          <select id="swarm-count-select">
            <option value="1">Single Bot (Builder_Bot)</option>
            <option value="2">2 Bots Swarm</option>
            <option value="3" selected>3 Bots Swarm</option>
            <option value="5">5 Bots Swarm</option>
            <option value="10">10 Bots Full Fleet (Maximum Speed)</option>
          </select>
        </div>

        <!-- Structure Selection -->
        <div class="card">
          <h2>📜 Select Structure to Build</h2>
          
          <h3>Mode: Schematic File (.litematic / .nbt / .schem)</h3>
          <select id="schematic-select" style="margin-bottom: 8px;">
            <option value="">Loading schematics...</option>
          </select>

          <h3>Upload Schematic</h3>
          <input type="file" id="schematic-upload" accept=".litematic,.nbt,.schem,.schematic" style="margin-bottom: 12px; color: var(--text-muted);">

          <h3>Or Procedural Geometry</h3>
          <div class="input-row">
            <select id="procedural-shape">
              <option value="none">-- Use Schematic Instead --</option>
              <option value="floor">Floor / Platform</option>
              <option value="wall">Wall</option>
              <option value="box">Solid Box</option>
              <option value="cube">Hollow Cube</option>
              <option value="pyramid">Pyramid</option>
              <option value="dome">Dome / Sphere</option>
            </select>
            <input type="text" id="procedural-block" class="input-text" placeholder="minecraft:stone" value="minecraft:stone_bricks">
            <input type="number" id="procedural-size" class="input-text" placeholder="Size/Radius" value="8">
          </div>

          <button class="btn-action" onclick="launchBuild()">🚀 Launch Build Mission</button>

          <div class="btn-group">
            <button class="btn-sec" onclick="pauseBuild()">⏸️ Pause</button>
            <button class="btn-sec" onclick="resumeBuild()">▶️ Resume</button>
            <button class="btn-sec btn-danger" onclick="stopBuild()">🛑 Stop</button>
            <button class="btn-sec" onclick="undoBuild()">↩️ Undo</button>
            <button class="btn-sec" onclick="clearArea()">🧹 Clear Area</button>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB 2: SWARM FLEET -->
    <div id="tab-swarm" class="tab-content">
      <div class="card">
        <h2>🤖 Swarm Workforce Fleet Supervisor</h2>
        <p style="color: var(--text-muted); margin-bottom: 14px;">The 24/7 supervisor automatically spawns, auto-authenticates, and maintains worker bots across server restarts.</p>
        
        <div style="display: flex; gap: 12px; align-items: center; margin-bottom: 16px;">
          <button class="btn-sec" onclick="spawnSwarm(3)">Spawn 3 Bots</button>
          <button class="btn-sec" onclick="spawnSwarm(5)">Spawn 5 Bots</button>
          <button class="btn-sec" onclick="spawnSwarm(10)">Spawn 10 Bots (Max)</button>
          <button class="btn-sec btn-danger" onclick="stopSwarm()">Despawn Extra Fleet</button>
        </div>

        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Bot Name</th>
              <th>Status</th>
              <th>Coordinates</th>
              <th>Health</th>
            </tr>
          </thead>
          <tbody id="swarm-tbody">
            <tr><td colspan="5">Loading swarm status...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- TAB 3: LIVE PROGRESS -->
    <div id="tab-progress" class="tab-content">
      <div class="grid-4">
        <div class="metric-card">
          <div class="metric-val" id="metric-placed">0</div>
          <div class="metric-label">Blocks Placed</div>
        </div>
        <div class="metric-card">
          <div class="metric-val" id="metric-left">0</div>
          <div class="metric-label">Blocks Remaining</div>
        </div>
        <div class="metric-card">
          <div class="metric-val" id="metric-speed">0</div>
          <div class="metric-label">Blocks / Sec</div>
        </div>
        <div class="metric-card">
          <div class="metric-val" id="metric-percent">0%</div>
          <div class="metric-label">Completion</div>
        </div>
      </div>

      <div class="card">
        <h2>🔨 Active Build Task</h2>
        <div style="display: flex; justify-content: space-between; font-weight: 700;">
          <span id="current-task-name">Job: None</span>
          <span id="current-task-percent">0%</span>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" id="progress-fill"></div>
        </div>
        <div style="display: flex; justify-content: space-between; color: var(--text-muted); font-size: 13px;">
          <span id="current-task-state">State: IDLE</span>
          <span id="current-task-elapsed">Elapsed: 0s</span>
        </div>
      </div>
    </div>

    <!-- TAB 4: CONSOLE & LOGS -->
    <div id="tab-logs" class="tab-content">
      <div class="card">
        <h2>📜 Live Event Log & Command Runner</h2>
        <div class="logs-console" id="logs-console"></div>
        <div style="display: flex; gap: 8px; margin-top: 12px;">
          <input type="text" id="console-cmd" class="input-text" placeholder="Type chat command (e.g. !build, !stop, !undo, !cleararea 10)..." onkeydown="if(event.key==='Enter')sendConsoleCommand()">
          <button class="btn-sec" onclick="sendConsoleCommand()" style="flex: 0 0 120px;">Send</button>
        </div>
      </div>
    </div>
  </div>

  <script>
    let selectedRotation = 0;

    function showTab(tabId) {
      document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
      document.getElementById(tabId).classList.add('active');
      event.target.classList.add('active');
    }

    function setRotation(deg) {
      selectedRotation = deg;
      document.querySelectorAll('#rotation-group .radio-pill').forEach(el => el.classList.remove('active'));
      event.target.classList.add('active');
    }

    async function useBotPosition() {
      try {
        const res = await fetch('/api/bot/position');
        const pos = await res.json();
        document.getElementById('origin-x').value = pos.x;
        document.getElementById('origin-y').value = pos.y;
        document.getElementById('origin-z').value = pos.z;
      } catch (e) {
        alert('Failed fetching position: ' + e.message);
      }
    }

    async function loadSchematics() {
      try {
        const res = await fetch('/api/schematics');
        const data = await res.json();
        const sel = document.getElementById('schematic-select');
        sel.innerHTML = data.schematics.map(s => \`<option value="\${s.filename}">\${s.name} (\${s.filename})</option>\`).join('');
      } catch (_) {}
    }

    async function launchBuild() {
      const procShape = document.getElementById('procedural-shape').value;
      const origin = {
        x: Number(document.getElementById('origin-x').value) || 0,
        y: Number(document.getElementById('origin-y').value) || 64,
        z: Number(document.getElementById('origin-z').value) || 0
      };
      const swarmCount = Number(document.getElementById('swarm-count-select').value) || 1;

      let payload = {
        origin,
        rotation: selectedRotation,
        swarmCount
      };

      if (procShape !== 'none') {
        payload.type = 'procedural';
        payload.proceduralType = procShape;
        payload.proceduralOptions = {
          blockName: document.getElementById('procedural-block').value.trim() || 'minecraft:stone_bricks',
          width: Number(document.getElementById('procedural-size').value) || 8,
          height: Number(document.getElementById('procedural-size').value) || 8,
          length: Number(document.getElementById('procedural-size').value) || 8,
          size: Number(document.getElementById('procedural-size').value) || 8,
          radius: Number(document.getElementById('procedural-size').value) || 4
        };
      } else {
        payload.type = 'schematic';
        payload.schematicName = document.getElementById('schematic-select').value;
      }

      const res = await fetch('/api/build/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      alert(data.message || (data.success ? 'Build launched!' : 'Failed'));
    }

    async function stopBuild() {
      await fetch('/api/build/stop', { method: 'POST' });
    }
    async function pauseBuild() {
      await fetch('/api/build/pause', { method: 'POST' });
    }
    async function resumeBuild() {
      await fetch('/api/build/resume', { method: 'POST' });
    }
    async function undoBuild() {
      if (confirm('Undo and remove the last placed build?')) {
        await fetch('/api/build/undo', { method: 'POST' });
      }
    }
    async function clearArea() {
      const rad = prompt('Enter clearance radius (blocks):', '8');
      if (rad) {
        await fetch('/api/build/cleararea', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ radius: Number(rad), height: 12 })
        });
      }
    }
    async function spawnSwarm(count) {
      await fetch('/api/swarm/spawn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count })
      });
    }
    async function stopSwarm() {
      await fetch('/api/swarm/stop', { method: 'POST' });
    }

    async function sendConsoleCommand() {
      const input = document.getElementById('console-cmd');
      const cmd = input.value.trim();
      if (!cmd) return;
      input.value = '';
      await fetch('/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd })
      });
    }

    document.getElementById('schematic-upload').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const formData = new FormData();
      formData.append('schematic', file);
      try {
        const res = await fetch('/schematics/upload', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.success) {
          alert('Uploaded ' + data.name);
          loadSchematics();
        }
      } catch (err) {
        alert('Upload failed: ' + err.message);
      }
    });

    async function pollStatus() {
      try {
        const res = await fetch('/api/build/status');
        const s = await res.json();
        
        const dot = document.getElementById('status-dot');
        const txt = document.getElementById('status-text');
        if (s.connected) {
          dot.className = 'status-dot online';
          txt.innerText = 'Online (' + s.coords.x + ', ' + s.coords.y + ', ' + s.coords.z + ')';
        } else {
          dot.className = 'status-dot';
          txt.innerText = 'Offline';
        }

        document.getElementById('metric-placed').innerText = s.placed || 0;
        document.getElementById('metric-left').innerText = s.left || 0;
        document.getElementById('metric-speed').innerText = (s.blocksPerSec || 0) + '/s';
        document.getElementById('metric-percent').innerText = (s.percent || 0) + '%';
        document.getElementById('progress-fill').style.width = (s.percent || 0) + '%';
        document.getElementById('current-task-name').innerText = 'Job: ' + (s.name || 'None');
        document.getElementById('current-task-percent').innerText = (s.percent || 0) + '%';
        document.getElementById('current-task-state').innerText = 'State: ' + (s.state || 'IDLE');
        document.getElementById('current-task-elapsed').innerText = 'Elapsed: ' + (s.elapsed || 0) + 's';
      } catch (_) {}

      try {
        const res = await fetch('/api/swarm/status');
        const list = await res.json();
        const tbody = document.getElementById('swarm-tbody');
        tbody.innerHTML = list.map(b => \`
          <tr>
            <td>#\${b.id}</td>
            <td style="font-weight:700; color:\${b.connected ? '#10b981' : '#ef4444'}">\${b.username}</td>
            <td>\${b.connected ? '🟢 Connected' : (b.connecting ? '🟡 Connecting' : '⚪ Offline')}</td>
            <td style="font-family:'JetBrains Mono'">(\${b.coords.x}, \${b.coords.y}, \${b.coords.z})</td>
            <td>\${b.connected ? Math.round(b.health) + '/20' : '-'}</td>
          </tr>
        \`).join('');
      } catch (_) {}

      try {
        const res = await fetch('/logs');
        const logs = await res.json();
        const consoleEl = document.getElementById('logs-console');
        consoleEl.innerHTML = logs.map(l => {
          let cls = 'log-entry';
          if (l.category === 'Builder') cls += ' log-builder';
          else if (l.category === 'Schematic') cls += ' log-schematic';
          else if (l.category === 'Swarm') cls += ' log-swarm';
          else if (l.category === 'Safety') cls += ' log-safety';
          return \`<div class="\${cls}">[\${l.time}] [\${l.category}] \${l.message}</div>\`;
        }).join('');
      } catch (_) {}
    }

    loadSchematics();
    setInterval(pollStatus, 1500);
    pollStatus();
  </script>
</body>
</html>
  `);
});

// ============================================================
// IN-GAME CHAT COMMAND HANDLER
// ============================================================
async function handleChatCommands(sender, message) {
  if (!message || !message.startsWith("!")) return;
  const parts = message.trim().slice(1).split(/\s+/);
  const cmd = parts.shift().toLowerCase();

  switch (cmd) {
    case "schematics":
    case "list": {
      const files = listSchematicFiles();
      if (files.length === 0) {
        bot.chat("[Builder] No schematics found in schematics/ folder.");
        return;
      }
      const summary = files.map((f, i) => `${i + 1}: ${f.replace(/\.(litematic|nbt|schematic|schem)$/i, "")}`).join(" | ");
      bot.chat(`[Schematics] ${summary}`);
      bot.chat("[Builder] Launch with: !schematic <number|name> [x y z] [rot 0|90|180|270]");
      break;
    }

    case "schematic":
    case "build": {
      if (parts.length === 0) {
        bot.chat("Usage: !schematic <number|name> [x y z] [rot 0|90|180|270]");
        return;
      }

      // Check if swarm subcommand: !schematic swarm <count> <name> [x y z] [rot]
      let swarmCount = 1;
      if (parts[0].toLowerCase() === "swarm") {
        parts.shift();
        swarmCount = parseInt(parts.shift(), 10) || 3;
      }

      const query = parts.shift();
      const files = listSchematicFiles();
      let matchedFile = null;

      const num = parseInt(query, 10);
      if (!isNaN(num) && num >= 1 && num <= files.length) {
        matchedFile = files[num - 1];
      } else {
        matchedFile = files.find((f) => f.toLowerCase().includes(query.toLowerCase()));
      }

      if (!matchedFile) {
        bot.chat(`[Builder] Schematic "${query}" not found. Type !schematics to see options.`);
        return;
      }

      let origin = bot.entity ? bot.entity.position.floored() : new Vec3(0, 64, 0);
      let rotation = 0;

      if (parts.length >= 3) {
        origin = new Vec3(parseInt(parts[0], 10), parseInt(parts[1], 10), parseInt(parts[2], 10));
        if (parts[3]) rotation = parseInt(parts[3], 10) || 0;
      } else if (parts.length === 1) {
        rotation = parseInt(parts[0], 10) || 0;
      }

      try {
        const fullPath = path.join(SCHEMATICS_DIR, matchedFile);
        const blocks = await loadSchematicFile(fullPath, rotation);
        if (!blocks || blocks.length === 0) {
          bot.chat(`[Builder] Error: Schematic "${matchedFile}" contained 0 blocks.`);
          return;
        }

        const jobName = matchedFile.replace(/\.(litematic|nbt|schem|schematic)$/i, "");
        if (swarmCount > 1 && swarm) {
          await swarm.spawnSwarm(swarmCount);
          swarm.startSwarmBuild(jobName, blocks, origin);
          bot.chat(`[Builder] 🚀 Dispatched "${jobName}" (${blocks.length} blocks) across ${swarmCount} swarm bots!`);
        } else {
          builder.startBuild(jobName, blocks, origin);
        }
      } catch (err) {
        bot.chat(`[Builder Error] Failed loading "${matchedFile}": ${err.message}`);
      }
      break;
    }

    case "stop":
    case "stopall":
    case "cancel": {
      if (builder) builder.stop(`Stopped by ${sender}`);
      if (swarm) swarm.stopSwarm(`Stopped by ${sender}`);
      bot.chat("[Builder] 🛑 All building tasks aborted.");
      break;
    }

    case "pause": {
      if (builder) builder.pause();
      break;
    }

    case "resume": {
      if (builder) builder.resume();
      break;
    }

    case "undo": {
      if (builder) await builder.undo();
      break;
    }

    case "cleararea": {
      const radius = parseInt(parts[0], 10) || 8;
      const height = parseInt(parts[1], 10) || 10;
      const center = bot.entity ? bot.entity.position.floored() : new Vec3(0, 64, 0);
      if (builder) await builder.clearArea(center, radius, height);
      break;
    }

    case "coords":
    case "pos": {
      if (bot.entity) {
        const p = bot.entity.position.floored();
        bot.chat(`[Coords] Position: (${p.x}, ${p.y}, ${p.z})`);
      }
      break;
    }

    case "fly": {
      if (bot.creative && typeof bot.creative.startFlying === "function") {
        try {
          bot.creative.startFlying();
          bot.chat("[Flight] Creative flight enabled.");
        } catch (e) {
          bot.chat(`[Flight Error] ${e.message}`);
        }
      } else {
        bot.chat("[Flight] Bot is not in creative mode.");
      }
      break;
    }

    case "come":
    case "follow": {
      const targetPlayer = bot.players[sender];
      if (targetPlayer && targetPlayer.entity) {
        const p = targetPlayer.entity.position.floored();
        bot.chat(`/tp ${bot.username} ${p.x} ${p.y} ${p.z}`);
      } else {
        bot.chat(`[Follow] Cannot see player ${sender} to teleport.`);
      }
      break;
    }

    case "swarm": {
      const count = parseInt(parts[0], 10) || 3;
      if (swarm) {
        await swarm.spawnSwarm(count);
        bot.chat(`[Swarm] Workforce target set to ${count} bots.`);
      }
      break;
    }

    case "despawn":
    case "despawnall": {
      if (swarm) swarm.despawnSwarm(true);
      bot.chat("[Swarm] Extra fleet bots despawned.");
      break;
    }

    case "status": {
      const bStatus = builder ? builder.getStatus() : { active: false };
      if (bStatus.active) {
        bot.chat(`[Status] Building: "${bStatus.name}" | ${bStatus.placed}/${bStatus.total} placed (${bStatus.percent}%)`);
      } else {
        bot.chat(`[Status] Idle. Health: ${Math.round(bot.health || 20)}/20. Web Dashboard at :${PORT}`);
      }
      break;
    }

    case "help": {
      bot.chat("[Commands] !schematics, !schematic <name> [x y z] [rot], !cleararea <rad> <h>, !stop, !undo, !pause, !resume, !coords, !come, !fly, !swarm <count>");
      break;
    }
  }
}

// ============================================================
// BOT CREATION & LIFECYCLE
// ============================================================
function createBuilderBot() {
  if (isReconnecting) return;

  const serverConfig = config.server || {};
  const botConfig = config.bot || {};
  const username = botConfig.username || "Builder_Bot";

  addLog(`Connecting ${username} to ${serverConfig.ip}:${serverConfig.port} (v${serverConfig.version || "1.21.4"})...`, "General");

  try {
    bot = mineflayer.createBot({
      host: serverConfig.ip,
      port: serverConfig.port,
      username,
      version: serverConfig.version || "1.21.4",
      checkTimeoutInterval: 60000
    });
  } catch (err) {
    addLog(`[Error] Failed to initialize Mineflayer bot: ${err.message}`, "General");
    scheduleReconnect();
    return;
  }

  safety = new SafetyManager(bot, config);
  builder = new BuilderManager(bot, config, safety);

  if (!swarm) {
    swarm = new SwarmManager(serverConfig, addLog, () => {});
  }

  bot.once("spawn", () => {
    botState.connected = true;
    botState.reconnectAttempts = 0;
    isReconnecting = false;

    addLog(`🟢 ${username} successfully spawned in world!`, "General");

    // Initialize safety
    safety.init();

    // Register with swarm supervisor
    swarm.registerPrimaryBot(bot, builder, safety);

    // Auto-auth
    const authConfig = config.utils?.["auto-auth"];
    if (authConfig && authConfig.enabled) {
      setTimeout(() => {
        try {
          bot.chat(`/register ${authConfig.password} ${authConfig.password}`);
          bot.chat(`/login ${authConfig.password}`);
        } catch (_) {}
      }, 1500);
    }

    // Creative mode setup
    if (serverConfig.tryCreative) {
      setTimeout(() => {
        try {
          bot.chat(`/gamemode creative ${username}`);
        } catch (_) {}
      }, 2500);
    }
  });

  bot.on("chat", (sender, message) => {
    if (sender === bot.username) return;
    if (config.utils?.["chat-log"]) {
      addLog(`<${sender}> ${message}`, "Chat");
    }
    handleChatCommands(sender, message);
  });

  bot.on("message", (jsonMsg) => {
    const text = jsonMsg.toString().trim();
    if (!text) return;
    if (text.startsWith("!")) {
      handleChatCommands("System", text);
    }
  });

  bot.on("error", (err) => {
    addLog(`[Bot Error] ${err.message}`, "General");
  });

  bot.on("end", (reason) => {
    botState.connected = false;
    addLog(`🔴 Bot disconnected from server: ${reason}`, "General");
    scheduleReconnect();
  });
}

function scheduleReconnect() {
  if (isReconnecting || !config.utils?.["auto-reconnect"]) return;
  isReconnecting = true;

  botState.reconnectAttempts++;
  const base = config.utils?.["auto-reconnect-delay"] || 5000;
  const max = config.utils?.["max-reconnect-delay"] || 30000;
  const delay = Math.min(base * Math.pow(1.3, botState.reconnectAttempts), max);

  addLog(`Reconnecting in ${(delay / 1000).toFixed(1)}s (Attempt #${botState.reconnectAttempts})...`, "General");

  if (reconnectTimeoutId) clearTimeout(reconnectTimeoutId);
  reconnectTimeoutId = setTimeout(() => {
    isReconnecting = false;
    createBuilderBot();
  }, delay);
}

process.on("uncaughtException", (err) => {
  addLog(`[Handled Error] ${err.message}`, "General");
  if (!bot || !botState.connected) {
    if (!isReconnecting) scheduleReconnect();
  }
});

process.on("unhandledRejection", (reason) => {
  addLog(`[Handled Warning] ${reason}`, "General");
});

// ============================================================
// START SERVER & BOT
// ============================================================
app.listen(PORT, "0.0.0.0", () => {
  addLog(`[HTTP] Mission Control Dashboard listening at http://localhost:${PORT}`, "General");
  console.log(`==> Mission Control Dashboard listening at http://localhost:${PORT}`);
});

createBuilderBot();
