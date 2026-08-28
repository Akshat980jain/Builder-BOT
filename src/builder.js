'use strict';

const { Vec3 } = require('vec3');

/**
 * Drives a mineflayer bot through placing a queue of blocks.
 * Requires mineflayer-pathfinder to already be loaded on the bot.
 */
class Builder {
  constructor(bot, { blockName = 'cobblestone', placeDelayMs = 120 } = {}) {
    this.bot = bot;
    this.blockName = blockName;
    this.placeDelayMs = placeDelayMs;
    this.queue = [];
    this.placedHistory = [];
    this.building = false;
    this.cancelled = false;
  }

  /** offsets: array of Vec3 relative to origin. origin: Vec3 world position. */
  enqueue(offsets, origin) {
    // Sort bottom-to-top so foundation layers build first
    const sorted = [...offsets].sort((a, b) => (a.y - b.y) || (a.x - b.x) || (a.z - b.z));
    for (const off of sorted) {
      this.queue.push(origin.plus(off));
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
          if (onProgress && placed % 25 === 0) {
            onProgress(placed, total);
          }
        }
      } catch (err) {
        // If reference block wasn't ready yet, push to end of queue for later
        if (err.message && err.message.includes('No reachable reference') && retries < maxRetries) {
          this.queue.push(target);
          retries++;
        } else {
          this.bot.emit('builder_place_error', target, err);
        }
      }
      await sleep(this.placeDelayMs);
    }

    this.building = false;
    if (onProgress) onProgress(placed, total, true);
    return { placed, total, cancelled: this.cancelled };
  }

  async _placeOne(target, goals) {
    const bot = this.bot;

    // 1. Skip if target block is already solid/placed
    const current = bot.blockAt(target);
    if (current && current.name && !current.name.includes('air') && current.name !== 'water' && current.name !== 'lava') {
      return false;
    }

    // 2. Find solid reference block to attach to
    const referenceInfo = this._findReferenceBlock(target);
    if (!referenceInfo) {
      throw new Error(`No reachable reference block found for ${target}`);
    }
    const { refPos, faceVector } = referenceInfo;

    // 3. Move closer only if bot is further than 4 blocks
    const currentPos = bot.entity ? bot.entity.position : new Vec3(0, 64, 0);
    const dist = currentPos.distanceTo(refPos);
    if (dist > 4.2) {
      try {
        await bot.pathfinder.goto(new goals.GoalNear(refPos.x, refPos.y, refPos.z, 3));
      } catch (e) {
        // If pathfinder cannot find ground, try getting as close as possible
      }
    }

    // 4. Find suitable building material in inventory
    let item = bot.inventory.items().find((i) => i.name === this.blockName);
    if (!item) {
      item = bot.inventory.items().find((i) =>
        i.name.includes('sandstone') || i.name.includes('cobble') || i.name.includes('stone') ||
        i.name.includes('deepslate') || i.name.includes('dirt') || i.name.includes('plank') ||
        i.name.includes('brick') || i.name.includes('concrete') || i.name.includes('terracotta')
      );
    }

    // 5. Creative mode infinite block replenisher
    if (!item && bot.creative && typeof bot.creative.setInventorySlot === 'function') {
      try {
        const mcData = require('minecraft-data')(bot.version || '1.21.4');
        const blockItem = mcData?.itemsByName[this.blockName] || mcData?.itemsByName['sandstone'] || mcData?.itemsByName['cobblestone'] || mcData?.itemsByName['deepslate_bricks'];
        if (blockItem) {
          const Item = require('prismarine-item')(bot.version || '1.21.4');
          await bot.creative.setInventorySlot(36, new Item(blockItem.id, 64));
          item = bot.inventory.items().find((i) => i.name === this.blockName || i.name === blockItem?.name || i.name.includes('stone') || i.name.includes('cobble') || i.name.includes('deepslate'));
        }
      } catch (e) {}
    }

    if (!item) {
      throw new Error(`Out of building blocks (tried ${this.blockName}) — please drop some blocks to the bot or set creative mode with: /gamemode creative ${bot.username}`);
    }

    // 6. Equip item to main hand
    if (!bot.heldItem || bot.heldItem.name !== item.name) {
      try {
        await bot.equip(item, 'hand');
      } catch (e) {}
    }

    const refBlock = bot.blockAt(refPos);
    if (!refBlock) {
      throw new Error(`Reference block at ${refPos} not loaded.`);
    }

    // 7. Look at face & place block
    try {
      const faceOffset = new Vec3(
        0.5 + faceVector.x * 0.5,
        0.5 + faceVector.y * 0.5,
        0.5 + faceVector.z * 0.5
      );
      await bot.lookAt(refBlock.position.plus(faceOffset), true);
      await bot.placeBlock(refBlock, faceVector);
      return true;
    } catch (err) {
      throw err;
    }
  }

  /**
   * Looks for a currently-solid neighbor of `target` to place against.
   * Checks below first, then horizontal neighbors, then above.
   */
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

  /** Digs up everything placed so far, most-recent-first. */
  async undo(onProgress) {
    const { goals } = require('mineflayer-pathfinder');
    const bot = this.bot;
    const total = this.placedHistory.length;
    let undone = 0;

    while (this.placedHistory.length > 0) {
      const pos = this.placedHistory.pop();
      const block = bot.blockAt(pos);
      if (block && block.name !== 'air') {
        try {
          const dist = bot.entity ? bot.entity.position.distanceTo(pos) : 999;
          if (dist > 4) {
            await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 3));
          }
          await bot.dig(block);
        } catch (err) {
          bot.emit('builder_undo_error', pos, err);
        }
      }
      undone++;
      if (onProgress && undone % 10 === 0) onProgress(undone, total);
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
