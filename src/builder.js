'use strict';

const { Vec3 } = require('vec3');

/**
 * High-performance, resilient builder engine for Mineflayer bots.
 * Features:
 * - Instant cancellation and pathfinder abort on !stop
 * - Creative flight / fast positioning (no ground pathfinding hangs)
 * - Safe pathfinding timeouts (never blocks execution)
 * - Fast packet placement with timeout guards
 */
class Builder {
  constructor(bot, { blockName = 'cobblestone', placeDelayMs = 100, scaffoldBlock = 'dirt' } = {}) {
    this.bot = bot;
    this.blockName = blockName;
    this.placeDelayMs = placeDelayMs;
    this.scaffoldBlock = scaffoldBlock;

    this.queue = [];
    this.placedHistory = [];
    this.scaffoldHistory = [];
    this.building = false;
    this.cancelled = false;
    this.currentJob = { name: 'None', total: 0, placed: 0, startTime: 0 };
  }

  setJob(name) {
    this.currentJob.name = name;
  }

  getStatus() {
    if (!this.building) {
      return { active: false, name: 'None', placed: 0, total: 0, left: 0, percent: 0 };
    }
    const placed = this.placedHistory.length;
    const total = this.currentJob.total || (placed + this.queue.length);
    const left = Math.max(0, total - placed);
    const percent = total > 0 ? ((placed / total) * 100).toFixed(1) : 0;
    return {
      active: true,
      name: this.currentJob.name,
      placed,
      total,
      left,
      percent,
    };
  }

  enqueue(offsetsOrBlocks, origin) {
    const list = [];
    for (const item of offsetsOrBlocks) {
      if (item instanceof Vec3) {
        list.push({ pos: origin.plus(item), name: this.blockName, properties: {} });
      } else if (item && item.pos) {
        list.push({
          pos: origin.plus(item.pos),
          name: item.name || this.blockName,
          properties: item.properties ?? {},
        });
      }
    }
    // Sort bottom-to-top so foundation layers build first
    list.sort((a, b) => (a.pos.y - b.pos.y) || (a.pos.x - b.pos.x) || (a.pos.z - b.pos.z));
    for (const item of list) {
      this.queue.push(item);
    }
  }

  isBuilding() {
    return this.building;
  }

  cancel() {
    this.cancelled = true;
    this.queue = [];
    this.building = false;
    try {
      if (this.bot.pathfinder) {
        this.bot.pathfinder.stop();
        this.bot.pathfinder.setGoal(null);
      }
    } catch (e) {}
  }

  async run(onProgress) {
    if (this.building) {
      throw new Error('Already building.');
    }
    this.building = true;
    this.cancelled = false;

    const total = this.queue.length;
    this.currentJob.total = total;
    this.currentJob.placed = 0;
    this.currentJob.startTime = Date.now();
    this.placedHistory = [];

    let placed = 0;
    let retries = 0;
    const maxRetries = Math.min(total * 2, 500);

    while (this.queue.length > 0 && !this.cancelled && this.building && retries < maxRetries) {
      const target = this.queue.shift();
      if (!target) break;

      try {
        const didPlace = await this._placeOne(target);
        if (didPlace) {
          this.placedHistory.push(target);
          placed++;
          this.currentJob.placed = placed;

          if (onProgress && (placed % 25 === 0 || placed === total)) {
            const left = total - placed;
            const percent = ((placed / total) * 100).toFixed(1);
            onProgress(placed, total, left, percent, false);
          }
        }
      } catch (err) {
        if (err.message && err.message.includes('No reachable reference') && retries < maxRetries) {
          this.queue.push(target);
          retries++;
        } else {
          this.bot.emit('builder_place_error', target.pos, err);
        }
      }
      await sleep(this.placeDelayMs);
    }

    this.building = false;
    const left = Math.max(0, total - placed);
    const percent = total > 0 ? ((placed / total) * 100).toFixed(1) : 100;
    if (onProgress) onProgress(placed, total, left, percent, true);
    return { placed, total, left, percent, cancelled: this.cancelled };
  }

  async _placeOne(target) {
    if (this.cancelled) return false;
    const bot = this.bot;

    // 1. Skip if already placed / solid
    const current = bot.blockAt(target.pos);
    if (current && current.name && !current.name.includes('air') && current.name !== 'water' && current.name !== 'lava') {
      return false;
    }

    // 2. Find solid reference block to place against
    let referenceInfo = this._findReferenceBlock(target.pos);
    if (!referenceInfo) {
      referenceInfo = await this._ensureReference(target.pos);
    }
    if (!referenceInfo) {
      throw new Error(`No reachable reference block found for ${target.pos}`);
    }
    const { refPos, faceVector } = referenceInfo;

    // 3. Move/Fly close enough to place (within 4 blocks)
    await this._moveToPosition(refPos);

    // 4. Ensure we have the building block in inventory
    const cleanName = (target.name || this.blockName).replace('minecraft:', '');
    let item = bot.inventory.items().find((i) => i.name === cleanName);
    if (!item) {
      item = bot.inventory.items().find((i) =>
        i.name.includes('sandstone') || i.name.includes('cobble') || i.name.includes('stone') ||
        i.name.includes('deepslate') || i.name.includes('dirt') || i.name.includes('plank') ||
        i.name.includes('brick') || i.name.includes('concrete') || i.name.includes('terracotta')
      );
    }

    // Creative mode infinite supply
    const isCreative = bot.game?.gameMode === 'creative';
    if (!item && isCreative && bot.creative && typeof bot.creative.setInventorySlot === 'function') {
      try {
        const mcData = require('minecraft-data')(bot.version || '1.21.4');
        const blockItem = mcData?.itemsByName[cleanName] || mcData?.itemsByName[this.blockName] || mcData?.itemsByName['deepslate_bricks'] || mcData?.itemsByName['cobblestone'];
        if (blockItem) {
          const Item = require('prismarine-item')(bot.version || '1.21.4');
          await bot.creative.setInventorySlot(36, new Item(blockItem.id, 64));
          item = bot.inventory.items().find((i) => i.name === cleanName || i.name === blockItem.name || i.name.includes('stone') || i.name.includes('deepslate'));
        }
      } catch (e) {}
    }

    if (!item) {
      throw new Error(`Out of blocks (${cleanName}) — toss blocks to bot or use /gamemode creative ${bot.username}`);
    }

    // 5. Equip
    if (!bot.heldItem || bot.heldItem.name !== item.name) {
      try {
        await bot.equip(item, 'hand');
      } catch (e) {}
    }

    const refBlock = bot.blockAt(refPos);
    if (!refBlock) {
      throw new Error(`Reference block at ${refPos} not loaded.`);
    }

    // 6. Look at target face and place block with timeout protection
    const faceOffset = new Vec3(
      0.5 + faceVector.x * 0.5,
      0.5 + faceVector.y * 0.5,
      0.5 + faceVector.z * 0.5
    );

    try {
      await withTimeout(bot.lookAt(refBlock.position.plus(faceOffset), true), 400);
    } catch (e) {}

    try {
      await withTimeout(bot.placeBlock(refBlock, faceVector), 800);
      return true;
    } catch (err) {
      // Check if block was placed regardless of packet ack
      const verify = bot.blockAt(target.pos);
      if (verify && verify.name && !verify.name.includes('air')) {
        return true;
      }
      throw err;
    }
  }

  async _moveToPosition(pos) {
    const bot = this.bot;
    const currentPos = bot.entity ? bot.entity.position : new Vec3(0, 64, 0);
    const dist = currentPos.distanceTo(pos);

    if (dist <= 4.0) return; // Already in reach!

    const isCreative = bot.game?.gameMode === 'creative';
    if (isCreative && bot.creative && typeof bot.creative.flyTo === 'function') {
      try {
        const flyTarget = new Vec3(pos.x, pos.y + 2, pos.z + 2);
        await withTimeout(bot.creative.flyTo(flyTarget), 1500);
        return;
      } catch (e) {}
    }

    // Survival pathfinding with strict 2.0s timeout
    try {
      const { goals } = require('mineflayer-pathfinder');
      await withTimeout(bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 3)), 2000);
    } catch (e) {
      // If pathfinding timed out, try looking towards it anyway
      try {
        await bot.lookAt(pos, true);
      } catch (err) {}
    }
  }

  _findReferenceBlock(target) {
    const bot = this.bot;
    const candidates = [
      { pos: target.offset(0, -1, 0), face: new Vec3(0, 1, 0) },
      { pos: target.offset(1, 0, 0), face: new Vec3(-1, 0, 0) },
      { pos: target.offset(-1, 0, 0), face: new Vec3(1, 0, 0) },
      { pos: target.offset(0, 0, 1), face: new Vec3(0, 0, -1) },
      { pos: target.offset(0, 0, -1), face: new Vec3(0, 0, 1) },
      { pos: target.offset(0, 1, 0), face: new Vec3(0, -1, 0) },
    ];

    for (const c of candidates) {
      const block = bot.blockAt(c.pos);
      if (block && block.name && !block.name.includes('air') && block.name !== 'water' && block.name !== 'lava') {
        return { refPos: c.pos, faceVector: c.face };
      }
    }
    return null;
  }

  async _ensureReference(target) {
    const bot = this.bot;
    // Check if bottom neighbor is water/air and place a single base block directly below
    const below = target.offset(0, -1, 0);
    const belowBlock = bot.blockAt(below);

    // If standing in water/air, try placing on the block beneath it
    const candidates = [
      { pos: below.offset(0, -1, 0), face: new Vec3(0, 1, 0) },
      { pos: below.offset(1, 0, 0), face: new Vec3(-1, 0, 0) },
      { pos: below.offset(-1, 0, 0), face: new Vec3(1, 0, 0) },
      { pos: below.offset(0, 0, 1), face: new Vec3(0, 0, -1) },
      { pos: below.offset(0, 0, -1), face: new Vec3(0, 0, 1) },
    ];

    for (const c of candidates) {
      const b = bot.blockAt(c.pos);
      if (b && b.name && !b.name.includes('air') && b.name !== 'water' && b.name !== 'lava') {
        return { refPos: c.pos, faceVector: c.face };
      }
    }
    return null;
  }

  async undo(onProgress) {
    this.cancel();
    const bot = this.bot;
    const total = this.placedHistory.length;
    let undone = 0;

    while (this.placedHistory.length > 0) {
      const target = this.placedHistory.pop();
      const pos = target.pos;
      const block = bot.blockAt(pos);
      if (block && block.name && !block.name.includes('air')) {
        try {
          const currentPos = bot.entity ? bot.entity.position : new Vec3(0, 64, 0);
          if (currentPos.distanceTo(pos) > 4.0) {
            await this._moveToPosition(pos);
          }
          await withTimeout(bot.dig(block), 1500);
        } catch (err) {
          bot.emit('builder_undo_error', pos, err);
        }
      }
      undone++;
      if (onProgress && undone % 20 === 0) onProgress(undone, total);
      await sleep(this.placeDelayMs);
    }
    if (onProgress) onProgress(undone, total, true);
    return { undone, total };
  }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)),
  ]);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { Builder, withTimeout };
