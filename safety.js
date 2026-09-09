"use strict";

const { addLog } = require("./logger");

class SafetyManager {
  constructor(bot, config) {
    this.bot = bot;
    this.config = config || {};
    this.isPluggingLava = false;
  }

  /**
   * Initializes safety event listeners and monitors
   */
  init() {
    this.bot.on("health", () => {
      this.checkHealth();
    });

    if (this.config.safety?.flightProtection) {
      setInterval(() => {
        this.maintainCreativeFlight();
      }, 3000);
    }

    addLog("Safety systems activated (Health monitor, Creative flight guard, Lava defense)", "Safety");
  }

  /**
   * Monitors bot health and warns when critical
   */
  checkHealth() {
    if (this.bot.health <= (this.config.safety?.minHealth || 6)) {
      addLog(`[WARNING] Low health detected: ${this.bot.health}/20! Seeking safety...`, "Safety");
    }
  }

  /**
   * Ensures bot remains flying in creative mode to avoid fall or void damage
   */
  maintainCreativeFlight() {
    if (!this.bot || !this.bot.entity) return;
    if (this.bot.game?.gameMode === "creative" || this.bot.creative) {
      if (this.bot.creative && typeof this.bot.creative.startFlying === "function") {
        try {
          this.bot.creative.startFlying();
        } catch (_) {}
      }
    }
  }

  /**
   * Checks if an item is near broken in survival mode
   */
  isToolNearBroken(item) {
    if (!item) return false;
    if (item.maxDurability && item.durabilityUsed !== undefined) {
      const remaining = item.maxDurability - item.durabilityUsed;
      const percent = (remaining / item.maxDurability) * 100;
      return percent <= 5 || remaining <= 3;
    }
    return false;
  }

  /**
   * Checks if placing/standing at position is hazardous (lava/fire)
   */
  isHazardous(pos) {
    if (!this.config.safety?.lavaProtection || !pos) return false;
    const offsets = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: -1, z: 0 }
    ];

    for (const off of offsets) {
      const b = this.bot.blockAt(pos.offset(off.x, off.y, off.z));
      if (b && (b.name === "lava" || b.name === "flowing_lava" || b.name === "fire")) {
        return true;
      }
    }
    return false;
  }

  /**
   * Detects nearby flowing lava and attempts to seal it with solid blocks
   */
  async emergencyPlugLava() {
    if (this.isPluggingLava) return;
    this.isPluggingLava = true;

    try {
      const lavaBlock = this.bot.findBlock({
        matching: (b) => b && (b.name === "lava" || b.name === "flowing_lava"),
        maxDistance: 3
      });

      if (lavaBlock) {
        addLog(`[EMERGENCY] Lava adjacent at ${lavaBlock.position}! Sealing...`, "Safety");
        const solidBlock = this.bot.inventory.items().find(
          (i) => ["cobblestone", "cobbled_deepslate", "dirt", "stone", "netherrack"].includes(i.name)
        );

        if (solidBlock) {
          await this.bot.equip(solidBlock, "hand");
          await this.bot.placeBlock(lavaBlock, { x: 0, y: 1, z: 0 }).catch(() => {});
          addLog("Sealed lava hazard.", "Safety");
        }
      }
    } catch (_) {
    } finally {
      this.isPluggingLava = false;
    }
  }
}

module.exports = SafetyManager;
