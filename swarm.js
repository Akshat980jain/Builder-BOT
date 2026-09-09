"use strict";

const mineflayer = require("mineflayer");
const { Vec3 } = require("vec3");
const BuilderManager = require("./builder");
const SafetyManager = require("./safety");
const config = require("./settings.json");

class SwarmManager {
  constructor(serverConfig, addLogCallback, broadcastStateCallback) {
    this.serverConfig = serverConfig || config.server;
    this.addLog = addLogCallback || console.log;
    this.broadcastState = broadcastStateCallback || (() => {});
    this.bots = new Map(); // id (1..10) -> { bot, builder, safety, id, username, connected, connecting, reconnectAttempts }
    this.reconnectQueue = [];
    this.isProcessingQueue = false;
    this.maxBots = 10;
    this.targetBots = config.swarm?.targetCount || 10;
    this.supervisorInterval = null;
    this.isSupervisorRunning = false;
    this.staggerDelay = config.swarm?.staggerJoinDelay || 6000;
    this.authPassword = config.swarm?.autoAuthPassword || config.utils?.["auto-auth"]?.password || "chalol78";
  }

  registerPrimaryBot(bot, builder, safety) {
    this.bots.set(1, {
      id: 1,
      username: config.bot?.username || "Builder_Bot",
      bot,
      builder,
      safety,
      connected: true,
      connecting: false,
      reconnectAttempts: 0
    });

    if (config.swarm?.enabled && config.swarm?.autoSpawnAll) {
      this.startSupervisor();
    }
  }

  getBotName(id) {
    if (id === 1) return config.bot?.username || "Builder_Bot";
    return `Builder_Bot_${id}`;
  }

  startSupervisor() {
    if (this.isSupervisorRunning) return;
    this.isSupervisorRunning = true;

    this.addLog(`[Swarm Supervisor] 🛡️ 24/7 Fleet Watchdog active. Target: ${this.targetBots} bots.`, "Swarm");
    this.ensureAllBotsAlive();

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
    if (config.swarm && config.swarm.enabled === false) return;

    for (let id = 2; id <= this.targetBots; id++) {
      const entry = this.bots.get(id);
      const isConnected = entry && entry.connected && entry.bot && entry.bot.entity;
      const isConnecting = entry && entry.connecting;
      const isInQueue = this.reconnectQueue.includes(id);

      if (!isConnected && !isConnecting && !isInQueue) {
        this.enqueueReconnect(id, 1000);
      }
    }
  }

  async spawnSwarm(count = 10) {
    this.targetBots = Math.min(Math.max(parseInt(count, 10) || 10, 1), this.maxBots);
    this.addLog(`[Swarm] Adjusting fleet target to ${this.targetBots} bots...`, "Swarm");
    this.startSupervisor();
    this.ensureAllBotsAlive();
    return this.targetBots;
  }

  despawnBot(id) {
    const entry = this.bots.get(id);
    if (entry && entry.bot) {
      if (entry.builder) entry.builder.stop("Despawn requested");
      try { entry.bot.quit(); } catch (_) {}
      this.bots.delete(id);
      this.addLog(`[Swarm] Despawned Bot ${id} (${entry.username}).`, "Swarm");
    }
  }

  despawnSwarm(keepPrimary = true) {
    this.stopSupervisor();
    this.reconnectQueue = [];
    for (let id = keepPrimary ? 2 : 1; id <= this.maxBots; id++) {
      this.despawnBot(id);
    }
    this.targetBots = keepPrimary ? 1 : 0;
    this.addLog("[Swarm] Swarm fleet despawned.", "Swarm");
  }

  enqueueReconnect(id, delayMs = 1000) {
    if (this.reconnectQueue.includes(id)) return;
    this.reconnectQueue.push(id);

    setTimeout(() => {
      this.processReconnectQueue();
    }, delayMs);
  }

  async processReconnectQueue() {
    if (this.isProcessingQueue || this.reconnectQueue.length === 0) return;
    this.isProcessingQueue = true;

    try {
      while (this.reconnectQueue.length > 0) {
        const id = this.reconnectQueue.shift();
        if (id > this.targetBots) continue;

        await this.connectWorkerBot(id);
        await new Promise((r) => setTimeout(r, this.staggerDelay));
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  connectWorkerBot(id) {
    return new Promise((resolve) => {
      const username = this.getBotName(id);
      let entry = this.bots.get(id) || {
        id,
        username,
        bot: null,
        builder: null,
        safety: null,
        connected: false,
        connecting: true,
        reconnectAttempts: 0
      };

      entry.connecting = true;
      this.bots.set(id, entry);

      this.addLog(`[Swarm] Connecting Bot #${id} (${username}) to ${this.serverConfig.ip}:${this.serverConfig.port}...`, "Swarm");

      let workerBot = null;
      try {
        workerBot = mineflayer.createBot({
          host: this.serverConfig.ip,
          port: this.serverConfig.port,
          username,
          version: this.serverConfig.version || "1.21.4",
          checkTimeoutInterval: 120000,
          hideErrors: true
        });
      } catch (err) {
        this.addLog(`[Swarm] Failed creating Bot #${id}: ${err.message}`, "Swarm");
        entry.connecting = false;
        resolve(false);
        return;
      }

      const safety = new SafetyManager(workerBot, config);
      const builder = new BuilderManager(workerBot, config, safety);
      entry.bot = workerBot;
      entry.safety = safety;
      entry.builder = builder;

      let authHandled = false;
      let authTimeout = null;

      workerBot.once("spawn", () => {
        entry.connected = true;
        entry.connecting = false;
        entry.reconnectAttempts = 0;
        safety.init();

        this.addLog(`[Swarm] 🟢 Bot #${id} (${username}) spawned and ready!`, "Swarm");

        // Failsafe auto-auth if no prompt received
        authTimeout = setTimeout(() => {
          if (!authHandled && workerBot) {
            authHandled = true;
            try { workerBot.chat(`/login ${this.authPassword}`); } catch (_) {}
          }
        }, 3500);

        // Delayed gamemode attempt
        if (this.serverConfig.tryCreative) {
          setTimeout(() => {
            if (workerBot && workerBot.game?.gameMode !== "creative") {
              try { workerBot.chat("/gamemode creative"); } catch (_) {}
            }
          }, 5000);
        }

        resolve(true);
      });

      // Reactive auth listener
      workerBot.on("messagestr", (message) => {
        if (authHandled) return;
        const msg = message.toLowerCase();
        if (msg.includes("/register") || msg.includes("register ")) {
          authHandled = true;
          if (authTimeout) clearTimeout(authTimeout);
          try { workerBot.chat(`/register ${this.authPassword} ${this.authPassword}`); } catch (_) {}
        } else if (msg.includes("/login") || msg.includes("login ")) {
          authHandled = true;
          if (authTimeout) clearTimeout(authTimeout);
          try { workerBot.chat(`/login ${this.authPassword}`); } catch (_) {}
        }
      });

      workerBot.on("kicked", (reason) => {
        let kickReason = reason;
        try {
          if (typeof reason === "object") kickReason = JSON.stringify(reason);
        } catch (_) {}
        this.addLog(`[Swarm] ⚠️ Bot #${id} kicked: ${kickReason}`, "Swarm");
      });

      workerBot.on("error", (err) => {
        this.addLog(`[Swarm] Bot #${id} error: ${err.message}`, "Swarm");
      });

      workerBot.on("end", (reason) => {
        entry.connected = false;
        entry.connecting = false;
        if (safety) safety.destroy();
        this.addLog(`[Swarm] Bot #${id} disconnected: ${reason}`, "Swarm");

        if (this.isSupervisorRunning && id <= this.targetBots) {
          entry.reconnectAttempts++;
          const delay = Math.min(10000 * Math.pow(1.25, entry.reconnectAttempts), 60000);
          this.enqueueReconnect(id, delay);
        }
      });
    });
  }

  /**
   * Distributes a build plan across all connected swarm bots
   */
  async startSwarmBuild(name, blocks, originPos) {
    const activeBots = Array.from(this.bots.values()).filter((b) => b.connected && b.builder);
    if (activeBots.length === 0) {
      this.addLog("[Swarm] No active builder bots online to execute build!", "Swarm");
      return false;
    }

    const botCount = activeBots.length;
    this.addLog(`[Swarm] 🚀 Distributing build "${name}" (${blocks.length} blocks) across ${botCount} bots...`, "Swarm");

    // Partition blocks by horizontal slices along the X axis
    const chunkSize = Math.ceil(blocks.length / botCount);
    const promises = [];

    for (let i = 0; i < botCount; i++) {
      const slice = blocks.slice(i * chunkSize, (i + 1) * chunkSize);
      if (slice.length > 0) {
        const worker = activeBots[i];
        promises.push(worker.builder.startBuild(`${name}-part${i + 1}`, slice, originPos));
      }
    }

    return Promise.all(promises);
  }

  stopSwarm(reason = "Swarm stopped") {
    for (const entry of this.bots.values()) {
      if (entry.builder) entry.builder.stop(reason);
    }
  }

  getSwarmStatus() {
    const list = [];
    for (let id = 1; id <= this.maxBots; id++) {
      const entry = this.bots.get(id);
      if (entry) {
        const p = entry.bot && entry.bot.entity ? entry.bot.entity.position.floored() : { x: 0, y: 0, z: 0 };
        list.push({
          id,
          username: entry.username,
          connected: entry.connected,
          connecting: entry.connecting,
          coords: p,
          health: entry.bot ? entry.bot.health : 0,
          state: entry.builder ? entry.builder.state : "OFFLINE"
        });
      } else {
        list.push({
          id,
          username: this.getBotName(id),
          connected: false,
          connecting: false,
          coords: { x: 0, y: 0, z: 0 },
          health: 0,
          state: "UNSPAWNED"
        });
      }
    }
    return list;
  }
}

module.exports = SwarmManager;
