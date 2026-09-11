'use strict';

const { Vec3 } = require('vec3');

// Cache minecraft-data at module level — avoid repeated require() inside hot paths
let _mcDataCache = null;
function getMcData(version) {
  if (!_mcDataCache) {
    try { _mcDataCache = require('minecraft-data')(version || '1.21.4'); } catch (_) {}
  }
  return _mcDataCache;
}

// ---------------------------------------------------------------------------
// Bit-packed palette index unpacking — Litematica's exact format
// ---------------------------------------------------------------------------
//
// PERFORMANCE NOTE: The original implementation used BigInt arithmetic which
// is 10–100× slower than Number operations in V8. We now use a pair of
// 32-bit integers (hi/lo) to represent each 64-bit long, which lets us use
// fast bitwise operators throughout while correctly handling values up to
// 52 bits (more than enough for palette indices).
//
// Litematica stores the block-state array as an array of signed 64-bit longs
// in Java format (big-endian, but prismarine-nbt gives them as JS BigInts).
// We convert each BigInt to {hi, lo} once, then index into that.

function unpackBitArray(longArray, bitsPerEntry, entryCount) {
  const indices = new Int32Array(entryCount);
  const mask = (1 << bitsPerEntry) - 1; // safe for bitsPerEntry up to 31

  // Pre-convert the BigInt long array into paired 32-bit halves
  const n = longArray.length;
  const hi = new Int32Array(n);
  const lo = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const v = BigInt.asUintN(64, BigInt(longArray[i] ?? 0n));
    lo[i] = Number(v & 0xffffffffn);
    hi[i] = Number((v >> 32n) & 0xffffffffn);
  }

  let bitOffset = 0;
  for (let i = 0; i < entryCount; i++) {
    const longIdx = Math.floor(bitOffset / 64);
    const bitInLong = bitOffset % 64;
    const bitsLeft = 64 - bitInLong;

    let value;
    if (bitsLeft >= bitsPerEntry) {
      // Entry fits entirely within one long
      if (bitInLong < 32) {
        // Starts in lo half
        if (bitInLong + bitsPerEntry <= 32) {
          value = (lo[longIdx] >>> bitInLong) & mask;
        } else {
          // Spans lo→hi within same long
          const fromLo = (lo[longIdx] >>> bitInLong) & ((1 << (32 - bitInLong)) - 1);
          const fromHi = hi[longIdx] & ((1 << (bitsPerEntry - (32 - bitInLong))) - 1);
          value = fromLo | (fromHi << (32 - bitInLong));
        }
      } else {
        // Starts in hi half
        const bit = bitInLong - 32;
        value = (hi[longIdx] >>> bit) & mask;
      }
    } else {
      // Entry spans two longs
      const next = longIdx + 1;
      const fromCurrent = bitsLeft < 32
        ? (bitInLong < 32
            ? (lo[longIdx] >>> bitInLong) | ((hi[longIdx] & ((1 << (bitsLeft - (32 - bitInLong))) - 1)) << (32 - bitInLong))
            : (hi[longIdx] >>> (bitInLong - 32)))
        : 0;
      const bitsFromNext = bitsPerEntry - bitsLeft;
      const fromNext = next < n ? lo[next] & ((1 << bitsFromNext) - 1) : 0;
      value = (fromCurrent & ((1 << bitsLeft) - 1)) | (fromNext << bitsLeft);
    }

    indices[i] = value & mask;
    bitOffset += bitsPerEntry;
  }

  return indices;
}

function bitsNeededForPalette(paletteSize) {
  return Math.max(2, Math.ceil(Math.log2(Math.max(paletteSize, 1))));
}

// ---------------------------------------------------------------------------
// Rotation
// ---------------------------------------------------------------------------

/** Rotates an (x, z) offset around the origin by 0/90/180/270 degrees. */
function rotateOffset(offset, rotation) {
  const { x, y, z } = offset;
  switch (((rotation % 360) + 360) % 360) {
    case 90:  return new Vec3(-z, y, x);
    case 180: return new Vec3(-x, y, -z);
    case 270: return new Vec3(z, y, -x);
    default:  return new Vec3(x, y, z);
  }
}

const FACING_CYCLE_CW = { north: 'east', east: 'south', south: 'west', west: 'north' };
const AXIS_SWAP = { x: 'z', z: 'x' };

function rotateProperties(properties, rotation) {
  const steps = (((rotation % 360) + 360) % 360) / 90;
  if (steps === 0 || !properties) return properties;

  const result = { ...properties };

  if (typeof result.facing === 'string') {
    let f = result.facing;
    for (let i = 0; i < steps; i++) {
      f = FACING_CYCLE_CW[f] ?? f;
    }
    result.facing = f;
  }

  if (typeof result.axis === 'string' && result.axis !== 'y') {
    if (steps % 2 === 1) {
      result.axis = AXIS_SWAP[result.axis] ?? result.axis;
    }
  }

  if (typeof result.rotation === 'string' && /^\d+$/.test(result.rotation)) {
    const current = parseInt(result.rotation, 10);
    result.rotation = String((current + steps * 4) % 16);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Finalize Blocks: Normalization, Rotation & Bottom-to-Top Sorting
// ---------------------------------------------------------------------------

function formatBlockState(name, properties) {
  if (!properties || Object.keys(properties).length === 0) return name;
  const props = Object.entries(properties)
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
  return `${name}[${props}]`;
}

const DEPENDENT_BLOCK_NAMES = new Set([
  'torch', 'wall_torch', 'soul_torch', 'soul_wall_torch', 'redstone_torch', 'redstone_wall_torch',
  'lantern', 'soul_lantern', 'lever', 'stone_button', 'oak_button', 'spruce_button', 'button',
  'redstone_wire', 'repeater', 'comparator', 'ladder', 'vine', 'glow_lichen',
  'spruce_trapdoor', 'oak_trapdoor', 'iron_trapdoor', 'dark_oak_trapdoor', 'birch_trapdoor',
  'jungle_trapdoor', 'acacia_trapdoor', 'mangrove_trapdoor', 'cherry_trapdoor', 'bamboo_trapdoor',
  'crimson_trapdoor', 'warped_trapdoor', 'carpet', 'gray_carpet', 'black_carpet', 'white_carpet',
]);

function finalizeBlocks(rawBlocks, rotation = 0) {
  if (rawBlocks.length === 0) return [];

  // 1. Anchor the lowest bounding-box corner at (0, 0, 0)
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  for (const b of rawBlocks) {
    if (b.pos.x < minX) minX = b.pos.x;
    if (b.pos.y < minY) minY = b.pos.y;
    if (b.pos.z < minZ) minZ = b.pos.z;
  }

  // 2. Apply spatial rotation around the anchor origin
  const rotated = [];
  for (const b of rawBlocks) {
    const normalized = new Vec3(b.pos.x - minX, b.pos.y - minY, b.pos.z - minZ);
    const rotatedOffset = rotateOffset(normalized, rotation);
    const rotatedProps = rotateProperties(b.properties, rotation);
    rotated.push({
      pos: rotatedOffset,
      name: b.name,
      properties: rotatedProps ?? {},
      blockState: formatBlockState(b.name, rotatedProps),
    });
  }

  // 3. Re-normalize after rotation so minimum bounds are strictly (0, 0, 0)
  let rMinX = Infinity, rMinY = Infinity, rMinZ = Infinity;
  for (const b of rotated) {
    if (b.pos.x < rMinX) rMinX = b.pos.x;
    if (b.pos.y < rMinY) rMinY = b.pos.y;
    if (b.pos.z < rMinZ) rMinZ = b.pos.z;
  }

  const finalBlocks = rotated.map((b) => ({
    ...b,
    pos: new Vec3(b.pos.x - rMinX, b.pos.y - rMinY, b.pos.z - rMinZ),
  }));

  // 4. Sort strictly bottom-to-top (Y asc), solid blocks before attachables
  finalBlocks.sort((a, b) => {
    if (a.pos.y !== b.pos.y) return a.pos.y - b.pos.y;
    const aClean = a.name.replace('minecraft:', '');
    const bClean = b.name.replace('minecraft:', '');
    const aDep = DEPENDENT_BLOCK_NAMES.has(aClean) ? 1 : 0;
    const bDep = DEPENDENT_BLOCK_NAMES.has(bClean) ? 1 : 0;
    if (aDep !== bDep) return aDep - bDep;
    if (a.pos.z !== b.pos.z) return a.pos.z - b.pos.z;
    return a.pos.x - b.pos.x;
  });

  // Anchor the starting block directly to (0, 0, 0) so the build starts exactly at the assigned origin
  if (finalBlocks.length > 0) {
    const startX = finalBlocks[0].pos.x;
    const startY = finalBlocks[0].pos.y;
    const startZ = finalBlocks[0].pos.z;
    if (startX !== 0 || startY !== 0 || startZ !== 0) {
      for (const b of finalBlocks) {
        b.pos.x -= startX;
        b.pos.y -= startY;
        b.pos.z -= startZ;
      }
    }
  }

  return finalBlocks;
}

// ---------------------------------------------------------------------------
// Litematica (.litematic) parser
// ---------------------------------------------------------------------------

function parseLitematicBlocks(simplifiedNbt, rotation = 0) {
  const regions = simplifiedNbt.Regions ?? {};
  const rawBlocks = [];

  for (const regionName of Object.keys(regions)) {
    const region = regions[regionName];
    const palette = region.BlockStatePalette ?? [];
    const size = region.Size;
    const position = region.Position ?? { x: 0, y: 0, z: 0 };

    const sizeX = Math.abs(size.x);
    const sizeY = Math.abs(size.y);
    const sizeZ = Math.abs(size.z);
    const volume = sizeX * sizeY * sizeZ;

    const minX = size.x < 0 ? position.x + size.x + 1 : position.x;
    const minY = size.y < 0 ? position.y + size.y + 1 : position.y;
    const minZ = size.z < 0 ? position.z + size.z + 1 : position.z;

    const bitsPerEntry = bitsNeededForPalette(palette.length);
    const longArray = region.BlockStates;
    if (!longArray) continue;

    const indices = unpackBitArray(longArray, bitsPerEntry, volume);

    let i = 0;
    for (let y = 0; y < sizeY; y++) {
      for (let z = 0; z < sizeZ; z++) {
        for (let x = 0; x < sizeX; x++) {
          const paletteIndex = indices[i++];
          const entry = palette[paletteIndex];
          if (!entry || entry.Name === 'minecraft:air') continue;

          rawBlocks.push({
            pos: new Vec3(minX + x, minY + y, minZ + z),
            name: entry.Name,
            properties: entry.Properties ?? {},
          });
        }
      }
    }
  }

  return finalizeBlocks(rawBlocks, rotation);
}

// ---------------------------------------------------------------------------
// Minecraft Structure (.nbt) parser
// ---------------------------------------------------------------------------

function parseStructureNbtBlocks(simplifiedNbt, rotation = 0) {
  const palette = simplifiedNbt.palette ?? [];
  const blockList = simplifiedNbt.blocks ?? [];
  const rawBlocks = [];

  for (const b of blockList) {
    const entry = palette[b.state];
    if (!entry || entry.Name === 'minecraft:air') continue;

    const [x, y, z] = b.pos;
    rawBlocks.push({ pos: new Vec3(x, y, z), name: entry.Name, properties: entry.Properties ?? {} });
  }

  return finalizeBlocks(rawBlocks, rotation);
}

// ---------------------------------------------------------------------------
// Legacy MCEdit (.schematic) parser — numeric block ID era (pre-1.13)
// ---------------------------------------------------------------------------

function parseLegacySchematicBlocks(simplifiedNbt, rotation = 0) {
  const width  = simplifiedNbt.Width;
  const height = simplifiedNbt.Height;
  const length = simplifiedNbt.Length;
  const blocks = simplifiedNbt.Blocks;
  if (!blocks || !width || !height || !length) return [];

  // Use module-level cached mcData
  const mcData = getMcData('1.12.2');

  const rawBlocks = [];
  for (let y = 0; y < height; y++) {
    for (let z = 0; z < length; z++) {
      for (let x = 0; x < width; x++) {
        const index = (y * length + z) * width + x;
        const id = blocks[index] & 0xff;
        if (id === 0) continue; // Air

        let blockName = 'minecraft:stone';
        if (mcData && mcData.blocks[id]) {
          blockName = 'minecraft:' + mcData.blocks[id].name;
        }
        rawBlocks.push({ pos: new Vec3(x, y, z), name: blockName, properties: {} });
      }
    }
  }

  return finalizeBlocks(rawBlocks, rotation);
}

// ---------------------------------------------------------------------------
// Sponge Schematic (.schem) parser — post-1.13 format
// ---------------------------------------------------------------------------

function parseSpongeSchematicBlocks(simplifiedNbt, rotation = 0) {
  const width   = simplifiedNbt.Width;
  const height  = simplifiedNbt.Height;
  const length  = simplifiedNbt.Length;
  const palette = simplifiedNbt.Palette;     // { "minecraft:stone": 0, ... }
  const blockData = simplifiedNbt.BlockData; // byte array of varint-packed palette indices

  if (!palette || !blockData || !width || !height || !length) return [];

  // Build reverse palette: index → name
  const reversePalette = {};
  for (const [name, idx] of Object.entries(palette)) {
    reversePalette[idx] = name;
  }

  // Decode varint-packed blockData byte array
  const rawBlocks = [];
  let byteIdx = 0;
  let blockIdx = 0;

  while (byteIdx < blockData.length) {
    // Read varint
    let value = 0;
    let shift = 0;
    let b;
    do {
      b = blockData[byteIdx++] & 0xff;
      value |= (b & 0x7f) << shift;
      shift += 7;
    } while (b & 0x80);

    const name = reversePalette[value];
    if (name && name !== 'minecraft:air') {
      // Sponge: index = y * length * width + z * width + x
      const y = Math.floor(blockIdx / (width * length));
      const rem = blockIdx % (width * length);
      const z = Math.floor(rem / width);
      const x = rem % width;
      rawBlocks.push({ pos: new Vec3(x, y, z), name, properties: {} });
    }
    blockIdx++;
  }

  return finalizeBlocks(rawBlocks, rotation);
}

module.exports = {
  unpackBitArray,
  bitsNeededForPalette,
  rotateOffset,
  rotateProperties,
  parseLitematicBlocks,
  parseStructureNbtBlocks,
  parseLegacySchematicBlocks,
  parseSpongeSchematicBlocks,
  finalizeBlocks,
};
