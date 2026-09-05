'use strict';

const { Vec3 } = require('vec3');

/** Maps Minecraft block names to their corresponding inventory item names */
function blockToItemName(blockName) {
  const clean = blockName.replace('minecraft:', '').toLowerCase();

  if (clean.endsWith('_wall_sign')) return clean.replace('_wall_sign', '_sign');
  if (clean.endsWith('_wall_hanging_sign')) return clean.replace('_wall_hanging_sign', '_hanging_sign');
  if (clean.endsWith('_wall_fan')) return clean.replace('_wall_fan', '_fan');
  if (clean.endsWith('_wall_head')) return clean.replace('_wall_head', '_head');
  if (clean.endsWith('_wall_skull')) return clean.replace('_wall_skull', '_skull');
  if (clean === 'wall_torch') return 'torch';
  if (clean === 'soul_wall_torch') return 'soul_torch';
  if (clean === 'redstone_wall_torch') return 'redstone_torch';

  const specialMap = {
    redstone_wire: 'redstone',
    tripwire: 'string',
    carrots: 'carrot',
    potatoes: 'potato',
    beetroots: 'beetroot_seeds',
    wheat: 'wheat_seeds',
    cocoa: 'cocoa_beans',
    sweet_berry_bush: 'sweet_berries',
    cave_vines: 'glow_berries',
    cave_vines_plant: 'glow_berries',
    melon_stem: 'melon_seeds',
    pumpkin_stem: 'pumpkin_seeds',
    bamboo_sapling: 'bamboo',
    piston_head: 'piston',
    moving_piston: 'piston',
  };

  return specialMap[clean] || clean;
}

const REPLACEABLE_BLOCKS = new Set([
  'short_grass', 'grass', 'tall_grass', 'fern', 'large_fern',
  'dead_bush', 'dandelion', 'poppy', 'blue_orchid', 'allium',
  'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip',
  'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley',
  'wither_rose', 'sunflower', 'lilac', 'rose_bush', 'peony',
  'snow', 'vine', 'glow_lichen', 'seagrass', 'tall_seagrass'
]);

const DEPENDENT_BLOCK_NAMES = new Set([
  'torch', 'wall_torch', 'soul_torch', 'soul_wall_torch', 'redstone_torch', 'redstone_wall_torch',
  'lantern', 'soul_lantern', 'lever', 'stone_button', 'oak_button', 'spruce_button', 'button',
  'redstone_wire', 'repeater', 'comparator', 'ladder', 'vine', 'glow_lichen',
  'spruce_trapdoor', 'oak_trapdoor', 'iron_trapdoor', 'dark_oak_trapdoor', 'birch_trapdoor',
  'jungle_trapdoor', 'acacia_trapdoor', 'mangrove_trapdoor', 'cherry_trapdoor', 'bamboo_trapdoor',
  'crimson_trapdoor', 'warped_trapdoor', 'carpet', 'gray_carpet', 'black_carpet', 'white_carpet'
]);

function formatBlockState(name, properties) {
  if (!properties || Object.keys(properties).length === 0) return name;
  const props = Object.entries(properties)
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
  return `${name}[${props}]`;
}

/**
 * High-performance, resilient builder engine for Mineflayer bots.
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
    this._warnedGamemode = false;
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
        list.push({ pos: origin.plus(item), name: this.blockName, properties: {}, blockState: this.blockName });
      } else if (item && item.pos) {
        const name = item.name || this.blockName;
        // Skip liquid blocks
        if (name === 'minecraft:water' || name === 'minecraft:lava' || name === 'water' || name === 'lava') {
          continue;
        }
        list.push({
          pos: origin.plus(item.pos),
          name: name,
          properties: item.properties ?? {},
          blockState: item.blockState || formatBlockState(name, item.properties),
        });
      }
    }
    // Sort bottom-to-top so foundation layers build first, and solid blocks before attachables
    list.sort((a, b) => {
      if (a.pos.y !== b.pos.y) return a.pos.y - b.pos.y;
      const aClean = (a.name || '').replace('minecraft:', '');
      const bClean = (b.name || '').replace('minecraft:', '');
      const aDep = DEPENDENT_BLOCK_NAMES.has(aClean) ? 1 : 0;
      const bDep = DEPENDENT_BLOCK_NAMES.has(bClean) ? 1 : 0;
      if (aDep !== bDep) return aDep - bDep;
      return (a.pos.x - b.pos.x) || (a.pos.z - b.pos.z);
    });
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
    this.currentJob = { name: 'None', total: 0, placed: 0, startTime: 0 };
    this._warnedGamemode = false;
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
    this._warnedGamemode = false;

    // Ensure bot is in creative mode before starting building
    if (this.bot && typeof this.bot.chat === 'function') {
      this.bot.chat(`/gamemode creative ${this.bot.username}`);
    }

    const total = this.queue.length;
    this.currentJob.total = total;
    this.currentJob.placed = 0;
    this.currentJob.startTime = Date.now();
    this.placedHistory = [];

    let placed = 0;
    let consecutiveFails = 0;
    const maxConsecutiveFails = Math.max(total * 3, 100);

    while (this.queue.length > 0 && !this.cancelled && this.building && consecutiveFails < maxConsecutiveFails) {
      const target = this.queue.shift();
      if (!target) break;

      try {
        const didPlace = await this._placeOne(target);
        if (didPlace) {
          this.placedHistory.push(target);
          placed++;
          this.currentJob.placed = placed;
          consecutiveFails = 0;

          if (onProgress && (placed % 10 === 0 || placed === total)) {
            const left = total - placed;
            const percent = ((placed / total) * 100).toFixed(1);
            onProgress(placed, total, left, percent, false);
          }
        }
      } catch (err) {
        target.retries = (target.retries || 0) + 1;
        if (target.retries <= 3) {
          this.queue.push(target);
        } else {
          console.log(`[Builder] Skipping block at ${target.pos} after 3 attempts (${err.message})`);
        }
        consecutiveFails++;
        if (consecutiveFails === 3 && this.bot && typeof this.bot.chat === 'function') {
          this.bot.chat(`/gamemode creative ${this.bot.username}`);
          if (!this._warnedGamemode) {
            this._warnedGamemode = true;
            this.bot.chat(`[Builder] ⚠ Cannot place blocks! Requesting: /gamemode creative ${this.bot.username}`);
          }
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

  async _placeViaSetblock(pos, stateStr) {
    const bot = this.bot;
    const x = Math.floor(pos.x);
    const y = Math.floor(pos.y);
    const z = Math.floor(pos.z);
    const cmd = `/setblock ${x} ${y} ${z} ${stateStr} replace`;

    try {
      if (typeof bot.swingArm === 'function') {
        bot.swingArm('right');
      }
    } catch (_) {}

    if (typeof bot.chat === 'function') {
      bot.chat(cmd);
    }

    await sleep(this.placeDelayMs || 100);
    const check = bot.blockAt(pos);
    if (check && check.name && !check.name.includes('air')) {
      return true;
    }
    return false;
  }

  async _placeOne(target) {
    if (this.cancelled) return false;
    const bot = this.bot;

    const rawName = target.name || this.blockName;
    const cleanName = rawName.replace('minecraft:', '');
    const isModded = rawName.includes(':') && !rawName.startsWith('minecraft:');
    const stateStr = target.blockState || formatBlockState(rawName, target.properties);

    // 1. Check if the block at target.pos is ALREADY the exact target block
    const current = bot.blockAt(target.pos);
    if (current && (current.name === cleanName || current.name === rawName)) {
      return false; // Already placed
    }

    // 2. Clear obstacles if needed
    if (current && current.name && !current.name.includes('air') && current.name !== 'water' && current.name !== 'lava') {
      const isReplaceable = REPLACEABLE_BLOCKS.has(current.name);
      if (!isReplaceable) {
        try {
          await this._moveToPosition(target.pos, target.pos);
          if (bot.canDigBlock(current)) {
            await withTimeout(bot.dig(current), 3500);
          }
        } catch (e) {}
      }
    }

    // 3. Modded blocks (Create Mod, etc.): Place directly via /setblock with full blockstate
    if (isModded) {
      try {
        await this._moveToPosition(target.pos, target.pos);
      } catch (_) {}
      const ok = await this._placeViaSetblock(target.pos, stateStr);
      if (ok) return true;
      throw new Error(`Modded block ${stateStr} at ${target.pos} failed to place via /setblock (needs OP)`);
    }

    // 4. Vanilla blocks: Exact match only, NO fuzzy matching!
    const itemName = blockToItemName(cleanName);
    const mcData = require('minecraft-data')(bot.version || '1.21.4');

    // Find exact item in inventory
    let item = bot.inventory.items().find((i) => i.name === itemName || i.name === cleanName);

    // If missing from inventory, unconditionally provision exact item from creative mode
    if (!item && bot.creative && typeof bot.creative.setInventorySlot === 'function') {
      try {
        const itemEntry = mcData?.itemsByName[itemName] || mcData?.blocksByName[cleanName];
        if (itemEntry) {
          const Item = require('prismarine-item')(bot.version || '1.21.4');
          await withTimeout(bot.creative.setInventorySlot(36, new Item(itemEntry.id, 64)), 1000);
          item = bot.inventory.slots[36] || bot.inventory.items().find((i) => i.name === itemName || i.name === cleanName);
        }
      } catch (e) {}
    }

    // If still missing, request creative mode and retry provisioning once
    if (!item && bot.creative && typeof bot.creative.setInventorySlot === 'function') {
      try {
        if (typeof bot.chat === 'function') {
          bot.chat(`/gamemode creative ${bot.username}`);
        }
        await sleep(250);
        const itemEntry = mcData?.itemsByName[itemName] || mcData?.blocksByName[cleanName];
        if (itemEntry) {
          const Item = require('prismarine-item')(bot.version || '1.21.4');
          await withTimeout(bot.creative.setInventorySlot(36, new Item(itemEntry.id, 64)), 1000);
          item = bot.inventory.slots[36] || bot.inventory.items().find((i) => i.name === itemName || i.name === cleanName);
        }
      } catch (e) {}
    }

    // If still no item, try /setblock
    if (!item) {
      const ok = await this._placeViaSetblock(target.pos, stateStr);
      if (ok) return true;
      throw new Error(`Missing item "${cleanName}" in inventory and /setblock failed. Ensure bot is in Creative mode: /gamemode creative ${bot.username}`);
    }

    // 5. Find solid reference block to place against
    let referenceInfo = this._findReferenceBlock(target.pos);
    if (!referenceInfo) {
      if (DEPENDENT_BLOCK_NAMES.has(cleanName) && (target.retries || 0) < 5) {
        target.retries = (target.retries || 0) + 1;
        this.queue.push(target);
        return false;
      }
      referenceInfo = await this._createGroundAnchor(target.pos);
    }
    if (!referenceInfo) {
      const ok = await this._placeViaSetblock(target.pos, stateStr);
      if (ok) return true;
      throw new Error(`No solid block adjacent to place "${cleanName}" against at ${target.pos}`);
    }
    const { refPos, faceVector } = referenceInfo;

    // 6. Move to safe placing position
    try {
      await this._moveToPosition(target.pos, refPos);
    } catch (_) {}

    // 7. Equip exact item to main hand
    if (!bot.heldItem || (bot.heldItem.name !== item.name && bot.heldItem.name !== itemName)) {
      try {
        await bot.equip(item, 'hand');
      } catch (e) {}
    }

    const refBlock = bot.blockAt(refPos);
    if (!refBlock) {
      const ok = await this._placeViaSetblock(target.pos, stateStr);
      if (ok) return true;
      throw new Error(`Reference block at ${refPos} missing`);
    }

    // 8. Look at target face and place block
    const faceOffset = new Vec3(
      0.5 + faceVector.x * 0.5,
      0.5 + faceVector.y * 0.5,
      0.5 + faceVector.z * 0.5
    );

    try {
      await withTimeout(bot.lookAt(refBlock.position.plus(faceOffset), true), 400);
    } catch (e) {}

    // Place block: give realistic timeout (3500ms)
    try {
      await withTimeout(bot.placeBlock(refBlock, faceVector), 3500);
      const verify = bot.blockAt(target.pos);
      if (verify && verify.name && !verify.name.includes('air')) {
        return true;
      }
    } catch (err) {
      const verify = bot.blockAt(target.pos);
      if (verify && verify.name && !verify.name.includes('air')) {
        return true;
      }
    }

    // Fall back to /setblock
    const ok = await this._placeViaSetblock(target.pos, stateStr);
    if (ok) return true;
    throw new Error(`Failed to place "${cleanName}" at ${target.pos}`);
  }

  async _moveToPosition(targetPos, refPos) {
    const bot = this.bot;
    if (!bot.entity) return;
    const currentPos = bot.entity.position;
    const distToTarget = currentPos.distanceTo(targetPos);
    const distToRef = currentPos.distanceTo(refPos);

    // 1. Anti-collision: Ensure bot's bounding box does NOT overlap targetPos
    const isColliding = Math.abs(currentPos.x - (targetPos.x + 0.5)) < 0.9 &&
                        Math.abs(currentPos.z - (targetPos.z + 0.5)) < 0.9 &&
                        currentPos.y <= (targetPos.y + 1.2) &&
                        (currentPos.y + 1.8) >= targetPos.y;

    if (isColliding || distToTarget < 1.3) {
      const dx = currentPos.x >= targetPos.x + 0.5 ? 2.0 : -2.0;
      const dz = currentPos.z >= targetPos.z + 0.5 ? 2.0 : -2.0;
      const safePos = new Vec3(targetPos.x + 0.5 + dx, Math.max(targetPos.y, currentPos.y), targetPos.z + 0.5 + dz);

      if (bot.game?.gameMode === 'creative' && bot.creative && typeof bot.creative.flyTo === 'function') {
        try { await withTimeout(bot.creative.flyTo(safePos), 1000); } catch (e) {}
      } else if (bot.pathfinder) {
        try {
          const { goals } = require('mineflayer-pathfinder');
          await withTimeout(bot.pathfinder.goto(new goals.GoalNear(safePos.x, safePos.y, safePos.z, 0.8)), 2500);
        } catch (e) {}
      }
    }

    // 2. Reach check: Must be within reach distance of refPos (MC reach is ~4.5 blocks, stand at 2.0-3.2)
    const currentDistToRef = bot.entity ? bot.entity.position.distanceTo(refPos) : distToRef;
    if (currentDistToRef > 6.0 && typeof bot.chat === 'function') {
      const standX = refPos.x + (refPos.x > (bot.entity?.position.x || 0) ? -1.8 : 1.8);
      const standZ = refPos.z + (refPos.z > (bot.entity?.position.z || 0) ? -1.8 : 1.8);
      bot.chat(`/tp ${bot.username} ${standX.toFixed(1)} ${refPos.y + 1} ${standZ.toFixed(1)}`);
      await new Promise((r) => setTimeout(r, 400));
    }

    const distAfterTp = bot.entity ? bot.entity.position.distanceTo(refPos) : distToRef;
    if (distAfterTp > 3.6) {
      const standX = refPos.x + (refPos.x > (bot.entity?.position.x || 0) ? -1.8 : 1.8);
      const standZ = refPos.z + (refPos.z > (bot.entity?.position.z || 0) ? -1.8 : 1.8);
      const standY = refPos.y;

      if (bot.game?.gameMode === 'creative' && bot.creative && typeof bot.creative.flyTo === 'function') {
        try { await withTimeout(bot.creative.flyTo(new Vec3(standX, standY + 1.0, standZ)), 1200); } catch (e) {}
      } else if (bot.pathfinder) {
        try {
          const { goals } = require('mineflayer-pathfinder');
          await withTimeout(bot.pathfinder.goto(new goals.GoalNear(refPos.x, refPos.y, refPos.z, 2.5)), 3500);
        } catch (e) {}
      }
    }

    // 3. Strict Reach Guard: Never attempt placeBlock if out of reach!
    const finalDist = bot.entity ? bot.entity.position.distanceTo(refPos) : 999;
    if (finalDist > 4.2) {
      throw new Error(`Out of reach: distance to reference block is ${finalDist.toFixed(1)} blocks (max 4.2)`);
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

  async _createGroundAnchor(targetPos) {
    const bot = this.bot;
    const targetY = targetPos.y;

    let groundY = null;
    for (let y = targetY - 1; y >= Math.max(-60, targetY - 60); y--) {
      const checkPos = new Vec3(targetPos.x, y, targetPos.z);
      const b = bot.blockAt(checkPos);
      if (b && b.name && !b.name.includes('air') && b.name !== 'water' && b.name !== 'lava') {
        groundY = y;
        break;
      }
    }

    if (groundY === null && bot.entity) {
      const botGround = bot.entity.position.floored().offset(0, -1, 0);
      const b = bot.blockAt(botGround);
      if (b && b.name && !b.name.includes('air')) {
        return { refPos: botGround, faceVector: new Vec3(0, 1, 0) };
      }
      return null;
    }

    if (bot.game?.gameMode === 'creative' && bot.creative && typeof bot.creative.setInventorySlot === 'function') {
      try {
        const Item = require('prismarine-item')(bot.version || '1.21.4');
        await bot.creative.setInventorySlot(36, new Item(1, 64)); // stone
      } catch (e) {}
    }

    for (let y = groundY + 1; y < targetY; y++) {
      const pillarPos = new Vec3(targetPos.x, y, targetPos.z);
      const cur = bot.blockAt(pillarPos);
      if (cur && cur.name && !cur.name.includes('air') && cur.name !== 'water') continue;

      const below = new Vec3(targetPos.x, y - 1, targetPos.z);
      const belowBlock = bot.blockAt(below);
      if (!belowBlock) break;

      await this._moveToPosition(pillarPos, below);
      try {
        await withTimeout(bot.placeBlock(belowBlock, new Vec3(0, 1, 0)), 3000);
        this.scaffoldHistory.push(pillarPos);
      } catch (e) {
        break;
      }
    }

    return this._findReferenceBlock(targetPos);
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
            await this._moveToPosition(pos, pos);
          }
          await withTimeout(bot.dig(block), 2500);
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

async function placeBlockRobust(bot, pos, blockName, blockStateString) {
  const b = new Builder(bot);
  return b._placeOne({ pos: new Vec3(pos.x, pos.y, pos.z), name: blockName, blockState: blockStateString });
}

async function runBuildPlan(bot, buildPlan, onProgress) {
  const b = new Builder(bot);
  b.enqueue(buildPlan, new Vec3(0, 0, 0));
  return b.run(onProgress);
}

module.exports = { Builder, blockToItemName, withTimeout, formatBlockState, placeBlockRobust, runBuildPlan };
