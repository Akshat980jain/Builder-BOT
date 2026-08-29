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
// Litematic parsing with Coordinate Normalization
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

  if (rawBlocks.length === 0) return [];

  // Normalize so the lowest coordinate starts at (0, 0, 0)
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  for (const b of rawBlocks) {
    if (b.pos.x < minX) minX = b.pos.x;
    if (b.pos.y < minY) minY = b.pos.y;
    if (b.pos.z < minZ) minZ = b.pos.z;
  }

  const blocks = [];
  for (const b of rawBlocks) {
    const normalized = new Vec3(b.pos.x - minX, b.pos.y - minY, b.pos.z - minZ);
    const rotatedOffset = rotateOffset(normalized, rotation);
    const rotatedProps = rotateProperties(b.properties, rotation);

    blocks.push({
      pos: rotatedOffset,
      name: b.name,
      properties: rotatedProps ?? {},
    });
  }

  return blocks;
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

  if (rawBlocks.length === 0) return [];

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  for (const b of rawBlocks) {
    if (b.pos.x < minX) minX = b.pos.x;
    if (b.pos.y < minY) minY = b.pos.y;
    if (b.pos.z < minZ) minZ = b.pos.z;
  }

  const blocks = [];
  for (const b of rawBlocks) {
    const normalized = new Vec3(b.pos.x - minX, b.pos.y - minY, b.pos.z - minZ);
    const rotatedOffset = rotateOffset(normalized, rotation);
    const rotatedProps = rotateProperties(b.properties, rotation);
    blocks.push({ pos: rotatedOffset, name: b.name, properties: rotatedProps ?? {} });
  }

  return blocks;
}

module.exports = {
  unpackBitArray,
  bitsNeededForPalette,
  rotateOffset,
  rotateProperties,
  parseLitematicBlocks,
  parseStructureNbtBlocks,
};
