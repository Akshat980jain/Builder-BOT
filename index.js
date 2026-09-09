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
let connectionTimeoutId = null;  // For startup connection timeout

const botState = {
  connected: false,
  startTime: Date.now(),
  reconnectAttempts: 0,
  currentAction: "Idle",
  coords: { x: 0, y: 64, z: 0 },
  health: 20,
  food: 20,
  wasThrottled: false,
  isDuplicateLogin: false
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
// ============================================================
// EXPRESS WEB DASHBOARD & API
// ============================================================
const app = express();
app.use(express.json());
app.use("/public", express.static(path.join(__dirname, "public")));
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
// WEB DASHBOARD HTML - MINECRAFT DARK THEME EDITION
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
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Outfit:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-dark: #0a0d14;
      --panel-bg: rgba(18, 23, 34, 0.88);
      --panel-border-light: rgba(255, 255, 255, 0.12);
      --panel-border-dark: rgba(0, 0, 0, 0.7);
      --mc-gold: #f59e0b;
      --mc-gold-light: #fbbf24;
      --mc-gold-dark: #b45309;
      --mc-red: #ef4444;
      --mc-green: #22c55e;
      --mc-blue: #3b82f6;
      --mc-purple: #a855f7;
      --mc-cyan: #06b6d4;
      --text-main: #f1f5f9;
      --text-muted: #94a3b8;
      --slot-bg: #090c13;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Outfit', sans-serif;
      background: linear-gradient(180deg, rgba(8, 11, 18, 0.88) 0%, rgba(13, 17, 26, 0.95) 100%),
                  url('/public/bg.jpg') no-repeat center center fixed;
      background-size: cover;
      color: var(--text-main);
      min-height: 100vh;
      padding: 24px 16px;
      position: relative;
    }

    /* Ambient Ember Particle Overlay */
    body::before {
      content: '';
      position: fixed;
      inset: 0;
      pointer-events: none;
      background-image: 
        radial-gradient(2px 2px at 20px 30px, #f59e0b, rgba(0,0,0,0)),
        radial-gradient(2px 2px at 150px 120px, #fbbf24, rgba(0,0,0,0)),
        radial-gradient(3px 3px at 320px 240px, #ef4444, rgba(0,0,0,0)),
        radial-gradient(2px 2px at 450px 80px, #f59e0b, rgba(0,0,0,0)),
        radial-gradient(2px 2px at 600px 350px, #fbbf24, rgba(0,0,0,0)),
        radial-gradient(3px 3px at 800px 180px, #ef4444, rgba(0,0,0,0));
      opacity: 0.35;
      animation: embersFloat 20s linear infinite;
      z-index: 0;
    }

    @keyframes embersFloat {
      0% { transform: translateY(0); }
      100% { transform: translateY(-300px); }
    }

    .container { max-width: 1280px; margin: 0 auto; position: relative; z-index: 1; }

    /* Header with Minecraft Icon & Pixel Branding */
    header {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 24px; padding: 14px 20px;
      background: rgba(14, 18, 27, 0.85);
      backdrop-filter: blur(16px);
      border: 2px solid #2d3748;
      border-top-color: #4b5563;
      border-left-color: #4b5563;
      border-bottom-color: #0f172a;
      border-right-color: #0f172a;
      border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.6);
    }

    .brand {
      display: flex; align-items: center; gap: 14px;
    }
    .brand-icon {
      width: 44px; height: 44px; border-radius: 8px;
      border: 2px solid var(--mc-gold);
      box-shadow: 0 0 16px rgba(245, 158, 11, 0.4);
      object-fit: cover;
    }
    .logo-text {
      font-family: 'Press Start 2P', monospace;
      font-size: 15px;
      color: #fbbf24;
      text-shadow: 2px 2px 0 #000, 0 0 15px rgba(245, 158, 11, 0.6);
      letter-spacing: 0.5px;
    }
    .logo-sub {
      font-size: 11px;
      font-weight: 700;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 1.5px;
      margin-top: 3px;
    }

    .nav-tabs { display: flex; gap: 8px; }
    .tab-btn {
      background: linear-gradient(180deg, #273142 0%, #17202f 100%);
      border: 2px solid #3b4759;
      border-top-color: #55657d;
      border-left-color: #55657d;
      border-bottom-color: #0c121d;
      border-right-color: #0c121d;
      color: var(--text-muted);
      padding: 10px 18px; border-radius: 8px; font-weight: 800; cursor: pointer;
      transition: all 0.15s ease;
      font-size: 13px;
      text-transform: uppercase;
      box-shadow: 0 3px 0 #0c121d;
    }
    .tab-btn:hover {
      color: #fff;
      border-color: var(--mc-gold);
      transform: translateY(-1px);
    }
    .tab-btn.active {
      background: linear-gradient(180deg, #f59e0b 0%, #b45309 100%);
      color: #000;
      font-weight: 900;
      border-top-color: #fef08a;
      border-left-color: #fef08a;
      border-bottom-color: #78350f;
      border-right-color: #78350f;
      box-shadow: 0 3px 0 #451a03, 0 0 18px rgba(245, 158, 11, 0.5);
      text-shadow: 0 1px 0 rgba(255,255,255,0.4);
    }

    .status-badge {
      display: inline-flex; align-items: center; gap: 8px; padding: 8px 16px; border-radius: 8px;
      font-weight: 700; font-size: 13px; font-family: 'JetBrains Mono', monospace;
      background: #090c13;
      border: 2px solid #1e293b;
      box-shadow: inset 1px 1px 3px rgba(0,0,0,0.8);
    }
    .status-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--mc-red); }
    .status-dot.online { background: var(--mc-green); box-shadow: 0 0 12px var(--mc-green); }

    .tab-content { display: none; }
    .tab-content.active { display: block; }
    
    .grid-2 { display: grid; grid-template-columns: 1fr 1.15fr; gap: 20px; margin-bottom: 20px; }
    .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 20px; }
    @media (max-width: 960px) { .grid-2, .grid-4 { grid-template-columns: 1fr; } }

    /* Minecraft GUI Themed Card Panel */
    .card {
      background: var(--panel-bg);
      backdrop-filter: blur(20px);
      border: 2px solid #2d3748;
      border-top-color: #4b5563;
      border-left-color: #4b5563;
      border-bottom-color: #0b111e;
      border-right-color: #0b111e;
      border-radius: 12px;
      padding: 22px;
      box-shadow: inset 1px 1px 0px rgba(255,255,255,0.06), 0 16px 40px rgba(0,0,0,0.7);
      margin-bottom: 20px;
    }
    .card h2 {
      font-size: 16px; font-family: 'Press Start 2P', monospace;
      margin-bottom: 18px; color: #fbbf24;
      display: flex; align-items: center; gap: 10px;
      letter-spacing: 0.5px;
      text-shadow: 1px 1px 0 #000;
    }
    .card h3 {
      font-size: 12px; color: var(--text-muted); text-transform: uppercase; font-weight: 800;
      letter-spacing: 1px; margin: 16px 0 8px; display: flex; align-items: center; gap: 6px;
    }

    /* Minecraft Inventory Coordinate Slots (X: Red, Y: Green, Z: Blue) */
    .coord-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 10px; }
    .coord-slot {
      background: var(--slot-bg);
      border: 2px solid #1e293b;
      border-top-color: #0a0f18;
      border-left-color: #0a0f18;
      border-bottom-color: #334155;
      border-right-color: #334155;
      border-radius: 8px;
      padding: 10px 12px;
      box-shadow: inset 2px 2px 4px rgba(0,0,0,0.8);
      position: relative;
    }
    .coord-slot.x-slot { border-left: 3px solid var(--mc-red); }
    .coord-slot.y-slot { border-left: 3px solid var(--mc-green); }
    .coord-slot.z-slot { border-left: 3px solid var(--mc-blue); }

    .coord-slot label {
      font-size: 11px; font-family: 'Press Start 2P', monospace;
      display: block; margin-bottom: 6px;
    }
    .x-slot label { color: #f87171; }
    .y-slot label { color: #4ade80; }
    .z-slot label { color: #60a5fa; }

    .coord-input {
      width: 100%; background: transparent; border: none; outline: none;
      color: #fff; font-family: 'JetBrains Mono', monospace; font-size: 16px; font-weight: 700;
    }

    /* Minecraft Styled Inputs & Selects */
    .mc-input, select {
      width: 100%;
      background: var(--slot-bg);
      border: 2px solid #1e293b;
      border-top-color: #0a0f18;
      border-left-color: #0a0f18;
      border-bottom-color: #334155;
      border-right-color: #334155;
      border-radius: 8px;
      padding: 10px 14px;
      color: #fff;
      font-family: 'JetBrains Mono', monospace;
      font-size: 14px; font-weight: 600;
      box-shadow: inset 2px 2px 4px rgba(0,0,0,0.8);
    }
    .mc-input:focus, select:focus { outline: none; border-color: var(--mc-gold); }

    .btn-pos {
      background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%);
      border: 2px dashed #f59e0b;
      color: #fbbf24;
      padding: 10px 14px; border-radius: 8px; font-size: 12px; font-weight: 800; cursor: pointer;
      width: 100%; margin-top: 6px; transition: all 0.2s; text-transform: uppercase;
      display: flex; align-items: center; justify-content: center; gap: 8px;
    }
    .btn-pos:hover { background: var(--mc-gold); color: #000; }

    /* Rotation Compass Pills */
    .radio-pill-group { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 6px; }
    .radio-pill {
      background: #0f172a; border: 2px solid #1e293b; border-radius: 8px; padding: 10px 6px;
      text-align: center; cursor: pointer; transition: all 0.15s; font-size: 12px; font-weight: 800;
      font-family: 'JetBrains Mono', monospace; color: var(--text-muted);
    }
    .radio-pill:hover { border-color: var(--mc-gold); color: #fff; }
    .radio-pill.active {
      background: linear-gradient(180deg, #f59e0b 0%, #b45309 100%);
      color: #000; font-weight: 900; border-color: #fef08a;
      box-shadow: 0 0 12px rgba(245, 158, 11, 0.4);
    }

    /* Minecraft File Upload Dropzone */
    .dropzone {
      border: 2px dashed #4b5563; border-radius: 10px; padding: 16px; text-align: center;
      background: rgba(9, 12, 19, 0.6); cursor: pointer; transition: all 0.2s; margin-bottom: 12px;
    }
    .dropzone:hover { border-color: var(--mc-gold); background: rgba(245, 158, 11, 0.05); }
    .dropzone-icon { font-size: 26px; margin-bottom: 4px; }
    .dropzone-text { font-size: 13px; font-weight: 700; color: var(--text-main); }
    .dropzone-hint { font-size: 11px; color: var(--text-muted); margin-top: 2px; }

    /* Primary Minecraft Action Button */
    .btn-launch {
      background: linear-gradient(180deg, #f59e0b 0%, #b45309 100%);
      color: #000;
      border: 2px solid #fbbf24;
      border-top-color: #fef08a;
      border-left-color: #fef08a;
      border-bottom-color: #78350f;
      border-right-color: #78350f;
      border-radius: 8px;
      padding: 14px 20px;
      font-size: 15px;
      font-family: 'Press Start 2P', monospace;
      cursor: pointer;
      width: 100%;
      box-shadow: 0 4px 0 #451a03, 0 8px 24px rgba(245, 158, 11, 0.45);
      transition: all 0.1s ease;
      margin-top: 14px;
      text-shadow: 0 1px 0 rgba(255,255,255,0.4);
    }
    .btn-launch:hover {
      background: linear-gradient(180deg, #fbbf24 0%, #d97706 100%);
      transform: translateY(-2px);
      box-shadow: 0 6px 0 #451a03, 0 10px 30px rgba(245, 158, 11, 0.6);
    }
    .btn-launch:active {
      transform: translateY(3px);
      box-shadow: 0 1px 0 #451a03;
    }

    /* Button Bar */
    .btn-group { display: flex; gap: 8px; margin-top: 10px; }
    .mc-btn {
      flex: 1;
      background: linear-gradient(180deg, #334155 0%, #1e293b 100%);
      border: 2px solid #475569;
      border-top-color: #64748b;
      border-left-color: #64748b;
      border-bottom-color: #0f172a;
      border-right-color: #0f172a;
      color: #fff;
      padding: 10px 8px;
      border-radius: 8px;
      font-weight: 800;
      font-size: 12px;
      cursor: pointer;
      box-shadow: 0 3px 0 #0f172a;
      transition: all 0.1s;
      text-transform: uppercase;
      display: flex; align-items: center; justify-content: center; gap: 4px;
    }
    .mc-btn:hover { background: #475569; transform: translateY(-1px); }
    .mc-btn:active { transform: translateY(2px); box-shadow: 0 1px 0 #0f172a; }

    .mc-btn-danger {
      background: linear-gradient(180deg, #ef4444 0%, #991b1b 100%);
      border-color: #f87171 #f87171 #450a0a #450a0a;
      box-shadow: 0 3px 0 #450a0a;
    }
    .mc-btn-purple {
      background: linear-gradient(180deg, #a855f7 0%, #6b21a8 100%);
      border-color: #c084fc #c084fc #3b0764 #3b0764;
      box-shadow: 0 3px 0 #3b0764;
    }

    /* Minecraft XP / Boss Bar */
    .xp-bar-container {
      width: 100%; height: 22px; background: #000;
      border: 2px solid #334155; border-radius: 4px;
      position: relative; overflow: hidden; margin: 12px 0 6px;
      box-shadow: inset 1px 1px 3px rgba(0,0,0,0.9);
    }
    .xp-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, #10b981 0%, #22c55e 50%, #f59e0b 100%);
      width: 0%;
      transition: width 0.3s ease;
      box-shadow: 0 0 12px rgba(34, 197, 94, 0.6);
    }
    .xp-bar-text {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      font-family: 'Press Start 2P', monospace; font-size: 10px; color: #fff;
      text-shadow: 1px 1px 0 #000, -1px -1px 0 #000;
    }

    /* Telemetry Metrics */
    .metric-card {
      background: var(--slot-bg);
      border: 2px solid #1e293b;
      border-top-color: #0a0f18;
      border-left-color: #0a0f18;
      border-bottom-color: #334155;
      border-right-color: #334155;
      border-radius: 8px;
      padding: 16px;
      text-align: center;
      box-shadow: inset 2px 2px 4px rgba(0,0,0,0.8);
    }
    .metric-val {
      font-size: 26px; font-weight: 900; color: #fbbf24;
      font-family: 'JetBrains Mono', monospace;
      text-shadow: 0 0 12px rgba(245, 158, 11, 0.4);
    }
    .metric-label {
      font-size: 11px; color: var(--text-muted); font-weight: 800;
      text-transform: uppercase; margin-top: 4px; letter-spacing: 0.5px;
    }

    /* Swarm Table */
    table { width: 100%; border-collapse: collapse; margin-top: 14px; }
    th, td { padding: 12px 14px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 14px; }
    th {
      font-family: 'Press Start 2P', monospace; font-size: 10px; color: #fbbf24;
      text-transform: uppercase; background: rgba(0,0,0,0.4);
    }
    .bot-avatar { width: 28px; height: 28px; border-radius: 4px; vertical-align: middle; margin-right: 8px; border: 1px solid #475569; }

    /* Console */
    .logs-console {
      height: 380px; background: #05070c; border: 2px solid #1e293b; border-radius: 8px;
      padding: 14px; font-family: 'JetBrains Mono', monospace; font-size: 13px;
      overflow-y: auto; color: #cbd5e1; box-shadow: inset 2px 2px 6px rgba(0,0,0,0.9);
    }
    .log-entry { margin-bottom: 4px; line-height: 1.5; }
    .log-builder { color: #fbbf24; }
    .log-schematic { color: #38bdf8; }
    .log-swarm { color: #c084fc; }
    .log-safety { color: #f87171; }
    .log-chat { color: #4ade80; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="brand">
        <img src="/public/icon.jpg" alt="Logo" class="brand-icon" onerror="this.style.display='none'">
        <div>
          <div class="logo-text">MINECRAFT BUILDER BOT</div>
          <div class="logo-sub">24/7 Autonomous Construction Engine</div>
        </div>
      </div>
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
          <h2>🧭 Target Build Origin</h2>
          <div class="coord-grid">
            <div class="coord-slot x-slot">
              <label>X-AXIS</label>
              <input type="number" id="origin-x" class="coord-input" value="0">
            </div>
            <div class="coord-slot y-slot">
              <label>Y-HEIGHT</label>
              <input type="number" id="origin-y" class="coord-input" value="64">
            </div>
            <div class="coord-slot z-slot">
              <label>Z-AXIS</label>
              <input type="number" id="origin-z" class="coord-input" value="0">
            </div>
          </div>
          <button class="btn-pos" onclick="useBotPosition()">📌 Set To Current Bot Position</button>

          <h3>🧭 Structure Rotation (Facing)</h3>
          <div class="radio-pill-group" id="rotation-group">
            <div class="radio-pill active" onclick="setRotation(0)">0° North</div>
            <div class="radio-pill" onclick="setRotation(90)">90° East</div>
            <div class="radio-pill" onclick="setRotation(180)">180° South</div>
            <div class="radio-pill" onclick="setRotation(270)">270° West</div>
          </div>

          <h3>🤖 Workforce Scale</h3>
          <select id="swarm-count-select">
            <option value="1">1 Bot (Solo Builder)</option>
            <option value="2">2 Bots (Duo Team)</option>
            <option value="3" selected>3 Bots (Trio Squad)</option>
            <option value="5">5 Bots (Fast Strike Team)</option>
            <option value="10">10 Bots (Full Swarm - 10x Speed)</option>
          </select>
        </div>

        <!-- Structure Selection -->
        <div class="card">
          <h2>📜 Select Structure to Build</h2>
          
          <h3>Mode A: Schematic File (.litematic / .nbt / .schem)</h3>
          <select id="schematic-select" style="margin-bottom: 12px;">
            <option value="">Loading schematics...</option>
          </select>

          <div class="dropzone" onclick="document.getElementById('schematic-upload').click()">
            <div class="dropzone-icon">📥</div>
            <div class="dropzone-text">Click or Drag Schematic File to Upload</div>
            <div class="dropzone-hint">Supports .litematic, .nbt, .schematic, .schem (Max 50MB)</div>
          </div>
          <input type="file" id="schematic-upload" accept=".litematic,.nbt,.schem,.schematic" style="display: none;">

          <h3>Mode B: Procedural Geometry Generator</h3>
          <div style="display: grid; grid-template-columns: 1.2fr 1.5fr 1fr; gap: 8px; margin-bottom: 14px;">
            <select id="procedural-shape">
              <option value="none">-- Use Schematic Instead --</option>
              <option value="floor">Floor / Platform</option>
              <option value="wall">Wall</option>
              <option value="box">Solid Box</option>
              <option value="cube">Hollow Cube</option>
              <option value="pyramid">Pyramid</option>
              <option value="dome">Dome / Sphere</option>
            </select>
            <input type="text" id="procedural-block" class="mc-input" placeholder="minecraft:stone_bricks" value="minecraft:stone_bricks">
            <input type="number" id="procedural-size" class="mc-input" placeholder="Size" value="8">
          </div>

          <button class="btn-launch" onclick="launchBuild()">🚀 Launch Build Mission</button>

          <div class="btn-group">
            <button class="mc-btn" onclick="pauseBuild()">⏸️ Pause</button>
            <button class="mc-btn" onclick="resumeBuild()">▶️ Resume</button>
            <button class="mc-btn mc-btn-danger" onclick="stopBuild()">🛑 Stop</button>
            <button class="mc-btn mc-btn-purple" onclick="undoBuild()">↩️ Undo</button>
            <button class="mc-btn" onclick="clearArea()">🧹 Clear</button>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB 2: SWARM FLEET -->
    <div id="tab-swarm" class="tab-content">
      <div class="card">
        <h2>🤖 Swarm Workforce Fleet Supervisor</h2>
        <p style="color: var(--text-muted); margin-bottom: 16px; font-size: 14px;">The 24/7 supervisor automatically spawns, auto-authenticates, and maintains worker bots across server restarts.</p>
        
        <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 16px;">
          <button class="mc-btn" onclick="spawnSwarm(3)">Spawn 3 Bots</button>
          <button class="mc-btn" onclick="spawnSwarm(5)">Spawn 5 Bots</button>
          <button class="mc-btn" onclick="spawnSwarm(10)">Spawn 10 Bots (Max)</button>
          <button class="mc-btn mc-btn-danger" onclick="stopSwarm()">Despawn Fleet</button>
        </div>

        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Bot Operator</th>
              <th>Status</th>
              <th>Coordinates</th>
              <th>Health</th>
            </tr>
          </thead>
          <tbody id="swarm-tbody">
            <tr><td colspan="5">Loading swarm telemetry...</td></tr>
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
          <div class="metric-val" id="metric-speed">0/s</div>
          <div class="metric-label">Placement Speed</div>
        </div>
        <div class="metric-card">
          <div class="metric-val" id="metric-percent">0%</div>
          <div class="metric-label">Completion Rate</div>
        </div>
      </div>

      <div class="card">
        <h2>🔨 Active Construction Task</h2>
        <div style="display: flex; justify-content: space-between; font-weight: 800; font-family: 'JetBrains Mono', monospace;">
          <span id="current-task-name">Job: None</span>
          <span id="current-task-percent" style="color: #fbbf24;">0%</span>
        </div>
        
        <!-- Minecraft XP Bar -->
        <div class="xp-bar-container">
          <div class="xp-bar-fill" id="progress-fill"></div>
          <div class="xp-bar-text" id="xp-bar-text">0%</div>
        </div>

        <div style="display: flex; justify-content: space-between; color: var(--text-muted); font-size: 13px; font-family: 'JetBrains Mono', monospace;">
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
          <input type="text" id="console-cmd" class="mc-input" placeholder="Type chat command (e.g. !build, !stop, !undo, !cleararea 10)..." onkeydown="if(event.key==='Enter')sendConsoleCommand()">
          <button class="mc-btn" onclick="sendConsoleCommand()" style="flex: 0 0 130px;">Execute</button>
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
        document.getElementById('xp-bar-text').innerText = (s.percent || 0) + '%';
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
            <td style="font-family:'Press Start 2P',monospace; font-size:11px;">#\${b.id}</td>
            <td style="font-weight:700; color:\${b.connected ? '#10b981' : '#ef4444'}">
              <img src="https://mc-heads.net/avatar/\${b.username}/28" class="bot-avatar" onerror="this.src='/public/icon.jpg'">
              \${b.username}
            </td>
            <td>\${b.connected ? '🟢 Connected' : (b.connecting ? '🟡 Connecting' : '⚪ Offline')}</td>
            <td style="font-family:'JetBrains Mono'">(\${b.coords.x}, \${b.coords.y}, \${b.coords.z})</td>
            <td>\${b.connected ? '❤️ ' + Math.round(b.health) + '/20' : '-'}</td>
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
          else if (l.category === 'Chat') cls += ' log-chat';
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
        bot.chat("Tip: For names with spaces, use the number from !schematics");
        return;
      }

      // Check if swarm subcommand: !schematic swarm <count> <name_or_number> [x y z] [rot]
      let swarmCount = 1;
      if (parts[0].toLowerCase() === "swarm") {
        parts.shift();
        swarmCount = parseInt(parts.shift(), 10) || 3;
      }

      const files = listSchematicFiles();

      // Smart parser: scan from the END of parts for optional rotation (single number)
      // then coordinates (3 numbers), then treat everything before as the schematic name.
      // This handles schematic names with spaces correctly.
      let coordParts = [];
      let rotation = 0;
      let remaining = [...parts];

      // Check if last token could be rotation (single number: 0, 90, 180, 270)
      if (remaining.length >= 1) {
        const maybeRot = parseInt(remaining[remaining.length - 1], 10);
        if (!isNaN(maybeRot) && [0, 90, 180, 270].includes(maybeRot) && remaining.length > 1) {
          // Check if the 4 tokens before are a valid coordinate triplet
          const maybeZ = parseInt(remaining[remaining.length - 2], 10);
          const maybeY = parseInt(remaining[remaining.length - 3], 10);
          const maybeX = parseInt(remaining[remaining.length - 4], 10);
          if (!isNaN(maybeX) && !isNaN(maybeY) && !isNaN(maybeZ) && remaining.length >= 4) {
            rotation = maybeRot;
            coordParts = [maybeX, maybeY, maybeZ];
            remaining = remaining.slice(0, remaining.length - 4);
          }
        }
      }

      // If rotation wasn't found above, check if last 3 tokens are coordinates
      if (coordParts.length === 0 && remaining.length >= 3) {
        const maybeX = parseInt(remaining[remaining.length - 3], 10);
        const maybeY = parseInt(remaining[remaining.length - 2], 10);
        const maybeZ = parseInt(remaining[remaining.length - 1], 10);
        if (!isNaN(maybeX) && !isNaN(maybeY) && !isNaN(maybeZ)) {
          coordParts = [maybeX, maybeY, maybeZ];
          remaining = remaining.slice(0, remaining.length - 3);
        }
      }

      // remaining now contains only the schematic name (possibly multi-word)
      const query = remaining.join(" ").trim();
      if (!query) {
        bot.chat("Usage: !schematic <number|name> [x y z] [rot 0|90|180|270]");
        return;
      }

      // Match by index number first, then by partial name
      let matchedFile = null;
      const num = parseInt(query, 10);
      if (!isNaN(num) && num >= 1 && num <= files.length) {
        matchedFile = files[num - 1];
      } else {
        // Fuzzy match: try full match, then word-by-word
        matchedFile = files.find((f) => f.toLowerCase().replace(/\.(litematic|nbt|schematic|schem)$/i, "") === query.toLowerCase());
        if (!matchedFile) {
          matchedFile = files.find((f) => f.toLowerCase().includes(query.toLowerCase()));
        }
        if (!matchedFile) {
          // Match by first word of query (for partial names)
          const firstWord = query.split(/\s+/)[0].toLowerCase();
          matchedFile = files.find((f) => f.toLowerCase().includes(firstWord));
        }
      }

      if (!matchedFile) {
        bot.chat(`[Builder] Schematic "${query}" not found. Type !schematics to see options.`);
        return;
      }

      // Build origin from parsed coordinates or default to bot's position
      let origin;
      if (coordParts.length === 3) {
        origin = new Vec3(coordParts[0], coordParts[1], coordParts[2]);
      } else {
        origin = bot.entity ? bot.entity.position.floored() : new Vec3(0, 64, 0);
      }

      // Validate origin — NaN coordinates crash the builder
      if (isNaN(origin.x) || isNaN(origin.y) || isNaN(origin.z)) {
        bot.chat(`[Builder] ❌ Invalid coordinates! Use: !schematic <name> <x> <y> <z>`);
        return;
      }

      try {
        const fullPath = path.join(SCHEMATICS_DIR, matchedFile);
        bot.chat(`[Builder] Loading "${matchedFile}"...`);
        const blocks = await loadSchematicFile(fullPath, rotation);
        if (!blocks || blocks.length === 0) {
          bot.chat(`[Builder] Error: Schematic "${matchedFile}" contained 0 blocks.`);
          return;
        }

        const jobName = matchedFile.replace(/\.(litematic|nbt|schem|schematic)$/i, "");
        bot.chat(`[Builder] ✅ Loaded "${jobName}" (${blocks.length} blocks) → Building at (${origin.x}, ${origin.y}, ${origin.z}) rot:${rotation}°`);

        if (swarmCount > 1 && swarm) {
          await swarm.spawnSwarm(swarmCount);
          // Give swarm bots time to connect before dispatching build
          await new Promise((r) => setTimeout(r, 3000));
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
      if (bot.game?.gameMode === "creative" && bot.creative && typeof bot.creative.startFlying === "function") {
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

/**
 * Cleanly destroys an old bot instance so no ghost session lingers on the server.
 * Aternos keeps the old session alive for ~8-12s — we must call bot.end() BEFORE
 * reconnecting, then wait for the server to expire the session.
 */
function destroyBot() {
  if (connectionTimeoutId) {
    clearTimeout(connectionTimeoutId);
    connectionTimeoutId = null;
  }
  if (bot) {
    try { bot.removeAllListeners(); } catch (_) {}
    try { bot.end(); } catch (_) {}
    bot = null;
  }
  if (safety) {
    try { safety.destroy(); } catch (_) {}
    safety = null;
  }
  if (builder) {
    try { builder.stop("Bot destroyed for reconnect"); } catch (_) {}
    builder = null;
  }
}

function createBuilderBot() {
  if (isReconnecting) return;

  // Destroy the previous bot instance to prevent duplicate_login and ghost sessions
  destroyBot();

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
      checkTimeoutInterval: 120000,
      hideErrors: true
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

  // Connection timeout: if we haven't spawned within 90s, something is wrong
  connectionTimeoutId = setTimeout(() => {
    if (!botState.connected) {
      addLog("[Timeout] No spawn received in 90s — restarting connection...", "General");
      botState.wasThrottled = true;
      destroyBot();
      scheduleReconnect();
    }
  }, 90000);

  let authHandled = false;
  let authTimeout = null;
  let spawnHandled = false;

  bot.once("spawn", () => {
    // Guard against double spawn (can happen on some proxy servers)
    if (spawnHandled) return;
    spawnHandled = true;

    if (connectionTimeoutId) {
      clearTimeout(connectionTimeoutId);
      connectionTimeoutId = null;
    }

    botState.connected = true;
    botState.reconnectAttempts = 0;
    botState.isDuplicateLogin = false;
    isReconnecting = false;

    addLog(`🟢 ${username} successfully spawned in world!`, "General");

    // Initialize safety
    safety.init();

    // Register with swarm supervisor
    swarm.registerPrimaryBot(bot, builder, safety);

    // Reactive auth: if no server auth prompt is detected in 4s, use failsafe
    const authConfig = config.utils?.["auto-auth"];
    if (authConfig && authConfig.enabled) {
      authTimeout = setTimeout(() => {
        if (!authHandled && bot && botState.connected) {
          authHandled = true;
          addLog("[Auth] No server prompt detected after 4s, sending /login failsafe...", "General");
          try { bot.chat(`/login ${authConfig.password}`); } catch (_) {}
          // Then try /register 3s later (in case account doesn't exist yet)
          setTimeout(() => {
            if (bot && botState.connected && !authHandled) {
              try { bot.chat(`/register ${authConfig.password} ${authConfig.password}`); } catch (_) {}
            }
          }, 3000);
        }
      }, 4000);
    }

    // Creative mode: attempt 6s after spawn (after auth should be done)
    if (serverConfig.tryCreative) {
      setTimeout(() => {
        if (bot && botState.connected && bot.game?.gameMode !== "creative") {
          try {
            bot.chat("/gamemode creative");
            addLog("[Gamemode] Attempted /gamemode creative (requires OP)", "General");
          } catch (_) {}
        }
      }, 6000);
    }
  });

  // Reactive auth on server message strings
  bot.on("messagestr", (message) => {
    const authConfig = config.utils?.["auto-auth"];
    if (authConfig && authConfig.enabled && !authHandled) {
      const msg = message.toLowerCase();
      if (msg.includes("/register") || msg.includes("register ") || msg.includes("비밀번호")) {
        authHandled = true;
        if (authTimeout) { clearTimeout(authTimeout); authTimeout = null; }
        addLog("[Auth] Detected register prompt - sending /register", "General");
        try { bot.chat(`/register ${authConfig.password} ${authConfig.password}`); } catch (_) {}
      } else if (msg.includes("/login") || msg.includes("login ") || msg.includes("로그인")) {
        authHandled = true;
        if (authTimeout) { clearTimeout(authTimeout); authTimeout = null; }
        addLog("[Auth] Detected login prompt - sending /login", "General");
        try { bot.chat(`/login ${authConfig.password}`); } catch (_) {}
      }
    }

    if (
      message.includes("commands.gamemode.success.self") ||
      message.includes("Set own game mode to Creative Mode") ||
      message.includes("game mode has been updated")
    ) {
      addLog("👑 Bot confirmed in Creative Mode.", "General");
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

  bot.on("kicked", (reason) => {
    let kickReason = reason;
    try {
      if (typeof reason === "object") kickReason = JSON.stringify(reason);
    } catch (_) {}
    addLog(`⚠️ [Kicked] Bot was kicked by server: ${kickReason}`, "General");
    console.error(`[General] ⚠️ Bot was kicked: ${kickReason}`);

    const rStr = String(kickReason).toLowerCase();

    // duplicate_login: old session still alive — need extra wait for Aternos to expire it
    if (rStr.includes("duplicate_login") || rStr.includes("already connected")) {
      addLog("[Auth] Duplicate session detected — will wait 25s for Aternos to expire old session.", "General");
      botState.isDuplicateLogin = true;
    }

    if (
      rStr.includes("throttl") ||
      rStr.includes("wait") ||
      rStr.includes("too fast") ||
      rStr.includes("flying") ||
      rStr.includes("econnreset")
    ) {
      botState.wasThrottled = true;
    }
  });

  bot.on("error", (err) => {
    const msg = err.message || String(err);
    addLog(`[Bot Error] ${msg}`, "General");
    if (msg.includes("ECONNRESET") || msg.includes("ETIMEDOUT") || msg.includes("EPIPE")) {
      botState.wasThrottled = true;
    }
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
  const base = config.utils?.["auto-reconnect-delay"] || 10000;
  const max = config.utils?.["max-reconnect-delay"] || 60000;
  let delay = Math.min(base * Math.pow(1.25, botState.reconnectAttempts - 1), max);

  if (botState.isDuplicateLogin) {
    // Must wait for Aternos to expire the old session (typically 15-25s)
    delay = Math.max(delay, 25000);
    botState.isDuplicateLogin = false;
    addLog(`[Reconnect] Waiting 25s for Aternos to expire duplicate session before reconnecting...`, "General");
  } else if (botState.wasThrottled) {
    delay = Math.max(delay, 15000);
    botState.wasThrottled = false;
  }

  addLog(`Reconnecting in ${(delay / 1000).toFixed(1)}s (Attempt #${botState.reconnectAttempts})...`, "General");

  if (reconnectTimeoutId) clearTimeout(reconnectTimeoutId);
  reconnectTimeoutId = setTimeout(() => {
    isReconnecting = false;
    createBuilderBot();
  }, delay);
}

process.on("uncaughtException", (err) => {
  const msg = err.message || String(err);
  addLog(`[Handled Error] ${msg}`, "General");
  if (msg.includes("ECONNRESET") || msg.includes("ETIMEDOUT") || msg.includes("EPIPE") || msg.includes("PartialReadError")) {
    botState.wasThrottled = true;
  }
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
