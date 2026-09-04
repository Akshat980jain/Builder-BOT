'use strict';

const mineflayer = require('mineflayer');
const { pathfinder, Movements } = require('mineflayer-pathfinder');
const { Builder } = require('./builder');
const { installChatCompat } = require('./chatCompat');
const { installFabricSpoof } = require('./fabricSpoof');

let defaultConfig = {};
try {
  defaultConfig = require('../settings.json');
} catch (_) {}

/**
 * 24/7 Persistent Swarm Manager for Minecraft Builder Bot.
 * Maintains a persistent fleet of 10 bots, with auto-reconnect,
 * dual-auth registration/login, anti-AFK, and parallel schematic building.
 */
class SwarmManager {
  constructor(mainBot, options = {}, config = null) {
    this.mainBot = mainBot || null;
    this.mainBuilder = null;
    this.config = config || defaultConfig;

    // Server connection parameters (Direct vs ViaProxy)
    const viaProxy = this.config.server?.viaProxy;
    if (viaProxy && viaProxy.enabled) {
      this.host = viaProxy.host || '127.0.0.1';
      this.port = Number(viaProxy.port || 25577);
      this.version = '1.21.4';
    } else {
      this.host = options.host || this.config.server?.ip || 'akshat908-qceo.aternos.me';
      this.port = Number(options.port || this.config.server?.port || 14539);
      this.version = options.version || this.config.server?.version || '1.21.4';
    }

    this.maxWorkers = 10;
    this.targetWorkers = this.config.swarm?.targetCount || 10;
    this.placeDelayMs = options.placeDelayMs || this.config.swarm?.placeDelayMs || 80;
    this.staggerDelay = this.config.swarm?.staggerJoinDelay || 6000;
    this.authPassword = this.config.swarm?.autoAuthPassword || this.config.utils?.['auto-auth']?.password || 'chalol78';

    this.workers = new Map(); // id (2..10) -> { id, bot, builder, username, connected, connecting, reconnectAttempts }
    this.heartbeatTimers = new Map();
    this.reconnectQueue = [];
    this.isProcessingQueue = false;
    this.supervisorInterval = null;
    this.isSupervisorRunning = false;
  }

  registerMainBot(bot, builder) {
    this.mainBot = bot;
    this.mainBuilder = builder;
    this.startSupervisor();
  }

  getWorkerCount() {
    let count = 1; // main bot
    for (const entry of this.workers.values()) {
      if (entry && entry.connected) count++;
    }
    return count;
  }

  getBotName(id) {
    if (id === 1) return this.config.bot?.username || 'BuilderBot';
    return `BuilderBot_${id}`;
  }

  /**
   * Starts the 24/7 Watchdog Supervisor
   */
  startSupervisor() {
    if (this.isSupervisorRunning) return;
    this.isSupervisorRunning = true;

    console.log(`[Swarm Supervisor] 🛡️ 24/7 Fleet Watchdog started. Target fleet: ${this.targetWorkers} bots.`);

    // Trigger initial check
    this.ensureAllBotsAlive();

    // Check every 12 seconds
    this.supervisorInterval = setInterval(() => {
      this.ensureAllBotsAlive();
    }, 12000);
  }

  stopSupervisor() {
    if (this.supervisorInterval) {
      clearInterval(this.supervisorInterval);
      this.supervisorInterval = null;
    }
    this.isSupervisorRunning = false;
  }

  ensureAllBotsAlive() {
    if (this.config.swarm?.enabled === false) return;

    for (let id = 2; id <= this.targetWorkers; id++) {
      const entry = this.workers.get(id);
      const isConnected = entry && entry.connected && entry.bot && entry.bot.entity;
      const isConnecting = entry && entry.connecting;
      const isInQueue = this.reconnectQueue.includes(id);

      if (!isConnected && !isConnecting && !isInQueue) {
        this.enqueueReconnect(id, 1000);
      }
    }
  }

  async setWorkerCount(count) {
    this.targetWorkers = Math.max(1, Math.min(this.maxWorkers, parseInt(count, 10) || 10));
    console.log(`[Swarm] Fleet target count set to ${this.targetWorkers} bots.`);

    // Despawn excess bots
    for (let id = this.targetWorkers + 1; id <= this.maxWorkers; id++) {
      this.despawnWorker(id);
    }

    this.startSupervisor();
    this.ensureAllBotsAlive();
    return this.targetWorkers;
  }

  spawnSwarm(count = 10) {
    return this.setWorkerCount(count);
  }

  despawnWorker(id) {
    if (id <= 1 || id > this.maxWorkers) return;

    const qIdx = this.reconnectQueue.indexOf(id);
    if (qIdx !== -1) this.reconnectQueue.splice(qIdx, 1);

    this.cleanUpBot(id);

    if (this.workers.has(id)) {
      const entry = this.workers.get(id);
      if (entry.builder) {
        try { entry.builder.cancel(); } catch (_) {}
      }
      if (entry.bot) {
        try { entry.bot.quit('Despawned by command'); } catch (_) {}
      }
      this.workers.delete(id);
    }
    console.log(`[Swarm] Worker ${id} despawned cleanly.`);
  }

  despawnSwarm(keepPrimary = true) {
    this.reconnectQueue = [];
    const startId = keepPrimary ? 2 : 1;
    for (let id = startId; id <= this.maxWorkers; id++) {
      this.despawnWorker(id);
    }
    this.targetWorkers = keepPrimary ? 1 : 0;
    console.log(`[Swarm] All worker bots despawned. Primary preserved.`);
  }

  spawnWorkerAndWait(id) {
    return new Promise((resolve, reject) => {
      let entry = this.workers.get(id);
      if (entry && entry.connected && entry.bot && entry.bot.entity) {
        return resolve(entry);
      }

      const username = this.getBotName(id);

      if (!entry) {
        entry = {
          id,
          username,
          bot: null,
          builder: null,
          connected: false,
          connecting: true,
          reconnectAttempts: 0,
        };
        this.workers.set(id, entry);
      } else {
        entry.connecting = true;
        entry.connected = false;
      }

      console.log(`[Swarm] 🔌 Connecting ${username} (${id}/10) to ${this.host}:${this.port}...`);

      let resolved = false;

      try {
        const bot = mineflayer.createBot({
          host: this.host,
          port: Number(this.port),
          username,
          version: this.version,
          auth: 'offline',
          checkTimeoutInterval: 120000,
          hideErrors: false,
        });

        entry.bot = bot;

        bot.loadPlugin(pathfinder);
        installChatCompat(bot);
        installFabricSpoof(bot);

        const builder = new Builder(bot, { placeDelayMs: this.placeDelayMs });
        entry.builder = builder;

        // Smart Dual-Auth Chat Listener
        const handleAuthMessage = (msg) => {
          const text = (typeof msg === 'string' ? msg : msg.toString()).toLowerCase();
          if (text.includes('/register') || text.includes('register with') || text.includes('register password')) {
            setTimeout(() => {
              try { bot.chat(`/register ${this.authPassword} ${this.authPassword}`); } catch (_) {}
            }, 800);
          } else if (text.includes('/login') || text.includes('please login') || text.includes('use /login')) {
            setTimeout(() => {
              try { bot.chat(`/login ${this.authPassword}`); } catch (_) {}
            }, 800);
          }
        };

        bot.on('message', handleAuthMessage);

        bot.once('spawn', () => {
          entry.connected = true;
          entry.connecting = false;
          entry.reconnectAttempts = 0;
          console.log(`[Swarm] ✅ ${username} spawned successfully in world!`);

          const defaultMove = new Movements(bot);
          bot.pathfinder.setMovements(defaultMove);

          // Dual-Action Auto-Auth sequence:
          // 1. Send /register in case bot is new
          // 2. Send /login in case bot is already registered
          setTimeout(() => {
            try { bot.chat(`/register ${this.authPassword} ${this.authPassword}`); } catch (_) {}
          }, 1200);

          setTimeout(() => {
            try { bot.chat(`/login ${this.authPassword}`); } catch (_) {}
          }, 2600);

          // Put worker into creative mode
          setTimeout(() => {
            try { bot.chat(`/gamemode creative ${username}`); } catch (_) {}
          }, 4500);

          // 24/7 Anti-AFK Routine (Arm swing + Micro-yaw + Sneak pulse)
          if (this.heartbeatTimers.has(id)) clearInterval(this.heartbeatTimers.get(id));
          let afkTick = 0;
          const hb = setInterval(() => {
            if (bot && entry.connected && bot.entity) {
              try {
                afkTick++;
                bot.swingArm();
                const yaw = bot.entity.yaw;
                const pitch = bot.entity.pitch;
                const offset = afkTick % 2 === 0 ? 0.05 : -0.05;
                bot.look(yaw + offset, pitch, true).catch(() => {});

                if (afkTick % 3 === 0) {
                  bot.setControlState('sneak', true);
                  setTimeout(() => {
                    try { bot.setControlState('sneak', false); } catch (_) {}
                  }, 1000);
                }
              } catch (_) {}
            }
          }, 20000);
          this.heartbeatTimers.set(id, hb);

          if (!resolved) {
            resolved = true;
            resolve(entry);
          }
        });

        bot.on('kicked', (reason) => {
          const reasonStr = typeof reason === 'object' ? JSON.stringify(reason) : String(reason);
          console.log(`[Swarm] ⚠️ ${username} kicked: ${reasonStr}`);
          entry.connected = false;
          entry.connecting = false;
          this.cleanUpBot(id);
          this.enqueueReconnect(id, 8000);

          if (!resolved) {
            resolved = true;
            reject(new Error(`Kicked: ${reasonStr}`));
          }
        });

        bot.on('end', () => {
          console.log(`[Swarm] 🔌 ${username} connection ended. Scheduling auto-reconnect...`);
          entry.connected = false;
          entry.connecting = false;
          this.cleanUpBot(id);
          this.enqueueReconnect(id, 5000);

          if (!resolved) {
            resolved = true;
            reject(new Error('Connection ended'));
          }
        });

        bot.on('error', (err) => {
          console.log(`[Swarm] ${username} notice: ${err.message}`);
        });

        // Fail-safe timeout
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            entry.connecting = false;
            this.cleanUpBot(id);
            this.enqueueReconnect(id, 6000);
            reject(new Error('Connection timeout (25s)'));
          }
        }, 25000);

      } catch (e) {
        entry.connecting = false;
        if (!resolved) {
          resolved = true;
          this.enqueueReconnect(id, 6000);
          reject(e);
        }
      }
    });
  }

  cleanUpBot(id) {
    if (this.heartbeatTimers.has(id)) {
      clearInterval(this.heartbeatTimers.get(id));
      this.heartbeatTimers.delete(id);
    }
    if (this.workers.has(id)) {
      const entry = this.workers.get(id);
      entry.connected = false;
      if (entry.bot) {
        try { entry.bot.removeAllListeners(); } catch (_) {}
      }
    }
  }

  enqueueReconnect(id, delay = 0) {
    if (id <= 1 || id > this.targetWorkers) return;
    if (this.reconnectQueue.includes(id)) return;

    const entry = this.workers.get(id);
    if (entry && entry.connected) return;

    if (delay > 0) {
      setTimeout(() => {
        if (!this.reconnectQueue.includes(id)) {
          this.reconnectQueue.push(id);
          this.processReconnectQueue();
        }
      }, delay);
    } else {
      this.reconnectQueue.push(id);
      this.processReconnectQueue();
    }
  }

  async processReconnectQueue() {
    if (this.isProcessingQueue || this.reconnectQueue.length === 0) return;
    this.isProcessingQueue = true;

    while (this.reconnectQueue.length > 0) {
      const nextId = this.reconnectQueue.shift();
      const entry = this.workers.get(nextId);

      if (entry && entry.connected && entry.bot && entry.bot.entity) continue;

      await this.sleep(this.staggerDelay);

      try {
        await this.spawnWorkerAndWait(nextId);
      } catch (err) {
        const attempts = (entry ? entry.reconnectAttempts : 0) + 1;
        if (entry) entry.reconnectAttempts = attempts;
        const backoff = Math.min(this.staggerDelay * Math.min(attempts, 4), 30000);
        console.log(`[Swarm] Reconnect for Bot ${nextId} failed (${err.message}). Retrying in ${(backoff / 1000).toFixed(0)}s...`);
        this.enqueueReconnect(nextId, backoff);
      }
    }

    this.isProcessingQueue = false;
  }

  cancelAll() {
    if (this.mainBuilder) {
      try { this.mainBuilder.cancel(); } catch (_) {}
    }
    for (const w of this.workers.values()) {
      if (w && w.builder) {
        try { w.builder.cancel(); } catch (_) {}
      }
    }
  }

  /**
   * Partitions the block queue across all active swarm workers and builds in parallel.
   */
  async buildParallel(mainBuilder, blocks, origin, onProgress) {
    const activeWorkers = Array.from(this.workers.values()).filter(
      (w) => w.connected && w.builder && w.bot && w.bot.entity
    );
    const totalWorkers = 1 + activeWorkers.length;

    if (totalWorkers === 1) {
      mainBuilder.enqueue(blocks, origin);
      return mainBuilder.run(onProgress);
    }

    console.log(`[Swarm Build] Distributing ${blocks.length} blocks across ${totalWorkers} builder bots!`);

    const chunks = Array.from({ length: totalWorkers }, () => []);
    for (let i = 0; i < blocks.length; i++) {
      chunks[i % totalWorkers].push(blocks[i]);
    }

    let globalPlaced = 0;
    const total = blocks.length;
    const progressMap = new Map();

    const reportProgress = (workerId, placed, workerTotal, done) => {
      progressMap.set(workerId, placed);
      let sum = 0;
      for (const p of progressMap.values()) sum += p;
      globalPlaced = sum;

      if (onProgress) {
        const left = Math.max(0, total - globalPlaced);
        const percent = total > 0 ? ((globalPlaced / total) * 100).toFixed(1) : 100;
        onProgress(globalPlaced, total, left, percent, done);
      }
    };

    const tasks = [];

    // Main bot task
    mainBuilder.enqueue(chunks[0], origin);
    tasks.push(
      mainBuilder.run((p, t, l, pct, done) => reportProgress('main', p, t, done))
    );

    // Helper worker tasks
    for (let i = 0; i < activeWorkers.length; i++) {
      const w = activeWorkers[i];
      if (mainBuilder.currentJob) {
        w.builder.setJob(mainBuilder.currentJob.name || 'ParallelBuild');
      }
      w.builder.enqueue(chunks[i + 1], origin);
      tasks.push(
        w.builder.run((p, t, l, pct, done) => reportProgress(w.username, p, t, done))
      );
    }

    const results = await Promise.all(tasks);
    const anyCancelled = results.some((r) => r && r.cancelled);
    const left = Math.max(0, total - globalPlaced);
    const percent = total > 0 ? ((globalPlaced / total) * 100).toFixed(1) : 100;

    return { placed: globalPlaced, total, left, percent, cancelled: anyCancelled };
  }

  getSwarmStatus() {
    const list = [];

    // Bot 1 (Main Bot)
    const mainPos = this.mainBot && this.mainBot.entity ? this.mainBot.entity.position.floored() : null;
    list.push({
      id: 1,
      username: this.getBotName(1),
      connected: !!(this.mainBot && this.mainBot.entity),
      connecting: false,
      state: this.mainBuilder && this.mainBuilder.isBuilding() ? 'BUILDING' : (this.mainBot ? 'IDLE' : 'OFFLINE'),
      health: this.mainBot ? this.mainBot.health : 0,
      food: this.mainBot ? this.mainBot.food : 0,
      pos: mainPos ? { x: mainPos.x, y: mainPos.y, z: mainPos.z } : null,
      isBuilding: this.mainBuilder ? this.mainBuilder.isBuilding() : false,
    });

    // Bots 2..10
    for (let id = 2; id <= this.maxWorkers; id++) {
      const entry = this.workers.get(id);
      const pos = entry && entry.bot && entry.bot.entity ? entry.bot.entity.position.floored() : null;
      list.push({
        id,
        username: entry ? entry.username : this.getBotName(id),
        connected: entry ? entry.connected : false,
        connecting: entry ? entry.connecting : false,
        state: entry && entry.builder && entry.builder.isBuilding() ? 'BUILDING' : (entry && entry.connected ? 'IDLE' : 'OFFLINE'),
        health: entry && entry.bot ? entry.bot.health : 0,
        food: entry && entry.bot ? entry.bot.food : 0,
        pos: pos ? { x: pos.x, y: pos.y, z: pos.z } : null,
        isBuilding: entry && entry.builder ? entry.builder.isBuilding() : false,
      });
    }

    return list;
  }

  sleep(ms) {
    return new Promise((res) => setTimeout(res, ms));
  }
}

module.exports = { SwarmManager };
