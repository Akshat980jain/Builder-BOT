'use strict';

const { Vec3 } = require('vec3');

/**
 * Reads a LongArray of bit-packed palette indices, litematica's exact format.
 */
function unpackBitArray(longArray, bitsPerEntry, entryCount) {
  const indices = new Array(entryCount);
  const mask = (1n << BigInt(bitsPerEntry)) - 1n;
  let bitOffset = 0n;
  const bitsPerEntryBig = BigInt(bitsPerEntry);

  for (let i = 0; i < entryCount; i++) {
    const longIndex = Number(bitOffset / 64n);
    const bitInLong = bitOffset % 64n;

    const low = BigInt.asUintN(64, BigInt(longArray[longIndex] ?? 0n));

    let value;
    if (bitInLong + bitsPerEntryBig <= 64n) {
      value = (low >> bitInLong) & mask;
    } else {
      const high = BigInt.asUintN(64, BigInt(longArray[longIndex + 1] ?? 0n));
      const bitsFromLow = 64n - bitInLong;
      const lowPart = low >> bitInLong;
      const highPart = high << bitsFromLow;
      value = (lowPart | highPart) & mask;
    }

    indices[i] = Number(value);
    bitOffset += bitsPerEntryBig;
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
    case 90:
      return new Vec3(-z, y, x);
    case 180:
      return new Vec3(-x, y, -z);
    case 270:
      return new Vec3(z, y, -x);
    default:
      return new Vec3(x, y, z);
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

function finalizeBlocks(rawBlocks, rotation = 0) {
  if (rawBlocks.length === 0) return [];

  // 1. Initial normalization: anchor the lowest bounding box corner at (0, 0, 0)
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  for (const b of rawBlocks) {
    if (b.pos.x < minX) minX = b.pos.x;
    if (b.pos.y < minY) minY = b.pos.y;
    if (b.pos.z < minZ) minZ = b.pos.z;
  }

  // 2. Apply spatial rotation around the anchor origin (0, 0)
  // Matches PreviewManager.transformPlan rotation formulas:
  // 0°: (x, y, z) | 90°: (-z, y, x) | 180°: (-x, y, -z) | 270°: (z, y, -x)
  const finalBlocks = [];
  for (const b of rawBlocks) {
    const normalized = new Vec3(b.pos.x - minX, b.pos.y - minY, b.pos.z - minZ);
    const rotatedOffset = rotateOffset(normalized, rotation);
    const rotatedProps = rotateProperties(b.properties, rotation);
    finalBlocks.push({
      pos: rotatedOffset,
      name: b.name,
      properties: rotatedProps ?? {},
      blockState: formatBlockState(b.name, rotatedProps),
    });
  }

const DEPENDENT_BLOCK_NAMES = new Set([
  'torch', 'wall_torch', 'soul_torch', 'soul_wall_torch', 'redstone_torch', 'redstone_wall_torch',
  'lantern', 'soul_lantern', 'lever', 'stone_button', 'oak_button', 'spruce_button', 'button',
  'redstone_wire', 'repeater', 'comparator', 'ladder', 'vine', 'glow_lichen',
  'spruce_trapdoor', 'oak_trapdoor', 'iron_trapdoor', 'dark_oak_trapdoor', 'birch_trapdoor',
  'jungle_trapdoor', 'acacia_trapdoor', 'mangrove_trapdoor', 'cherry_trapdoor', 'bamboo_trapdoor',
  'crimson_trapdoor', 'warped_trapdoor', 'carpet', 'gray_carpet', 'black_carpet', 'white_carpet'
]);

  // 3. CRITICAL: Sort strictly bottom-to-top (ascending Y), solid blocks before attachables
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

  return finalBlocks;
}

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

          // Compute absolute relative coordinates inside the region
          const rx = size.x < 0 ? position.x - x : position.x + x;
          const ry = size.y < 0 ? position.y - y : position.y + y;
          const rz = size.z < 0 ? position.z - z : position.z + z;

          rawBlocks.push({
            pos: new Vec3(rx, ry, rz),
            name: entry.Name,
            properties: entry.Properties ?? {},
          });
        }
      }
    }
  }

  return finalizeBlocks(rawBlocks, rotation);
}

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

// Legacy MCEdit .schematic format parser
function parseLegacySchematicBlocks(simplifiedNbt, rotation = 0) {
  const width = simplifiedNbt.Width;
  const height = simplifiedNbt.Height;
  const length = simplifiedNbt.Length;
  const blocks = simplifiedNbt.Blocks;
  if (!blocks || !width || !height || !length) return [];

  let mcData;
  try { mcData = require('minecraft-data')('1.12.2'); } catch (_) {}

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
        rawBlocks.push({
          pos: new Vec3(x, y, z),
          name: blockName,
          properties: {},
        });
      }
    }
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
  finalizeBlocks,
};

