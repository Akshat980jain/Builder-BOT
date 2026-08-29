'use strict';

const { Vec3 } = require('vec3');

/**
 * Drives a mineflayer bot through placing a queue of blocks.
 * Uses standard block placement packets so it works on any server (Survival or Creative)
 * without triggering command spam filters.
 */
class Builder {
  constructor(bot, { blockName = 'cobblestone', placeDelayMs = 120, scaffoldBlock = 'dirt' } = {}) {
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

  /**
   * Accepts either:
   *  - an array of Vec3 offsets (uniform material — pyramid/dome/tower), or
   *  - an array of { pos: Vec3, name: string, properties?: object } (schematics).
   */
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
  }

  async run(onProgress) {
    if (this.building) {
      throw new Error('Already building.');
    }
    this.building = true;
    this.cancelled = false;

    const { goals } = require('mineflayer-pathfinder');
    const total = this.queue.length;
    this.currentJob.total = total;
    this.currentJob.placed = 0;
    this.currentJob.startTime = Date.now();
    this.placedHistory = [];

    let placed = 0;
    let retries = 0;
    const maxRetries = total * 2;

    while (this.queue.length > 0 && !this.cancelled && retries < maxRetries) {
      const target = this.queue.shift();
      try {
        const didPlace = await this._placeOne(target, goals);
        if (didPlace) {
          this.placedHistory.push(target);
          placed++;
          this.currentJob.placed = placed;

          if (onProgress && placed % 50 === 0) {
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

    await this._removeScaffolding(goals);

    this.building = false;
    const left = Math.max(0, total - placed);
    const percent = total > 0 ? ((placed / total) * 100).toFixed(1) : 100;
    if (onProgress) onProgress(placed, total, left, percent, true);
    return { placed, total, left, percent, cancelled: this.cancelled };
  }

  async _placeOne(target, goals) {
    const bot = this.bot;

    // 1. Skip if already placed
    const current = bot.blockAt(target.pos);
    if (current && current.name && !current.name.includes('air') && current.name !== 'water' && current.name !== 'lava') {
      return false;
    }

    // 2. Find solid reference block
    let referenceInfo = this._findReferenceBlock(target.pos);
    if (!referenceInfo) {
      referenceInfo = await this._buildScaffoldAndFindReference(target.pos, goals);
    }
    if (!referenceInfo) {
      throw new Error(`No reachable reference block found for ${target.pos}`);
    }
    const { refPos, faceVector } = referenceInfo;

    // 3. Move closer if further than 4 blocks
    const currentPos = bot.entity ? bot.entity.position : new Vec3(0, 64, 0);
    if (currentPos.distanceTo(refPos) > 4.2) {
      try {
        await bot.pathfinder.goto(new goals.GoalNear(refPos.x, refPos.y, refPos.z, 3));
      } catch (e) {}
    }

    // 4. Find or replenish building block
    const cleanName = (target.name || this.blockName).replace('minecraft:', '');
    let item = bot.inventory.items().find((i) => i.name === cleanName);
    if (!item) {
      item = bot.inventory.items().find((i) =>
        i.name.includes('sandstone') || i.name.includes('cobble') || i.name.includes('stone') ||
        i.name.includes('deepslate') || i.name.includes('dirt') || i.name.includes('plank') ||
        i.name.includes('brick') || i.name.includes('concrete') || i.name.includes('terracotta')
      );
    }

    // Creative mode auto-restock
    if (!item && bot.creative && typeof bot.creative.setInventorySlot === 'function') {
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
      throw new Error(`Out of building blocks (tried ${cleanName}) — please drop blocks or run: /gamemode creative ${bot.username}`);
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

    // 6. Look at face & place
    const faceOffset = new Vec3(
      0.5 + faceVector.x * 0.5,
      0.5 + faceVector.y * 0.5,
      0.5 + faceVector.z * 0.5
    );
    await bot.lookAt(refBlock.position.plus(faceOffset), true);
    await bot.placeBlock(refBlock, faceVector);
    return true;
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

  async _buildScaffoldAndFindReference(target, goals) {
    const bot = this.bot;
    const item = bot.inventory.items().find((i) => i.name === this.scaffoldBlock || i.name.includes('dirt') || i.name.includes('cobble'));
    if (!item && (!bot.creative || typeof bot.creative.setInventorySlot !== 'function')) return null;

    let groundY = null;
    for (let dy = 1; dy <= 40; dy++) {
      const checkPos = target.offset(0, -dy, 0);
      const block = bot.blockAt(checkPos);
      if (block && block.name && !block.name.includes('air') && block.name !== 'water' && block.name !== 'lava') {
        groundY = checkPos.y;
        break;
      }
    }
    if (groundY === null) return null;

    for (let y = groundY + 1; y < target.y; y++) {
      const pillarPos = new Vec3(target.x, y, target.z);
      const existing = bot.blockAt(pillarPos);
      if (existing && existing.name && !existing.name.includes('air')) continue;

      const below = new Vec3(target.x, y - 1, target.z);
      try {
        await bot.pathfinder.goto(new goals.GoalNear(below.x, below.y, below.z, 3));
      } catch (e) {}

      const belowBlock = bot.blockAt(below);
      if (!belowBlock) break;

      let scaffoldItem = bot.inventory.items().find((i) => i.name === this.scaffoldBlock || i.name.includes('dirt') || i.name.includes('cobble'));
      if (!scaffoldItem && bot.creative && typeof bot.creative.setInventorySlot === 'function') {
        try {
          const Item = require('prismarine-item')(bot.version || '1.21.4');
          await bot.creative.setInventorySlot(36, new Item(1, 64));
          scaffoldItem = bot.inventory.items()[0];
        } catch (e) {}
      }

      if (!scaffoldItem) break;
      await bot.equip(scaffoldItem, 'hand');
      await bot.placeBlock(belowBlock, new Vec3(0, 1, 0));
      this.scaffoldHistory.push(pillarPos);
    }

    return this._findReferenceBlock(target);
  }

  async _removeScaffolding(goals) {
    const bot = this.bot;
    while (this.scaffoldHistory.length > 0) {
      const pos = this.scaffoldHistory.pop();
      const block = bot.blockAt(pos);
      if (block && block.name && !block.name.includes('air')) {
        try {
          const currentPos = bot.entity ? bot.entity.position : new Vec3(0, 64, 0);
          if (currentPos.distanceTo(pos) > 4.2) {
            await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 3));
          }
          await bot.dig(block);
        } catch (err) {}
      }
    }
  }

  async undo(onProgress) {
    const { goals } = require('mineflayer-pathfinder');
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
          if (currentPos.distanceTo(pos) > 4.2) {
            await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 3));
          }
          await bot.dig(block);
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { Builder };
