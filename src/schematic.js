'use strict';

const fs = require('fs');
const path = require('path');

let Vec3;
try {
  Vec3 = require('vec3').Vec3 || require('vec3');
} catch (e) {
  Vec3 = function (x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.plus = function (o) {
      return new Vec3(this.x + o.x, this.y + o.y, this.z + o.z);
    };
    this.offset = function (dx, dy, dz) {
      return new Vec3(this.x + dx, this.y + dy, this.z + dz);
    };
  };
}

let nbt;
try {
  nbt = require('prismarine-nbt');
} catch (e) {}

/**
 * Loads and parses .litematic and .nbt structure files into an array of Vec3 block offsets.
 */
async function loadSchematic(filename) {
  if (!nbt) {
    nbt = require('prismarine-nbt');
  }

  const schematicsDir = path.join(__dirname, '..', 'schematics');
  if (!fs.existsSync(schematicsDir)) {
    fs.mkdirSync(schematicsDir, { recursive: true });
  }

  let filePath = path.join(schematicsDir, filename);
  if (!fs.existsSync(filePath)) {
    // Try fuzzy match
    const files = fs.readdirSync(schematicsDir);
    const cleanQuery = filename.toLowerCase().replace(/[\s._-]+/g, '');
    const match = files.find(f => {
      const cleanF = f.toLowerCase().replace(/[\s._-]+/g, '');
      return cleanF.includes(cleanQuery) || cleanQuery.includes(cleanF);
    });
    if (match) {
      filePath = path.join(schematicsDir, match);
    } else {
      throw new Error(`Schematic "${filename}" not found in bot schematics folder.`);
    }
  }

  const buffer = fs.readFileSync(filePath);
  const { parsed } = await nbt.parse(buffer);
  const data = nbt.simplify(parsed);

  const offsets = [];

  // 1. Handle Litematica format (.litematic)
  if (data.Regions) {
    for (const regionName of Object.keys(data.Regions)) {
      const region = data.Regions[regionName];
      const pos = region.Position || { x: 0, y: 0, z: 0 };
      const rawSize = region.Size || { x: 0, y: 0, z: 0 };
      const sizeX = Math.abs(rawSize.x || 1);
      const sizeY = Math.abs(rawSize.y || 1);
      const sizeZ = Math.abs(rawSize.z || 1);

      const palette = region.BlockStatePalette || [];
      const blockStates = region.BlockStates || [];

      const bitsPerEntry = Math.max(2, Math.max(1, 32 - Math.clz32((palette.length - 1) || 1)));
      const maxEntryValue = (1n << BigInt(bitsPerEntry)) - 1n;

      // Convert blockStates array to BigInts if needed
      const longArray = blockStates.map(v => BigInt(v));

      const totalVolume = sizeX * sizeY * sizeZ;
      for (let index = 0; index < totalVolume; index++) {
        const y = Math.floor(index / (sizeX * sizeZ));
        const rem = index % (sizeX * sizeZ);
        const z = Math.floor(rem / sizeX);
        const x = rem % sizeX;

        let paletteIndex = 0;
        if (longArray.length > 0) {
          const startBit = BigInt(index * bitsPerEntry);
          const startLongIndex = Number(startBit / 64n);
          const startBitOffset = startBit % 64n;

          if (startLongIndex < longArray.length) {
            let val = (longArray[startLongIndex] >> startBitOffset) & 0xFFFFFFFFFFFFFFFFn;
            const bitsRemaining = 64n - startBitOffset;
            if (bitsRemaining < BigInt(bitsPerEntry) && startLongIndex + 1 < longArray.length) {
              val |= (longArray[startLongIndex + 1] << bitsRemaining);
            }
            paletteIndex = Number(val & maxEntryValue);
          }
        }

        if (paletteIndex < palette.length) {
          const block = palette[paletteIndex];
          const blockName = (typeof block === 'string' ? block : block?.Name || '').replace('minecraft:', '');
          if (blockName && !blockName.includes('air')) {
            offsets.push(new Vec3(pos.x + x, pos.y + y, pos.z + z));
          }
        }
      }
    }
  }
  // 2. Handle Vanilla Structure NBT format (.nbt)
  else if (data.blocks && data.palette) {
    for (const b of data.blocks) {
      const state = data.palette[b.state];
      const blockName = (typeof state === 'string' ? state : state?.Name || '').replace('minecraft:', '');
      if (blockName && !blockName.includes('air') && b.pos) {
        offsets.push(new Vec3(b.pos[0], b.pos[1], b.pos[2]));
      }
    }
  }

  // Sort offsets so bottom layers (lowest Y) build first
  offsets.sort((a, b) => (a.y - b.y) || (a.x - b.x) || (a.z - b.z));
  return offsets;
}

module.exports = { loadSchematic };
