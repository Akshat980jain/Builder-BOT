'use strict';

const { Vec3 } = require('vec3');
const PrismarineItem = require('prismarine-item');

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
  'snow', 'vine', 'glow_lichen', 'seagrass', 'tall_seagrass',
]);

const DEPENDENT_BLOCK_NAMES = new Set([
  'torch', 'wall_torch', 'soul_torch', 'soul_wall_torch', 'redstone_torch', 'redstone_wall_torch',
  'lantern', 'soul_lantern', 'lever', 'stone_button', 'oak_button', 'spruce_button', 'button',
  'redstone_wire', 'repeater', 'comparator', 'ladder', 'vine', 'glow_lichen',
  'spruce_trapdoor', 'oak_trapdoor', 'iron_trapdoor', 'dark_oak_trapdoor', 'birch_trapdoor',
  'jungle_trapdoor', 'acacia_trapdoor', 'mangrove_trapdoor', 'cherry_trapdoor', 'bamboo_trapdoor',
  'crimson_trapdoor', 'warped_trapdoor', 'carpet', 'gray_carpet', 'black_carpet', 'white_carpet',
]);

function formatBlockState(name, properties) {
  if (!properties || Object.keys(properties).length === 0) return name;
  const props = Object.entries(properties)
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
  return `${name}[${props}]`;
}

/**
 * Ultra-Fast, High-Reliability Builder Engine for Mineflayer Bots.
 *
 * KEY PERFORMANCE & VISIBILITY FEATURES:
 * 1. REAL SERVER PACKET PLACEMENT:
 *    Uses bot._genericPlace() to send genuine Minecraft block placement packets
 *    with valid look direction, arm swing, and reference block interaction.
 *    The server processes the placement and broadcasts block_change, making
 *    all placed blocks 100% VISIBLE immediately to all players on the server.
 *
 * 2. PIPELINED PLACEMENT (30+ blocks/sec):
 *    Does not block for 5000ms server ACKs. Fires placement with configurable
 *    micro-delays (25-35ms in creative), achieving massive build speeds.
 *
 * 3. SMART POSITIONING & ANTI-COLLISION:
 *    Checks if the bot is already within reach (<=4.2 blocks) and not colliding
 *    with the target. If so, skips movement entirely! A single stand location
 *    can place 20-50 blocks without moving.
 *
 * 4. DEPENDENCY & OVERHANG DEFERRAL:
 *    Blocks with no solid neighbor yet are deferred to the end of the queue
 *    instead of being discarded. By the time they are retried, their supporting
 *    blocks are already built.
 */
class Builder {
  constructor(bot, {
    blockName       = 'cobblestone',
    placeDelayMs    = 50,   // Survival mode delay (ms)
    creativeDelayMs = 30,   // Creative mode delay (ms) — enables 30+ blocks/sec
    scaffoldBlock   = 'dirt',
  } = {}) {
    this.bot             = bot;
    this.blockName       = blockName;
    this.placeDelayMs    = placeDelayMs;
    this.creativeDelayMs = creativeDelayMs;
    this.scaffoldBlock   = scaffoldBlock;

    this.queue           = [];
    this.placedHistory   = [];
    this.scaffoldHistory = [];
    this.building        = false;
    this.cancelled       = false;
    this.originPos       = null;
    this.currentJob      = { name: 'None', total: 0, placed: 0, startTime: 0 };
    this._warnedGamemode = false;
    this._mcDataCache    = null;
  }

  _mcData() {
    if (!this._mcDataCache) {
      try { this._mcDataCache = require('minecraft-data')(this.bot.version || '1.21.4'); } catch (_) {}
    }
    return this._mcDataCache;
  }

  setJob(name) { this.currentJob.name = name; }

  getStatus() {
    if (!this.building) {
      return { active: false, name: 'None', placed: 0, total: 0, left: 0, percent: 0 };
    }
    const placed  = this.placedHistory.length;
    const total   = this.currentJob.total || (placed + this.queue.length);
    const left    = Math.max(0, total - placed);
    const percent = total > 0 ? ((placed / total) * 100).toFixed(1) : 0;
    return { active: true, name: this.currentJob.name, placed, total, left, percent };
  }

  isBuilding() { return this.building; }

  cancel() {
    this.cancelled = true;
    this.queue = [];
    this.originPos = null;
    this.building = false;
    this.currentJob = { name: 'None', total: 0, placed: 0, startTime: 0 };
    this._warnedGamemode = false;
    try {
      if (this.bot.pathfinder) {
        this.bot.pathfinder.stop();
        this.bot.pathfinder.setGoal(null);
      }
    } catch (_) {}
  }

  /**
   * Enqueue blocks to build.
   * Input: array of { pos: Vec3 offset, name: string, properties: {} }
   * Strictly sorted bottom-to-top (Y ascending), solid blocks before attachables.
   */
  enqueue(offsetsOrBlocks, origin) {
    if (origin) this.originPos = origin;
    const list = [];
    for (const item of offsetsOrBlocks) {
      if (item instanceof Vec3) {
        list.push({ pos: origin.plus(item), name: this.blockName, properties: {}, blockState: this.blockName });
      } else if (item && item.pos) {
        const name = item.name || this.blockName;
        // Skip liquids
        if (name === 'minecraft:water' || name === 'minecraft:lava' || name === 'water' || name === 'lava') continue;
        list.push({
          pos: origin.plus(item.pos),
          name,
          properties: item.properties ?? {},
          blockState: item.blockState || formatBlockState(name, item.properties),
        });
      }
    }

    // Sort strictly bottom-to-top (Y ascending).
    // Within same Y: solid blocks first, then attachables (torches, carpets, etc.)
    list.sort((a, b) => {
      if (a.pos.y !== b.pos.y) return a.pos.y - b.pos.y;
      const aClean = (a.name || '').replace('minecraft:', '');
      const bClean = (b.name || '').replace('minecraft:', '');
      const aDep = DEPENDENT_BLOCK_NAMES.has(aClean) ? 1 : 0;
      const bDep = DEPENDENT_BLOCK_NAMES.has(bClean) ? 1 : 0;
      if (aDep !== bDep) return aDep - bDep;
      return (a.pos.x - b.pos.x) || (a.pos.z - b.pos.z);
    });

    for (const item of list) this.queue.push(item);
  }

  /**
   * Main build execution loop.
   */
  async run(onProgress) {
    if (this.building) throw new Error('Already building.');
    this.building = true;
    this.cancelled = false;
    this._warnedGamemode = false;

    // Ensure creative mode & flight if possible
    if (this.bot && typeof this.bot.chat === 'function') {
      try { this.bot.chat(`/gamemode creative ${this.bot.username}`); } catch (_) {}
    }
    await sleep(250);

    if (this.bot.creative && typeof this.bot.creative.startFlying === 'function') {
      try { this.bot.creative.startFlying(); } catch (_) {}
    }

    const total = this.queue.length;
    this.currentJob.total     = total;
    this.currentJob.placed    = 0;
    this.currentJob.startTime = Date.now();
    this.placedHistory        = [];

    let placed = 0;
    let consecutiveFails = 0;
    const maxConsecutiveFails = Math.max(total * 4, 300);

    while (this.queue.length > 0 && !this.cancelled && this.building && consecutiveFails < maxConsecutiveFails) {
      const target = this.queue.shift();
      if (!target) break;

      const rawName   = target.name || this.blockName;
      const cleanName = rawName.replace('minecraft:', '');

      // 1. Skip if block is already placed
      const current = this.bot.blockAt(target.pos);
      if (current && (current.name === cleanName || current.name === rawName)) {
        this.placedHistory.push(target);
        placed++;
        this.currentJob.placed = placed;
        consecutiveFails = 0;
        continue;
      }

      // 2. Skip liquids
      if (cleanName === 'water' || cleanName === 'lava') continue;

      // 3. Find solid reference block to place against
      let refInfo = this._findReferenceBlock(target.pos);
      if (!refInfo) {
        // If this is the starting block and nothing is placed yet, or if it matches origin,
        // anchor immediately with scaffolding instead of deferring it!
        const isAnchorBlock = this.placedHistory.length === 0 || (this.originPos && target.pos.equals(this.originPos));
        if (isAnchorBlock) {
          await this._placeScaffoldUnder(target.pos);
          refInfo = this._findReferenceBlock(target.pos);
        }
      }
      if (!refInfo) {
        target.deferred = (target.deferred || 0) + 1;
        if (target.deferred <= 10) {
          // Defer to back of queue so supporting blocks are placed first
          this.queue.push(target);
          continue;
        }
        // If still floating after 10 passes, place an anchor scaffold underneath
        await this._placeScaffoldUnder(target.pos);
        refInfo = this._findReferenceBlock(target.pos);
        if (!refInfo) {
          consecutiveFails++;
          continue;
        }
      }

      // 4. Position bot, ensure correct item in hand, and clear obstacle
      try {
        await this._ensurePositionFor(target.pos, refInfo.refPos);
        await this._ensureHeldItem(cleanName);

        // Clear breakable obstacle (tall grass, flowers, snow layer)
        const curBlock = this.bot.blockAt(target.pos);
        if (curBlock && curBlock.name && !curBlock.name.includes('air') && curBlock.name !== 'water' && curBlock.name !== 'lava') {
          if (REPLACEABLE_BLOCKS.has(curBlock.name)) {
            if (this.bot.canDigBlock(curBlock)) {
              await withTimeout(this.bot.dig(curBlock), 1200);
            }
          }
        }

        // 5. Send genuine Minecraft block placement packet
        const refBlock = this.bot.blockAt(refInfo.refPos) || refInfo.refBlock;
        if (!refBlock) throw new Error('Reference block missing');

        await this.bot._genericPlace(refBlock, refInfo.faceVector, {
          swingArm: 'right',
          forceLook: true,
        });

        this.placedHistory.push(target);
        placed++;
        this.currentJob.placed = placed;
        consecutiveFails = 0;

        if (onProgress && (placed % 20 === 0 || placed === total || this.queue.length === 0)) {
          const left    = Math.max(0, total - placed);
          const percent = total > 0 ? ((placed / total) * 100).toFixed(1) : 100;
          onProgress(placed, total, left, percent, false);
        }

      } catch (err) {
        target.retries = (target.retries || 0) + 1;
        if (target.retries <= 4) {
          this.queue.push(target);
        } else {
          console.log(`[Builder] Skipping (${target.pos.x},${target.pos.y},${target.pos.z}) after 4 attempts: ${err.message}`);
        }
        consecutiveFails++;

        if (consecutiveFails >= 15 && !this._warnedGamemode) {
          this._warnedGamemode = true;
          console.log(`[Builder] ⚠ Consecutive failures for ${this.bot.username} — re-applying creative mode...`);
          try { this.bot.chat(`/gamemode creative ${this.bot.username}`); } catch (_) {}
        }
      }

      // Pipelined placement delay (25-35ms in creative = 30+ blocks/sec)
      const isCreative = this.bot.game?.gameMode === 'creative';
      const delay = isCreative ? this.creativeDelayMs : this.placeDelayMs;
      if (delay > 0) await sleep(delay);
      else await sleep(0);
    }

    this.building = false;
    const left    = Math.max(0, total - placed);
    const percent = total > 0 ? ((placed / total) * 100).toFixed(1) : 100;
    if (onProgress) onProgress(placed, total, left, percent, true);
    return { placed, total, left, percent, cancelled: this.cancelled };
  }

  // ---------------------------------------------------------------------------
  // Reference Block Discovery
  // ---------------------------------------------------------------------------

  /**
   * Searches the 6 adjacent positions for an existing solid block to place against.
   * Prioritizes bottom (top face of block below) for most natural, reliable placement.
   */
  _findReferenceBlock(target) {
    const bot = this.bot;
    const candidates = [
      { pos: target.offset(0, -1, 0), face: new Vec3(0,  1, 0) }, // Below -> top face
      { pos: target.offset(0,  0, -1),face: new Vec3(0,  0, 1) }, // North -> south face
      { pos: target.offset(0,  0,  1),face: new Vec3(0,  0,-1) }, // South -> north face
      { pos: target.offset(-1, 0,  0),face: new Vec3(1,  0, 0) }, // West -> east face
      { pos: target.offset(1,  0,  0),face: new Vec3(-1, 0, 0) }, // East -> west face
      { pos: target.offset(0,  1,  0),face: new Vec3(0, -1, 0) }, // Above -> bottom face
    ];

    for (const c of candidates) {
      const block = bot.blockAt(c.pos);
      if (block && block.name && !block.name.includes('air') && block.name !== 'water' && block.name !== 'lava') {
        return { refPos: c.pos, faceVector: c.face, refBlock: block };
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Anti-Collision & Smart Positioning
  // ---------------------------------------------------------------------------

  /**
   * Ensures the bot is within reach (<= 4.2 blocks) and NOT colliding with the block
   * being placed. If already in valid position, returns immediately (0ms).
   */
  async _ensurePositionFor(targetPos, refPos) {
    const bot = this.bot;
    if (!bot.entity) return;

    const currentPos = bot.entity.position;
    const distToRef  = currentPos.distanceTo(refPos);
    const distToTarget = currentPos.distanceTo(targetPos);

    // Anti-collision: player bounding box is 0.6x1.8x0.6
    const isColliding = Math.abs(currentPos.x - (targetPos.x + 0.5)) < 0.8 &&
                        Math.abs(currentPos.z - (targetPos.z + 0.5)) < 0.8 &&
                        currentPos.y >= (targetPos.y - 1.8) &&
                        currentPos.y <= (targetPos.y + 1.0);

    // If within reach and NOT colliding, no movement needed!
    if (distToRef <= 4.2 && distToTarget <= 4.5 && !isColliding) {
      return;
    }

    // Reposition to a vantage point: 2 blocks away horizontally, 1.2 blocks above
    const dx = currentPos.x > targetPos.x ? 2.0 : -2.0;
    const dz = currentPos.z > targetPos.z ? 2.0 : -2.0;
    const standPos = new Vec3(targetPos.x + dx, targetPos.y + 1.2, targetPos.z + dz);

    if (bot.game?.gameMode === 'creative' && bot.creative && typeof bot.creative.flyTo === 'function') {
      try {
        await withTimeout(bot.creative.flyTo(standPos), 1200);
      } catch (_) {
        bot.entity.position = standPos;
      }
    } else if (bot.pathfinder) {
      try {
        const { goals } = require('mineflayer-pathfinder');
        await withTimeout(bot.pathfinder.goto(new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, 2.5)), 2500);
      } catch (_) {}
    }
  }

  // ---------------------------------------------------------------------------
  // Inventory & Item Provisioning
  // ---------------------------------------------------------------------------

  /**
   * Ensures the correct item is equipped in the bot's main hand.
   * In creative mode, provisions infinite stacks into hotbar slot 36 if needed.
   * Returns immediately if the bot is already holding the item.
   */
  async _ensureHeldItem(cleanName) {
    const bot = this.bot;
    const itemName = blockToItemName(cleanName);

    // Already holding the correct item? Instant return!
    if (bot.heldItem && (bot.heldItem.name === itemName || bot.heldItem.name === cleanName)) {
      return;
    }

    // Look in inventory
    let item = bot.inventory.items().find((i) => i.name === itemName || i.name === cleanName);

    // If creative mode and missing from inventory, provision into slot 36
    if (!item && bot.creative && typeof bot.creative.setInventorySlot === 'function') {
      try {
        const mcData = this._mcData();
        const itemEntry = mcData?.itemsByName[itemName] || mcData?.blocksByName[cleanName];
        if (itemEntry) {
          const Item = PrismarineItem(bot.version || '1.21.4');
          await withTimeout(bot.creative.setInventorySlot(36, new Item(itemEntry.id, 64)), 1000);
          await sleep(50);
          item = bot.inventory.slots[36] || bot.inventory.items().find((i) => i.name === itemName || i.name === cleanName);
        }
      } catch (_) {}
    }

    if (item) {
      try {
        await bot.equip(item, 'hand');
      } catch (_) {}
    }
  }

  // ---------------------------------------------------------------------------
  // Ground Anchor & Scaffold Helpers
  // ---------------------------------------------------------------------------

  async _placeScaffoldUnder(pos) {
    const bot = this.bot;
    const scaffoldPos = pos.offset(0, -1, 0);
    const existing = bot.blockAt(scaffoldPos);
    if (existing && existing.name && !existing.name.includes('air')) return;

    let groundY = null;
    for (let y = scaffoldPos.y - 1; y >= Math.max(-60, scaffoldPos.y - 15); y--) {
      const b = bot.blockAt(new Vec3(scaffoldPos.x, y, scaffoldPos.z));
      if (b && b.name && !b.name.includes('air') && b.name !== 'water' && b.name !== 'lava') {
        groundY = y;
        break;
      }
    }

    if (groundY !== null) {
      await this._ensureHeldItem(this.scaffoldBlock || 'cobblestone');
      for (let y = groundY; y < scaffoldPos.y; y++) {
        const below = bot.blockAt(new Vec3(scaffoldPos.x, y, scaffoldPos.z));
        if (!below || below.name.includes('air')) break;
        const currentTarget = new Vec3(scaffoldPos.x, y + 1, scaffoldPos.z);
        await this._ensurePositionFor(currentTarget, below.position);
        try {
          await bot._genericPlace(below, new Vec3(0, 1, 0), { swingArm: 'right', forceLook: true });
          this.scaffoldHistory.push(currentTarget);
          await sleep(25);
        } catch (_) { break; }
      }
    } else if (bot.game?.gameMode === 'creative' || bot.creative) {
      // In creative mode, if floating in the sky with no ground below, place an instant anchor support block
      try {
        if (typeof bot.chat === 'function') {
          bot.chat(`/setblock ${scaffoldPos.x} ${scaffoldPos.y} ${scaffoldPos.z} ${this.scaffoldBlock || 'cobblestone'}`);
          this.scaffoldHistory.push(scaffoldPos);
          await sleep(50);
        }
      } catch (_) {}
    }
  }

  // ---------------------------------------------------------------------------
  // Undo & Teardown
  // ---------------------------------------------------------------------------

  async undo(onProgress) {
    this.cancel();
    const bot   = this.bot;
    const total = this.placedHistory.length;
    let undone  = 0;

    while (this.placedHistory.length > 0) {
      const target = this.placedHistory.pop();
      const pos    = target.pos;
      const block  = bot.blockAt(pos);
      if (block && block.name && !block.name.includes('air')) {
        try {
          if (bot.entity && bot.entity.position.distanceTo(pos) > 4.0) {
            await this._ensurePositionFor(pos, pos);
          }
          await withTimeout(bot.dig(block), 2000);
        } catch (err) {
          bot.emit('builder_undo_error', pos, err);
        }
      }
      undone++;
      if (onProgress && undone % 20 === 0) onProgress(undone, total);
      await sleep(30);
    }
    if (onProgress) onProgress(undone, total, true);
    return { undone, total };
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

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
  b.enqueue([{ pos: new Vec3(0, 0, 0), name: blockName, blockState: blockStateString }], new Vec3(pos.x, pos.y, pos.z));
  return b.run();
}

async function runBuildPlan(bot, buildPlan, onProgress) {
  const b = new Builder(bot);
  b.enqueue(buildPlan, new Vec3(0, 0, 0));
  return b.run(onProgress);
}

module.exports = { Builder, blockToItemName, withTimeout, formatBlockState, placeBlockRobust, runBuildPlan };
