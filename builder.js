"use strict";

const { Vec3 } = require("vec3");
const PrismarineItem = require("prismarine-item");
const { addLog } = require("./logger");
const { DEPENDENT_BLOCKS, REPLACEABLE_BLOCKS } = require("./schematic");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Maps Minecraft block names to their corresponding inventory item names
 */
function blockToItemName(blockName) {
  const clean = blockName.replace(/^minecraft:/, "").toLowerCase();

  if (clean.endsWith("_wall_sign")) return clean.replace("_wall_sign", "_sign");
  if (clean.endsWith("_wall_hanging_sign")) return clean.replace("_wall_hanging_sign", "_hanging_sign");
  if (clean.endsWith("_wall_fan")) return clean.replace("_wall_fan", "_fan");
  if (clean.endsWith("_wall_head")) return clean.replace("_wall_head", "_head");
  if (clean.endsWith("_wall_skull")) return clean.replace("_wall_skull", "_skull");
  if (clean === "wall_torch") return "torch";
  if (clean === "soul_wall_torch") return "soul_torch";
  if (clean === "redstone_wall_torch") return "redstone_torch";

  const specialMap = {
    redstone_wire: "redstone",
    tripwire: "string",
    carrots: "carrot",
    potatoes: "potato",
    beetroots: "beetroot_seeds",
    wheat: "wheat_seeds",
    cocoa: "cocoa_beans",
    sweet_berry_bush: "glow_berries",
    cave_vines: "glow_berries",
    cave_vines_plant: "glow_berries",
    melon_stem: "melon_seeds",
    pumpkin_stem: "pumpkin_seeds",
    bamboo_sapling: "bamboo",
    piston_head: "piston",
    moving_piston: "piston",
  };

  return specialMap[clean] || clean;
}

class BuilderManager {
  constructor(bot, config, safety) {
    this.bot = bot;
    this.config = config || {};
    this.safety = safety;

    this.state = "IDLE"; // IDLE, TRAVELING, CLEARING_AREA, BUILDING, PAUSED, COMPLETED
    this.shouldStop = false;
    this.isPaused = false;

    this.queue = [];
    this.history = []; // stack of { pos, placedBlock, previousBlock } for undo
    this.currentJob = {
      name: "None",
      total: 0,
      placed: 0,
      left: 0,
      percent: 0,
      startTime: 0,
      origin: null,
      rotation: 0
    };

    this._mcDataCache = null;
    this.placeDelayMs = this.config.builder?.placeDelayMs || 40;
    this.creativeDelayMs = this.config.builder?.creativeDelayMs || 25;
    this.canUseSetblock = true;
    this.lastCommandTime = 0;
  }

  _mcData() {
    if (!this._mcDataCache) {
      try {
        this._mcDataCache = require("minecraft-data")(this.bot.version || "1.21.4");
      } catch (_) {}
    }
    return this._mcDataCache;
  }

  getStatus() {
    if (this.state === "IDLE") {
      return { active: false, state: "IDLE", name: "None", placed: 0, total: 0, left: 0, percent: 0, elapsed: 0, blocksPerSec: 0 };
    }

    const placed = this.currentJob.placed;
    const total = this.currentJob.total;
    const left = Math.max(0, total - placed);
    const percent = total > 0 ? Number(((placed / total) * 100).toFixed(1)) : 0;
    const elapsed = this.currentJob.startTime > 0 ? Math.floor((Date.now() - this.currentJob.startTime) / 1000) : 0;
    const blocksPerSec = elapsed > 0 ? Number((placed / elapsed).toFixed(1)) : 0;

    return {
      active: this.state === "BUILDING" || this.state === "PAUSED",
      state: this.state,
      name: this.currentJob.name,
      placed,
      total,
      left,
      percent,
      elapsed,
      blocksPerSec,
      origin: this.currentJob.origin
    };
  }

  /**
   * Broadcasts chat progress message for in-game players and BuilderBotClient HUD
   */
  broadcastProgress(placed, total, left, percent) {
    if (!this.bot || typeof this.bot.chat !== "function") return;
    try {
      this.bot.chat(`[Builder] Building: ${placed}/${total} placed (${percent}%) - ${left} remaining`);
    } catch (_) {}
  }

  /**
   * Stops current build operation
   */
  stop(reason = "User requested stop") {
    this.shouldStop = true;
    this.isPaused = false;
    this.state = "IDLE";
    this.queue = [];
    if (this.bot.pathfinder) {
      try {
        this.bot.pathfinder.stop();
        this.bot.pathfinder.setGoal(null);
      } catch (_) {}
    }
    addLog(`[Builder] Build stopped: ${reason}`, "Builder");
    try {
      if (this.bot && typeof this.bot.chat === "function") {
        this.bot.chat(`[Builder] Build stopped: ${reason}`);
      }
    } catch (_) {}
  }

  /**
   * Pauses current build operation
   */
  pause() {
    if (this.state === "BUILDING") {
      this.isPaused = true;
      this.state = "PAUSED";
      addLog("[Builder] Build paused.", "Builder");
      try { this.bot.chat("[Builder] Build paused."); } catch (_) {}
    }
  }

  /**
   * Resumes paused build operation
   */
  resume(onProgress) {
    if (this.state === "PAUSED") {
      this.isPaused = false;
      this.state = "BUILDING";
      addLog("[Builder] Resuming build...", "Builder");
      try { this.bot.chat("[Builder] Resuming build..."); } catch (_) {}
      this._runQueue(onProgress);
    }
  }

  /**
   * Starts a new build task from prepared blocks at origin
   */
  async startBuild(name, blocks, originPos, onProgress) {
    if (this.state === "BUILDING") {
      this.stop("Starting new build job");
      await sleep(100);
    }

    this.shouldStop = false;
    this.isPaused = false;
    this.state = "BUILDING";

    const origin = originPos ? new Vec3(originPos.x, originPos.y, originPos.z) : (this.bot.entity ? this.bot.entity.position.floored() : new Vec3(0, 64, 0));

    // Convert relative blocks into absolute world coordinates
    const worldBlocks = blocks.map((b) => ({
      pos: origin.plus(b.pos),
      name: b.name,
      properties: b.properties || {},
      blockState: b.blockState || b.name
    }));

    // Ensure strictly bottom-to-top (Y ascending)
    worldBlocks.sort((a, b) => {
      if (a.pos.y !== b.pos.y) return a.pos.y - b.pos.y;
      const aClean = a.name.replace(/^minecraft:/, "").toLowerCase();
      const bClean = b.name.replace(/^minecraft:/, "").toLowerCase();
      const aDep = DEPENDENT_BLOCKS.has(aClean) ? 1 : 0;
      const bDep = DEPENDENT_BLOCKS.has(bClean) ? 1 : 0;
      if (aDep !== bDep) return aDep - bDep;
      if (a.pos.z !== b.pos.z) return a.pos.z - b.pos.z;
      return a.pos.x - b.pos.x;
    });

    this.queue = worldBlocks;
    this.currentJob = {
      name: name || "Custom Build",
      total: worldBlocks.length,
      placed: 0,
      left: worldBlocks.length,
      percent: 0,
      startTime: Date.now(),
      origin: { x: origin.x, y: origin.y, z: origin.z },
      rotation: 0
    };

    addLog(`[Builder] Starting build "${name}" (${worldBlocks.length} blocks) at (${origin.x}, ${origin.y}, ${origin.z})`, "Builder");
    try {
      this.bot.chat(`[Builder] Starting "${name}" (${worldBlocks.length} blocks) at (${origin.x}, ${origin.y}, ${origin.z})`);
    } catch (_) {}

    // Teleport bot to origin if far away (> 16 blocks) so chunks are loaded
    const curPos = this.bot.entity ? this.bot.entity.position : new Vec3(0, 64, 0);
    const distToOrigin = curPos.distanceTo(origin);
    if (distToOrigin > 16) {
      addLog(`[Builder] Bot is ${Math.round(distToOrigin)} blocks away from origin. Teleporting to build site...`, "Builder");
      try {
        this.bot.chat(`/tp ${this.bot.username} ${origin.x} ${origin.y + 2} ${origin.z}`);
      } catch (_) {}
      await sleep(1500); // Allow chunks around the bot to load
    }

    // Attempt creative mode if not already in creative (only works if bot has OP)
    if (this.bot && typeof this.bot.chat === "function" && this.bot.game?.gameMode !== "creative") {
      try { this.bot.chat("/gamemode creative"); } catch (_) {}
    }
    await sleep(200);
    if (this.safety) this.safety.maintainCreativeFlight();

    return this._runQueue(onProgress);
  }

  /**
   * Internal queue consumer loop
   */
  async _runQueue(onProgress) {
    let placed = this.currentJob.placed;
    const total = this.currentJob.total;
    let consecutiveFails = 0;
    const maxFails = Math.max(total * 4, 200);

    while (this.queue.length > 0 && !this.shouldStop && !this.isPaused && consecutiveFails < maxFails) {
      const target = this.queue.shift();
      if (!target) break;

      const cleanName = target.name.replace(/^minecraft:/, "");

      // 1. Skip if block already matches in world
      const cur = this.bot.blockAt(target.pos);
      if (cur && (cur.name === cleanName || cur.name === target.name)) {
        placed++;
        this.currentJob.placed = placed;
        this.currentJob.left = Math.max(0, total - placed);
        this.currentJob.percent = total > 0 ? Number(((placed / total) * 100).toFixed(1)) : 100;
        consecutiveFails = 0;
        continue;
      }

      // 2. Clear breakable obstacle at placement spot
      if (cur && cur.name && !cur.name.includes("air") && cur.name !== "water" && cur.name !== "lava") {
        if (REPLACEABLE_BLOCKS.has(cur.name)) {
          if (this.bot.canDigBlock(cur)) {
            try { await withTimeout(this.bot.dig(cur), 1000); } catch (_) {}
          }
        }
      }

      // Keep bot in reach of active placement voxel (within 3.5 blocks) in creative mode
      if (this.bot.entity && this.bot.game?.gameMode === "creative") {
        const dist = this.bot.entity.position.distanceTo(target.pos);
        if (dist > 4.2) {
          const hoverPos = new Vec3(target.pos.x, Math.max(target.pos.y + 1.5, this.currentJob.origin ? this.currentJob.origin.y + 1 : 65), target.pos.z + 1.5);
          try {
            if (this.bot.creative && typeof this.bot.creative.flyTo === "function") {
              await this.bot.creative.flyTo(hoverPos);
            }
          } catch (_) {}
        }
      }

      // 3. Place single block with robust pipeline
      const success = await this._placeSingleBlock(target);

      if (success) {
        this.history.push({
          pos: target.pos,
          placedBlock: target.blockState || target.name,
          previousBlock: cur ? cur.name : "air"
        });

        placed++;
        this.currentJob.placed = placed;
        this.currentJob.left = Math.max(0, total - placed);
        this.currentJob.percent = total > 0 ? Number(((placed / total) * 100).toFixed(1)) : 100;
        consecutiveFails = 0;

        if (placed % 20 === 0 || placed === total || this.queue.length === 0) {
          this.broadcastProgress(placed, total, this.currentJob.left, this.currentJob.percent);
          if (onProgress) {
            onProgress(placed, total, this.currentJob.left, this.currentJob.percent, false);
          }
        }
      } else {
        consecutiveFails++;
        target.retries = (target.retries || 0) + 1;
        if (target.retries <= 3) {
          this.queue.push(target); // Re-queue to try after supporting blocks are placed
        } else {
          addLog(`[Builder] Skipped unplaceable block at ${target.pos}: ${target.name}`, "Builder");
        }
      }

      // Dynamic delay
      const isCreative = this.bot.game?.gameMode === "creative";
      const delay = isCreative ? this.creativeDelayMs : this.placeDelayMs;
      if (delay > 0) await sleep(delay);
    }

    if (this.queue.length === 0 && !this.shouldStop && !this.isPaused) {
      this.state = "COMPLETED";
      this.currentJob.left = 0;
      this.currentJob.percent = 100;
      addLog(`[Builder] 🎉 Build "${this.currentJob.name}" completed! Placed ${placed}/${total} blocks.`, "Builder");
      try {
        this.bot.chat(`[Builder] Done! Build "${this.currentJob.name}" completed! Placed ${placed}/${total} blocks.`);
      } catch (_) {}
      if (onProgress) onProgress(placed, total, 0, 100, true);
    }

    return { placed, total, completed: this.state === "COMPLETED", stopped: this.shouldStop };
  }

  /**
   * Places a single block using exact match or /setblock fallback
   */
  async _placeSingleBlock(target) {
    const bot = this.bot;
    const pos = target.pos;
    const rawName = target.name;
    const cleanName = rawName.replace(/^minecraft:/, "");
    const itemName = blockToItemName(rawName);

    const isModded = rawName.includes(":") && !rawName.startsWith("minecraft:");
    const mcData = this._mcData();
    const isVanilla = !isModded && mcData?.itemsByName[itemName];

    // Anti-collision: move away if colliding with player box
    await this._preventCollision(pos);

    if (isVanilla) {
      // Step A: Exact Inventory Match
      let item = bot.inventory.items().find((i) => i.name === itemName || i.name === cleanName);

      // Step B: Creative Slot Provisioning (Slot 36 / hotbar)
      if (!item && this.bot.game?.gameMode === "creative") {
        try {
          const itemEntry = mcData.itemsByName[itemName] || mcData.blocksByName[cleanName];
          if (itemEntry && typeof bot.creative?.setInventorySlot === "function") {
            const ItemClass = PrismarineItem(bot.version || "1.21.4");
            await withTimeout(bot.creative.setInventorySlot(36, new ItemClass(itemEntry.id, 64)), 600);
            await sleep(30);
            if (typeof bot.setQuickBarSlot === "function") bot.setQuickBarSlot(0);
            item = bot.inventory.slots[36] || bot.inventory.items().find((i) => i.name === itemName || i.name === cleanName);
          }
        } catch (_) {}
      }

      // Step C: Equip & Native Placement
      if (item) {
        try {
          await bot.equip(item, "hand");
          const refInfo = this._findReferenceBlock(pos);
          if (refInfo) {
            await bot.placeBlock(refInfo.refBlock, refInfo.faceVector);
            return true;
          }
        } catch (_) {
          // Native failed, fall through to /setblock
        }
      }
    }

    // Step D: Robust OP /setblock fallback (Handles Modded Blocks e.g. Create Mod & Complex Blockstates)
    return this._setblockFallback(pos, target.blockState || rawName);
  }

  /**
   * Fallback using server /setblock command
   */
  async _setblockFallback(pos, stateStr) {
    if (!this.canUseSetblock) return false;

    // Rate-limit: minimum 250ms between chat commands to prevent spam kicks
    const now = Date.now();
    const elapsed = now - this.lastCommandTime;
    if (elapsed < 250) {
      await sleep(250 - elapsed);
    }
    this.lastCommandTime = Date.now();

    const x = Math.floor(pos.x);
    const y = Math.floor(pos.y);
    const z = Math.floor(pos.z);
    const cmd = `/setblock ${x} ${y} ${z} ${stateStr} replace`;

    return new Promise((resolve) => {
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.bot.removeListener("message", onMsg);
          resolve(true); // Treat as placed to keep pipelining smooth
        }
      }, 400);

      const onMsg = (jsonMsg) => {
        const text = jsonMsg.toString().toLowerCase();
        if (text.includes("changed the block") || text.includes("successfully") || text.includes("placed")) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            this.bot.removeListener("message", onMsg);
            resolve(true);
          }
        } else if (text.includes("no permission") || text.includes("unknown or incomplete") || text.includes("unknown command") || text.includes("could not set")) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            this.bot.removeListener("message", onMsg);
            if (text.includes("no permission") || text.includes("unknown")) {
              this.canUseSetblock = false;
              addLog("[Builder] ❌ /setblock requires OP permission. Disabling /setblock fallback.", "Builder");
              try {
                this.bot.chat(`[Builder] ❌ Bot needs OP for /setblock. Please run '/op ${this.bot.username}' in server console.`);
              } catch (_) {}
            }
            resolve(false);
          }
        }
      };

      this.bot.on("message", onMsg);
      this.bot.chat(cmd);
    });
  }

  /**
   * Searches the 6 adjacent positions for an existing solid block to place against
   */
  _findReferenceBlock(targetPos) {
    const candidates = [
      { pos: targetPos.offset(0, -1, 0), face: new Vec3(0, 1, 0) },  // Below -> top face
      { pos: targetPos.offset(0, 0, -1), face: new Vec3(0, 0, 1) },  // North -> south face
      { pos: targetPos.offset(0, 0, 1),  face: new Vec3(0, 0, -1) }, // South -> north face
      { pos: targetPos.offset(-1, 0, 0), face: new Vec3(1, 0, 0) },  // West -> east face
      { pos: targetPos.offset(1, 0, 0),  face: new Vec3(-1, 0, 0) }, // East -> west face
      { pos: targetPos.offset(0, 1, 0),  face: new Vec3(0, -1, 0) },  // Above -> bottom face
    ];

    for (const c of candidates) {
      const block = this.bot.blockAt(c.pos);
      if (block && block.name && !block.name.includes("air") && block.name !== "water" && block.name !== "lava") {
        return { refPos: c.pos, faceVector: c.face, refBlock: block };
      }
    }
    return null;
  }

  /**
   * Ensures bot does not collide with the block being placed
   */
  async _preventCollision(targetPos) {
    if (!this.bot.entity) return;
    const p = this.bot.entity.position;

    const isColliding =
      Math.abs(p.x - (targetPos.x + 0.5)) < 0.8 &&
      Math.abs(p.z - (targetPos.z + 0.5)) < 0.8 &&
      p.y >= targetPos.y - 1.8 &&
      p.y <= targetPos.y + 1.2;

    if (isColliding) {
      const away = p.clone().offset(0, 1.2, 1.2);
      if (this.bot.game?.gameMode === "creative" && this.bot.creative && typeof this.bot.creative.flyTo === "function") {
        try { await this.bot.creative.flyTo(away); } catch (_) {}
      } else {
        try {
          this.bot.setControlState("back", true);
          setTimeout(() => {
            try { this.bot.setControlState("back", false); } catch (_) {}
          }, 200);
        } catch (_) {}
      }
      await sleep(50);
    }
  }

  /**
   * Undo last build job by reversing placed blocks
   */
  async undo() {
    if (this.history.length === 0) {
      addLog("[Builder] Nothing to undo.", "Builder");
      try { this.bot.chat("[Builder] Nothing to undo."); } catch (_) {}
      return false;
    }

    const count = this.history.length;
    addLog(`[Builder] Undoing ${count} placed blocks...`, "Builder");
    try { this.bot.chat(`[Builder] Undoing ${count} placed blocks...`); } catch (_) {}

    while (this.history.length > 0) {
      const entry = this.history.pop();
      const x = Math.floor(entry.pos.x);
      const y = Math.floor(entry.pos.y);
      const z = Math.floor(entry.pos.z);
      this.bot.chat(`/setblock ${x} ${y} ${z} air replace`);
      await sleep(15);
    }

    addLog("[Builder] Undo completed successfully.", "Builder");
    try { this.bot.chat("[Builder] Undo completed successfully."); } catch (_) {}
    return true;
  }

  /**
   * Clears a cubic region (excavation)
   */
  async clearArea(center, radius = 8, height = 10) {
    const x1 = Math.floor(center.x - radius);
    const y1 = Math.floor(center.y);
    const z1 = Math.floor(center.z - radius);
    const x2 = Math.floor(center.x + radius);
    const y2 = Math.floor(center.y + height);
    const z2 = Math.floor(center.z + radius);

    addLog(`[Builder] Clearing area from (${x1}, ${y1}, ${z1}) to (${x2}, ${y2}, ${z2})...`, "Builder");
    try {
      this.bot.chat(`/fill ${x1} ${y1} ${z1} ${x2} ${y2} ${z2} air replace`);
      this.bot.chat(`[Builder] Cleared ${ (x2 - x1 + 1) * (y2 - y1 + 1) * (z2 - z1 + 1) } blocks area.`);
    } catch (_) {}
  }
}

module.exports = BuilderManager;
