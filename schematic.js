"use strict";

const { Vec3 } = require("vec3");
const nbt = require("prismarine-nbt");
const fs = require("fs");
const path = require("path");
const { addLog } = require("./logger");

let _mcDataCache = null;
function getMcData(version = "1.21.4") {
  if (!_mcDataCache) {
    try {
      _mcDataCache = require("minecraft-data")(version);
    } catch (_) {}
  }
  return _mcDataCache;
}

// ---------------------------------------------------------------------------
// Dependent / Attachable Block Definitions
// ---------------------------------------------------------------------------
const DEPENDENT_BLOCKS = new Set([
  "torch", "wall_torch", "soul_torch", "soul_wall_torch", "redstone_torch", "redstone_wall_torch",
  "lantern", "soul_lantern", "lever", "stone_button", "oak_button", "spruce_button", "button",
  "redstone_wire", "repeater", "comparator", "ladder", "vine", "glow_lichen",
  "spruce_trapdoor", "oak_trapdoor", "iron_trapdoor", "dark_oak_trapdoor", "birch_trapdoor",
  "jungle_trapdoor", "acacia_trapdoor", "mangrove_trapdoor", "cherry_trapdoor", "bamboo_trapdoor",
  "crimson_trapdoor", "warped_trapdoor", "carpet", "gray_carpet", "black_carpet", "white_carpet",
  "tripwire", "tripwire_hook", "rail", "powered_rail", "detector_rail", "activator_rail"
]);

const REPLACEABLE_BLOCKS = new Set([
  "short_grass", "grass", "tall_grass", "fern", "large_fern",
  "dead_bush", "dandelion", "poppy", "blue_orchid", "allium",
  "azure_bluet", "red_tulip", "orange_tulip", "white_tulip",
  "pink_tulip", "oxeye_daisy", "cornflower", "lily_of_the_valley",
  "wither_rose", "sunflower", "lilac", "rose_bush", "peony",
  "snow", "vine", "glow_lichen", "seagrass", "tall_seagrass"
]);

// ---------------------------------------------------------------------------
// Bit-Array Unpacking for Litematica Format
// ---------------------------------------------------------------------------
function unpackBitArray(longArray, bitsPerEntry, entryCount) {
  const indices = new Int32Array(entryCount);
  const mask = (1 << bitsPerEntry) - 1;

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
      if (bitInLong < 32) {
        if (bitInLong + bitsPerEntry <= 32) {
          value = (lo[longIdx] >>> bitInLong) & mask;
        } else {
          const fromLo = (lo[longIdx] >>> bitInLong) & ((1 << (32 - bitInLong)) - 1);
          const fromHi = hi[longIdx] & ((1 << (bitsPerEntry - (32 - bitInLong))) - 1);
          value = fromLo | (fromHi << (32 - bitInLong));
        }
      } else {
        const bit = bitInLong - 32;
        value = (hi[longIdx] >>> bit) & mask;
      }
    } else {
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
// Rotation Transformations
// ---------------------------------------------------------------------------
function rotateOffset(offset, rotationDeg) {
  const norm = ((rotationDeg % 360) + 360) % 360;
  switch (norm) {
    case 90:  return new Vec3(-offset.z, offset.y, offset.x);
    case 180: return new Vec3(-offset.x, offset.y, -offset.z);
    case 270: return new Vec3(offset.z, offset.y, -offset.x);
    default:  return new Vec3(offset.x, offset.y, offset.z);
  }
}

const FACING_CW = { north: "east", east: "south", south: "west", west: "north" };
const AXIS_SWAP = { x: "z", z: "x" };

function rotateProperties(properties, rotationDeg) {
  const steps = (((rotationDeg % 360) + 360) % 360) / 90;
  if (steps === 0 || !properties) return properties;

  const res = { ...properties };
  if (typeof res.facing === "string") {
    let f = res.facing;
    for (let i = 0; i < steps; i++) {
      f = FACING_CW[f] ?? f;
    }
    res.facing = f;
  }

  if (typeof res.axis === "string" && res.axis !== "y") {
    if (steps % 2 === 1) {
      res.axis = AXIS_SWAP[res.axis] ?? res.axis;
    }
  }

  if (typeof res.rotation === "string" && /^\d+$/.test(res.rotation)) {
    const cur = parseInt(res.rotation, 10);
    res.rotation = String((cur + steps * 4) % 16);
  }

  return res;
}

function formatBlockState(name, properties) {
  if (!properties || Object.keys(properties).length === 0) return name;
  const props = Object.entries(properties)
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
  return `${name}[${props}]`;
}

// ---------------------------------------------------------------------------
// Anchoring & Sorting: Anchors min corner to (0, 0, 0) and sorts Y-ascending
// ---------------------------------------------------------------------------
function finalizeBlocks(rawBlocks, rotationDeg = 0) {
  if (!rawBlocks || rawBlocks.length === 0) return [];

  // Step 1: Anchor min bounding-box corner to (0, 0, 0)
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  for (const b of rawBlocks) {
    if (b.pos.x < minX) minX = b.pos.x;
    if (b.pos.y < minY) minY = b.pos.y;
    if (b.pos.z < minZ) minZ = b.pos.z;
  }

  const anchored = rawBlocks.map((b) => {
    const relPos = new Vec3(b.pos.x - minX, b.pos.y - minY, b.pos.z - minZ);
    const rotPos = rotateOffset(relPos, rotationDeg);
    const rotProps = rotateProperties(b.properties, rotationDeg);
    return {
      pos: rotPos,
      name: b.name.startsWith("minecraft:") || b.name.includes(":") ? b.name : "minecraft:" + b.name,
      properties: rotProps,
      blockState: formatBlockState(b.name, rotProps)
    };
  });

  // Re-normalize min bounds after rotation so origin is always (0, 0, 0)
  let rotMinX = Infinity, rotMinY = Infinity, rotMinZ = Infinity;
  for (const b of anchored) {
    if (b.pos.x < rotMinX) rotMinX = b.pos.x;
    if (b.pos.y < rotMinY) rotMinY = b.pos.y;
    if (b.pos.z < rotMinZ) rotMinZ = b.pos.z;
  }

  const finalBlocks = anchored.map((b) => ({
    pos: new Vec3(b.pos.x - rotMinX, b.pos.y - rotMinY, b.pos.z - rotMinZ),
    name: b.name,
    properties: b.properties,
    blockState: b.blockState
  }));

  // Sort strictly bottom-to-top (Y ascending)
  // Within same Y: solid structural blocks first, dependent/attached blocks second
  finalBlocks.sort((a, b) => {
    if (a.pos.y !== b.pos.y) return a.pos.y - b.pos.y;
    const aClean = a.name.replace(/^minecraft:/, "").toLowerCase();
    const bClean = b.name.replace(/^minecraft:/, "").toLowerCase();
    const aDep = DEPENDENT_BLOCKS.has(aClean) ? 1 : 0;
    const bDep = DEPENDENT_BLOCKS.has(bClean) ? 1 : 0;
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
// Parsers
// ---------------------------------------------------------------------------

function parseLitematicBlocks(simplifiedNbt, rotationDeg = 0) {
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
          if (!entry || entry.Name === "minecraft:air" || entry.Name === "air") continue;

          rawBlocks.push({
            pos: new Vec3(minX + x, minY + y, minZ + z),
            name: entry.Name,
            properties: entry.Properties ?? {}
          });
        }
      }
    }
  }

  return finalizeBlocks(rawBlocks, rotationDeg);
}

function parseStructureNbtBlocks(simplifiedNbt, rotationDeg = 0) {
  const palette = simplifiedNbt.palette ?? [];
  const blockList = simplifiedNbt.blocks ?? [];
  const rawBlocks = [];

  for (const b of blockList) {
    const entry = palette[b.state];
    if (!entry || entry.Name === "minecraft:air" || entry.Name === "air") continue;

    const [x, y, z] = b.pos;
    rawBlocks.push({
      pos: new Vec3(x, y, z),
      name: entry.Name,
      properties: entry.Properties ?? {}
    });
  }

  return finalizeBlocks(rawBlocks, rotationDeg);
}

function parseLegacySchematicBlocks(simplifiedNbt, rotationDeg = 0) {
  const width = simplifiedNbt.Width;
  const height = simplifiedNbt.Height;
  const length = simplifiedNbt.Length;
  const blocks = simplifiedNbt.Blocks;
  if (!blocks || !width || !height || !length) return [];

  const mcData = getMcData("1.12.2");
  const rawBlocks = [];

  for (let y = 0; y < height; y++) {
    for (let z = 0; z < length; z++) {
      for (let x = 0; x < width; x++) {
        const index = (y * length + z) * width + x;
        const id = blocks[index] & 0xff;
        if (id === 0) continue; // Air

        let blockName = "minecraft:stone";
        if (mcData && mcData.blocks[id]) {
          blockName = "minecraft:" + mcData.blocks[id].name;
        }
        rawBlocks.push({ pos: new Vec3(x, y, z), name: blockName, properties: {} });
      }
    }
  }

  return finalizeBlocks(rawBlocks, rotationDeg);
}

function parseSpongeSchematicBlocks(simplifiedNbt, rotationDeg = 0) {
  const width = simplifiedNbt.Width;
  const height = simplifiedNbt.Height;
  const length = simplifiedNbt.Length;
  const palette = simplifiedNbt.Palette;
  const blockData = simplifiedNbt.BlockData;

  if (!palette || !blockData || !width || !height || !length) return [];

  const reversePalette = {};
  for (const [name, idx] of Object.entries(palette)) {
    reversePalette[idx] = name;
  }

  const rawBlocks = [];
  let byteIdx = 0;
  let blockIdx = 0;

  while (byteIdx < blockData.length) {
    let value = 0;
    let shift = 0;
    let b;
    do {
      b = blockData[byteIdx++] & 0xff;
      value |= (b & 0x7f) << shift;
      shift += 7;
    } while (b & 0x80);

    const name = reversePalette[value];
    if (name && name !== "minecraft:air" && name !== "air") {
      const y = Math.floor(blockIdx / (width * length));
      const rem = blockIdx % (width * length);
      const z = Math.floor(rem / width);
      const x = rem % width;
      rawBlocks.push({ pos: new Vec3(x, y, z), name, properties: {} });
    }
    blockIdx++;
  }

  return finalizeBlocks(rawBlocks, rotationDeg);
}

// ---------------------------------------------------------------------------
// Universal File Loader
// ---------------------------------------------------------------------------
async function loadSchematicFile(filePath, rotationDeg = 0) {
  const ext = path.extname(filePath).toLowerCase();
  const buffer = fs.readFileSync(filePath);

  const parsed = await nbt.parse(buffer);
  const simplified = nbt.simplify(parsed.parsed);

  if (ext === ".litematic") {
    return parseLitematicBlocks(simplified, rotationDeg);
  } else if (ext === ".nbt") {
    return parseStructureNbtBlocks(simplified, rotationDeg);
  } else if (ext === ".schem") {
    return parseSpongeSchematicBlocks(simplified, rotationDeg);
  } else if (ext === ".schematic") {
    if (simplified.Palette) {
      return parseSpongeSchematicBlocks(simplified, rotationDeg);
    }
    return parseLegacySchematicBlocks(simplified, rotationDeg);
  }

  throw new Error(`Unsupported schematic file format: ${ext}`);
}

// ---------------------------------------------------------------------------
// Procedural Shape Generator
// ---------------------------------------------------------------------------
function generateProceduralShape(type, options = {}, rotationDeg = 0) {
  const rawBlocks = [];
  const blockName = options.blockName || "minecraft:cobblestone";

  switch (type.toLowerCase()) {
    case "floor":
    case "platform": {
      const width = Math.max(1, parseInt(options.width, 10) || 5);
      const length = Math.max(1, parseInt(options.length, 10) || 5);
      for (let x = 0; x < width; x++) {
        for (let z = 0; z < length; z++) {
          rawBlocks.push({ pos: new Vec3(x, 0, z), name: blockName, properties: {} });
        }
      }
      break;
    }

    case "wall": {
      const width = Math.max(1, parseInt(options.width, 10) || 5);
      const height = Math.max(1, parseInt(options.height, 10) || 3);
      for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
          rawBlocks.push({ pos: new Vec3(x, y, 0), name: blockName, properties: {} });
        }
      }
      break;
    }

    case "box":
    case "cube": {
      const width = Math.max(1, parseInt(options.width, 10) || 4);
      const height = Math.max(1, parseInt(options.height, 10) || 4);
      const length = Math.max(1, parseInt(options.length, 10) || 4);
      const hollow = options.hollow === true || options.hollow === "true";

      for (let y = 0; y < height; y++) {
        for (let z = 0; z < length; z++) {
          for (let x = 0; x < width; x++) {
            const isBorder = (x === 0 || x === width - 1 || y === 0 || y === height - 1 || z === 0 || z === length - 1);
            if (!hollow || isBorder) {
              rawBlocks.push({ pos: new Vec3(x, y, z), name: blockName, properties: {} });
            }
          }
        }
      }
      break;
    }

    case "pyramid": {
      const size = Math.max(1, parseInt(options.size || options.width, 10) || 7);
      const hollow = options.hollow === true || options.hollow === "true";
      let currentSize = size;
      let y = 0;

      while (currentSize > 0) {
        const offset = Math.floor((size - currentSize) / 2);
        for (let x = 0; x < currentSize; x++) {
          for (let z = 0; z < currentSize; z++) {
            const isBorder = (x === 0 || x === currentSize - 1 || z === 0 || z === currentSize - 1);
            if (!hollow || isBorder) {
              rawBlocks.push({ pos: new Vec3(offset + x, y, offset + z), name: blockName, properties: {} });
            }
          }
        }
        currentSize -= 2;
        y++;
      }
      break;
    }

    case "dome":
    case "sphere": {
      const radius = Math.max(1, parseInt(options.radius, 10) || 4);
      const hollow = options.hollow !== false;
      const rSq = radius * radius;
      const innerSq = (radius - 1) * (radius - 1);

      for (let y = 0; y <= radius; y++) {
        for (let x = -radius; x <= radius; x++) {
          for (let z = -radius; z <= radius; z++) {
            const dSq = x * x + y * y + z * z;
            if (dSq <= rSq && (!hollow || dSq >= innerSq)) {
              rawBlocks.push({ pos: new Vec3(x + radius, y, z + radius), name: blockName, properties: {} });
            }
          }
        }
      }
      break;
    }

    default:
      throw new Error(`Unknown procedural shape: ${type}`);
  }

  return finalizeBlocks(rawBlocks, rotationDeg);
}

// ---------------------------------------------------------------------------
// Material Breakdown
// ---------------------------------------------------------------------------
function calculateMaterials(blocks) {
  const counts = {};
  let total = 0;
  for (const b of blocks) {
    const clean = b.name.replace(/^minecraft:/, "");
    counts[clean] = (counts[clean] || 0) + 1;
    total++;
  }
  return { counts, total };
}

module.exports = {
  unpackBitArray,
  bitsNeededForPalette,
  rotateOffset,
  rotateProperties,
  formatBlockState,
  finalizeBlocks,
  parseLitematicBlocks,
  parseStructureNbtBlocks,
  parseLegacySchematicBlocks,
  parseSpongeSchematicBlocks,
  loadSchematicFile,
  generateProceduralShape,
  calculateMaterials,
  DEPENDENT_BLOCKS,
  REPLACEABLE_BLOCKS
};
