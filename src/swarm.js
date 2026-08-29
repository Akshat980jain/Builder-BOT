'use strict';

const mineflayer = require('mineflayer');
const { pathfinder, Movements } = require('mineflayer-pathfinder');
const { Builder } = require('./builder');
const { installChatCompat } = require('./chatCompat');

/**
 * Manages a team of helper builder bots to build schematics in parallel.
 */
class SwarmManager {
  constructor(mainBot, {
    host = '127.0.0.1',
    port = 25577,
    version = '1.21.4',
    maxWorkers = 10,
    placeDelayMs = 80,
  } = {}) {
    this.mainBot = mainBot;
    this.host = host;
    this.port = port;
    this.version = version;
    this.maxWorkers = maxWorkers;
    this.placeDelayMs = placeDelayMs;

    this.workers = []; // [{ bot, builder, username }]
    this.activeWorkerCount = 1; // 1 = main bot only
  }

  getWorkerCount() {
    return 1 + this.workers.length;
  }

  async setWorkerCount(count) {
    const target = Math.max(1, Math.min(this.maxWorkers, count));
    const needed = target - 1;

    // Despawn excess
    while (this.workers.length > needed) {
      const w = this.workers.pop();
      try {
        w.builder.cancel();
        w.bot.quit();
      } catch (e) {}
    }

    // Spawn needed
    while (this.workers.length < needed) {
      const index = this.workers.length + 2; // e.g. BuilderBot_2
      const username = `BuilderBot_${index}`;
      try {
        const worker = await this._spawnWorker(username);
        this.workers.push(worker);
      } catch (err) {
        console.error(`[Swarm] Failed to spawn ${username}:`, err.message);
        break;
      }
    }

    this.activeWorkerCount = 1 + this.workers.length;
    return this.activeWorkerCount;
  }

  _spawnWorker(username) {
    return new Promise((resolve, reject) => {
      const bot = mineflayer.createBot({
        host: this.host,
        port: Number(this.port),
        username,
        version: this.version,
        auth: 'offline',
      });

      bot.loadPlugin(pathfinder);
      installChatCompat(bot);
      const builder = new Builder(bot, { placeDelayMs: this.placeDelayMs });

      const timeout = setTimeout(() => {
        try { bot.quit(); } catch (e) {}
        reject(new Error(`Timeout spawning worker ${username}`));
      }, 15000);

      bot.once('spawn', () => {
        clearTimeout(timeout);
        const defaultMove = new Movements(bot);
        bot.pathfinder.setMovements(defaultMove);

        // Put worker into creative mode
        try { bot.chat(`/gamemode creative ${username}`); } catch (e) {}
        console.log(`[Swarm] Worker ${username} joined the build team!`);
        resolve({ bot, builder, username });
      });

      bot.on('error', (err) => {
        console.error(`[Swarm Worker ${username}] Error:`, err.message);
      });
    });
  }

  cancelAll() {
    for (const w of this.workers) {
      try { w.builder.cancel(); } catch (e) {}
    }
  }

  /**
   * Partitions the block queue across all active swarm workers and builds in parallel.
   */
  async buildParallel(mainBuilder, blocks, origin, onProgress) {
    const totalWorkers = 1 + this.workers.length;
    if (totalWorkers === 1) {
      mainBuilder.enqueue(blocks, origin);
      return mainBuilder.run(onProgress);
    }

    // Partition blocks evenly among main bot and worker bots
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
    for (let i = 0; i < this.workers.length; i++) {
      const w = this.workers[i];
      w.builder.setJob(mainBuilder.currentJob.name);
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
}

module.exports = { SwarmManager };
