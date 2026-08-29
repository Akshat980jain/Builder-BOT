'use strict';

const { Vec3 } = require('vec3');

/**
 * Reads a LongArray of bit-packed palette indices, litematica's exact format.
 * Verified against a self-constructed round-trip test (encode with the same
 * bit layout, decode with this function, assert equality) — see this repo's
 * test notes. Litematica packs entries across the 64-bit long boundary
 * (an entry CAN span two longs), unlike some other formats that pad to
 * avoid straddling — get this wrong and every block past the first few
 * hundred silently reads as garbage.
 *
 * @param {BigInt64Array|bigint[]} longArray
 * @param {number} bitsPerEntry
 * @param {number} entryCount
 * @returns {number[]} palette indices, length === entryCount
 */
function unpackBitArray(longArray, bitsPerEntry, entryCount) {
  const indices = new Array(entryCount);
  const mask = (1n << BigInt(bitsPerEntry)) - 1n;
  let bitOffset = 0n;
  const bitsPerEntryBig = BigInt(bitsPerEntry);

  for (let i = 0; i < entryCount; i++) {
    const longIndex = Number(bitOffset / 64n);
    const bitInLong = bitOffset % 64n;

    // toBigInt64 values from prismarine-nbt / node Buffer reads may be signed;
    // normalize to unsigned 64-bit for correct bit math.
    const low = BigInt.asUintN(64, BigInt(longArray[longIndex] ?? 0n));

    let value;
    if (bitInLong + bitsPerEntryBig <= 64n) {
      value = (low >> bitInLong) & mask;
    } else {
      // entry straddles into the next long
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

/** Inverse of unpackBitArray, used only by this file's own self-test. */
function packBitArray(indices, bitsPerEntry) {
  const totalBits = BigInt(indices.length) * BigInt(bitsPerEntry);
  const longCount = Number((totalBits + 63n) / 64n);
  const longs = new Array(longCount).fill(0n);
  let bitOffset = 0n;
  const bitsPerEntryBig = BigInt(bitsPerEntry);

  for (const idx of indices) {
    const value = BigInt(idx);
    const longIndex = Number(bitOffset / 64n);
    const bitInLong = bitOffset % 64n;

    longs[longIndex] |= BigInt.asUintN(64, value << bitInLong);
    if (bitInLong + bitsPerEntryBig > 64n) {
      const bitsWritten = 64n - bitInLong;
      longs[longIndex + 1] |= BigInt.asUintN(64, value >> bitsWritten);
    }
    bitOffset += bitsPerEntryBig;
  }

  return longs.map((v) => BigInt.asIntN(64, v)); // back to signed, matching NBT long semantics
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
const AXIS_SWAP = { x: 'z', z: 'x' }; // y axis unaffected by a horizontal rotation

/**
 * Best-effort rotation of block-state properties for a 90-degree-step
 * horizontal rotation. Covers the common directional properties
 * (`facing`, `axis`, numeric `rotation` for signs/banners/skulls).
 * Properties this doesn't recognize are passed through unchanged — this
 * is deliberately conservative rather than guessing at properties it
 * doesn't have a verified rule for.
 */
function rotateProperties(properties, rotation) {
  const steps = (((rotation % 360) + 360) % 360) / 90; // 0..3
  if (steps === 0 || !properties) return properties;

  const result = { ...properties };

  if (typeof result.facing === 'string') {
    let f = result.facing;
    for (let i = 0; i < steps; i++) {
      f = FACING_CYCLE_CW[f] ?? f; // up/down (vertical facing) intentionally unaffected
    }
    result.facing = f;
  }

  if (typeof result.axis === 'string' && result.axis !== 'y') {
    // a 90/270-degree turn swaps x<->z; a 180-degree turn (2 steps) is a no-op for axis
    if (steps % 2 === 1) {
      result.axis = AXIS_SWAP[result.axis] ?? result.axis;
    }
  }

  if (typeof result.rotation === 'string' && /^\d+$/.test(result.rotation)) {
    // signs/banners: 16 discrete rotation states, 90 degrees = 4 steps of 16
    const current = parseInt(result.rotation, 10);
    result.rotation = String((current + steps * 4) % 16);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Litematic parsing
// ---------------------------------------------------------------------------

/**
 * Parses a decompressed litematica NBT root (already run through
 * prismarine-nbt's parse + simplify) into an array of
 * { pos: Vec3, name: string, properties: object } offsets relative to the
 * schematic's own (0,0,0), across ALL regions (litematica files can contain
 * more than one region).
 *
 * NOTE ON MAPPINGS: this targets the layout used by Litematica's file
 * format as of writing (Regions/BlockStatePalette/BlockStates/Size/Position
 * keys). This format has been stable for years and isn't tied to a specific
 * Minecraft version, so it should not need updating per-Minecraft-version
 * the way the Fabric mod code elsewhere in this project does.
 */
function parseLitematicBlocks(simplifiedNbt, rotation = 0) {
  const blocks = [];
  const regions = simplifiedNbt.Regions ?? {};

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
    const longArray = region.BlockStates; // BigInt64Array-like from prismarine-nbt

    const indices = unpackBitArray(longArray, bitsPerEntry, volume);

    let i = 0;
    for (let y = 0; y < sizeY; y++) {
      for (let z = 0; z < sizeZ; z++) {
        for (let x = 0; x < sizeX; x++) {
          const paletteIndex = indices[i++];
          const entry = palette[paletteIndex];
          if (!entry || entry.Name === 'minecraft:air') continue;

          const localOffset = new Vec3(
            x + (size.x < 0 ? position.x - sizeX + 1 : position.x),
            y + (size.y < 0 ? position.y - sizeY + 1 : position.y),
            z + (size.z < 0 ? position.z - sizeZ + 1 : position.z)
          );

          const rotatedOffset = rotateOffset(localOffset, rotation);
          const rotatedProps = rotateProperties(entry.Properties, rotation);

          blocks.push({
            pos: rotatedOffset,
            name: entry.Name,
            properties: rotatedProps ?? {},
          });
        }
      }
    }
  }

  return blocks;
}

/**
 * Parses a vanilla Structure Block .nbt file (already run through
 * prismarine-nbt's parse + simplify) into the same block-list shape.
 * Structure files store `blocks: [{ pos: [x,y,z], state: paletteIndex }]`
 * and `palette: [{ Name, Properties }]` directly — no bit-packing involved.
 */
function parseStructureNbtBlocks(simplifiedNbt, rotation = 0) {
  const palette = simplifiedNbt.palette ?? [];
  const blockList = simplifiedNbt.blocks ?? [];
  const blocks = [];

  for (const b of blockList) {
    const entry = palette[b.state];
    if (!entry || entry.Name === 'minecraft:air') continue;

    const [x, y, z] = b.pos;
    const rotatedOffset = rotateOffset(new Vec3(x, y, z), rotation);
    const rotatedProps = rotateProperties(entry.Properties, rotation);

    blocks.push({ pos: rotatedOffset, name: entry.Name, properties: rotatedProps ?? {} });
  }

  return blocks;
}

module.exports = {
  unpackBitArray,
  packBitArray, // exported for the self-test only
  bitsNeededForPalette,
  rotateOffset,
  rotateProperties,
  parseLitematicBlocks,
  parseStructureNbtBlocks,
};
