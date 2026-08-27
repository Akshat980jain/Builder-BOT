'use strict';

const { Vec3 } = require('vec3');

/**
 * Drives a mineflayer bot through placing a queue of blocks.
 * Requires mineflayer-pathfinder to already be loaded on the bot
 * (bot.pathfinder must exist) — see index.js.
 */
class Builder {
  constructor(bot, { blockName = 'cobblestone', placeDelayMs = 250 } = {}) {
    this.bot = bot;
    this.blockName = blockName;
    this.placeDelayMs = placeDelayMs;
    this.queue = [];
    this.placedHistory = []; // stack of Vec3 positions actually placed, for undo
    this.building = false;
    this.cancelled = false;
  }

  /** offsets: array of Vec3 relative to origin. origin: Vec3 world position. */
  enqueue(offsets, origin) {
    for (const off of offsets) {
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

    while (this.queue.length > 0 && !this.cancelled) {
      const target = this.queue.shift();
      try {
        await this._placeOne(target, goals);
        this.placedHistory.push(target);
        placed++;
        if (onProgress && placed % 10 === 0) {
          onProgress(placed, total);
        }
      } catch (err) {
        // Log and skip — a single failed placement (missing support block,
        // obstruction, out of material) shouldn't kill the whole job.
        this.bot.emit('builder_place_error', target, err);
      }
      await sleep(this.placeDelayMs);
    }

    this.building = false;
    if (onProgress) onProgress(placed, total, true);
    return { placed, total, cancelled: this.cancelled };
  }

  async _placeOne(target, goals) {
    const bot = this.bot;

    // Find a solid block adjacent to the target to place against, and a
    // face vector pointing from that block toward the target.
    const referenceInfo = this._findReferenceBlock(target);
    if (!referenceInfo) {
      throw new Error(`No reachable reference block found for ${target}`);
    }
    const { refPos, faceVector } = referenceInfo;

    // Walk within reach of the reference block.
    await bot.pathfinder.goto(new goals.GoalNear(refPos.x, refPos.y, refPos.z, 3));

    const item = bot.inventory.items().find((i) => i.name === this.blockName);
    if (!item) {
      throw new Error(`Out of ${this.blockName} — restock the bot's inventory.`);
    }
    await bot.equip(item, 'hand');

    const refBlock = bot.blockAt(refPos);
    if (!refBlock) {
      throw new Error(`Reference block at ${refPos} not loaded.`);
    }

    await bot.placeBlock(refBlock, faceVector);
  }

  /**
   * Looks for a currently-solid neighbor of `target` to place against.
   * Prefers the block directly below (so towers/pyramids build straight up
   * without needing scaffolding logic) and falls back to horizontal
   * neighbors for overhangs/domes.
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
      if (block && block.boundingBox === 'block') {
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
          await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 3));
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
