'use strict';

const { Vec3 } = require('vec3');

/**
 * Returns an array of Vec3 block offsets to form a hollow pyramid.
 * `baseSize` is the width of the bottom layer (odd numbers work best).
 */
function pyramid(baseSize = 5) {
  const offsets = [];
  const half = Math.floor(baseSize / 2);
  let layer = 0;

  for (let s = baseSize; s >= 1; s -= 2) {
    const h = Math.floor(s / 2);
    for (let x = -h; x <= h; x++) {
      for (let z = -h; z <= h; z++) {
        // Hollow: only place on the outer perimeter of this layer (unless 1x1 top)
        if (s === 1 || Math.abs(x) === h || Math.abs(z) === h) {
          offsets.push(new Vec3(x, layer, z));
        }
      }
    }
    layer++;
  }
  return offsets;
}

/**
 * Returns an array of Vec3 block offsets to form a circular tower.
 * `radius` in blocks, `height` in blocks.
 */
function tower(radius = 2, height = 10) {
  const offsets = [];
  const rSquared = radius * radius;
  const innerRSquared = Math.max(0, (radius - 1) * (radius - 1));

  for (let y = 0; y < height; y++) {
    for (let x = -radius; x <= radius; x++) {
      for (let z = -radius; z <= radius; z++) {
        const d = x * x + z * z;
        // Hollow cylinder
        if (d <= rSquared && d >= innerRSquared) {
          offsets.push(new Vec3(x, y, z));
        }
      }
    }
  }
  return offsets;
}

/**
 * Returns an array of Vec3 block offsets to form a hollow hemisphere (dome).
 * `radius` in blocks.
 */
function dome(radius = 6) {
  const offsets = [];
  const rSquared = radius * radius;
  const innerRSquared = Math.max(0, (radius - 1) * (radius - 1));

  for (let y = 0; y <= radius; y++) {
    for (let x = -radius; x <= radius; x++) {
      for (let z = -radius; z <= radius; z++) {
        const d = x * x + y * y + z * z;
        if (d <= rSquared && d >= innerRSquared) {
          offsets.push(new Vec3(x, y, z));
        }
      }
    }
  }
  return offsets;
}

module.exports = { pyramid, tower, dome };
