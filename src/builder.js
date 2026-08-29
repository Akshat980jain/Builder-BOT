'use strict';

const { Vec3 } = require('vec3');

/** Converts a Minecraft block name + properties object into a blockstate
 * string suitable for /setblock, e.g. minecraft:oak_stairs[facing=east,half=bottom] */
function toBlockStateString(name, properties) {
  const fullName = name.includes(':') ? name : `minecraft:${name}`;
  if (!properties || Object.keys(properties).length === 0) return fullName;
  const propStr = Object.entries(properties)
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
  return `${fullName}[${propStr}]`;
}

/**
 * Drives a mineflayer bot through placing a queue of blocks, in one of two modes:
 *  - 'creative': issues /setblock commands directly — instant, no reach limits,
 *    places any block material, orientation, and properties.
 *  - 'survival': walks to each block and physically places it with scaffolding.
 */
class Builder {
  constructor(bot, { blockName = 'cobblestone', placeDelayMs = 150, mode = 'auto', scaffoldBlock = 'dirt' } = {}) {
    this.bot = bot;
    this.blockName = blockName;
    this.placeDelayMs = placeDelayMs;
    this.mode = mode;
    this.scaffoldBlock = scaffoldBlock;

    this.queue = [];
    this.placedHistory = []; // stack of {pos, name, properties}
    this.scaffoldHistory = [];
    this.building = false;
    this.cancelled = false;
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

  resolveMode() {
    if (this.mode !== 'auto') return this.mode;
    const gameMode = this.bot.game?.gameMode;
    return gameMode === 'creative' ? 'creative' : 'survival';
  }

  async run(onProgress) {
    if (this.building) {
      throw new Error('Already building.');
    }
    this.building = true;
    this.cancelled = false;

    const activeMode = this.resolveMode();
    const { goals } = require('mineflayer-pathfinder');
    const total = this.queue.length;
    let placed = 0;
    let retries = 0;
    const maxRetries = total * 2;

    while (this.queue.length > 0 && !this.cancelled && retries < maxRetries) {
      const target = this.queue.shift();
      try {
        if (activeMode === 'creative') {
          await this._placeCreative(target);
        } else {
          await this._placeSurvival(target, goals);
        }
        this.placedHistory.push(target);
        placed++;
        if (onProgress && placed % 20 === 0) onProgress(placed, total);
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

    if (activeMode === 'survival') {
      await this._removeScaffolding(goals);
    }

    this.building = false;
    if (onProgress) onProgress(placed, total, true);
    return { placed, total, cancelled: this.cancelled, mode: activeMode };
  }

  // ---- Creative mode: instant, no reach limits, supports custom block properties ----
  async _placeCreative(target) {
    const stateString = toBlockStateString(target.name, target.properties);
    const { x, y, z } = target.pos;
    this.bot.chat(`/setblock ${x} ${y} ${z} ${stateString}`);
  }

  // ---- Survival mode: walk, equip, place; scaffold if floating ----
  async _placeSurvival(target, goals) {
    const bot = this.bot;

    // Skip if already solid
    const current = bot.blockAt(target.pos);
    if (current && current.name && !current.name.includes('air') && current.name !== 'water' && current.name !== 'lava') {
      return;
    }

    let referenceInfo = this._findReferenceBlock(target.pos);
    if (!referenceInfo) {
      referenceInfo = await this._buildScaffoldAndFindReference(target.pos, goals);
    }
    if (!referenceInfo) {
      throw new Error(`No reachable reference block found for ${target.pos}`);
    }
    const { refPos, faceVector } = referenceInfo;

    const currentPos = bot.entity ? bot.entity.position : new Vec3(0, 64, 0);
    if (currentPos.distanceTo(refPos) > 4.2) {
      try {
        await bot.pathfinder.goto(new goals.GoalNear(refPos.x, refPos.y, refPos.z, 3));
      } catch (e) {}
    }

    const cleanName = (target.name || this.blockName).replace('minecraft:', '');
    let item = bot.inventory.items().find((i) => i.name === cleanName);
    if (!item) {
      item = bot.inventory.items().find((i) =>
        i.name.includes('sandstone') || i.name.includes('cobble') || i.name.includes('stone') ||
        i.name.includes('deepslate') || i.name.includes('dirt') || i.name.includes('plank') ||
        i.name.includes('brick') || i.name.includes('concrete') || i.name.includes('terracotta')
      );
    }

    if (!item) {
      throw new Error(`Out of building blocks (needed ${cleanName}) — please drop blocks or run: /gamemode creative ${bot.username}`);
    }

    if (!bot.heldItem || bot.heldItem.name !== item.name) {
      try {
        await bot.equip(item, 'hand');
      } catch (e) {}
    }

    const refBlock = bot.blockAt(refPos);
    if (!refBlock) {
      throw new Error(`Reference block at ${refPos} not loaded.`);
    }

    const faceOffset = new Vec3(
      0.5 + faceVector.x * 0.5,
      0.5 + faceVector.y * 0.5,
      0.5 + faceVector.z * 0.5
    );
    await bot.lookAt(refBlock.position.plus(faceOffset), true);
    await bot.placeBlock(refBlock, faceVector);
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
    if (!item) return null;

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

      const scaffoldItem = bot.inventory.items().find((i) => i.name === this.scaffoldBlock || i.name.includes('dirt') || i.name.includes('cobble'));
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
          await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 3));
          await bot.dig(block);
        } catch (err) {
          bot.emit('builder_scaffold_cleanup_error', pos, err);
        }
      }
    }
  }

  /** Undoes builds, using /setblock air in creative or digging in survival */
  async undo(onProgress) {
    const { goals } = require('mineflayer-pathfinder');
    const bot = this.bot;
    const total = this.placedHistory.length;
    let undone = 0;
    const activeMode = this.resolveMode();

    while (this.placedHistory.length > 0) {
      const target = this.placedHistory.pop();
      const pos = target.pos;

      if (activeMode === 'creative') {
        this.bot.chat(`/setblock ${pos.x} ${pos.y} ${pos.z} minecraft:air`);
      } else {
        const block = bot.blockAt(pos);
        if (block && block.name && !block.name.includes('air')) {
          try {
            await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 3));
            await bot.dig(block);
          } catch (err) {
            bot.emit('builder_undo_error', pos, err);
          }
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

module.exports = { Builder, toBlockStateString };
