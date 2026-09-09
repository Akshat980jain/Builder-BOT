# 🏗️ Minecraft Builder Bot & Mission Control Suite

An autonomous, production-ready Minecraft Builder Bot suite combining a **Node.js / Mineflayer Autonomous Bot Engine**, an interactive **Web Mission Control Dashboard**, and an in-game **Fabric Client GUI with 3D Ghost Hologram Preview**.

Designed for multiplayer servers (Aternos, PaperMC, Spigot, Fabric, VPS, LAN).

---

## ✨ Core Features

- 🖥️ **Interactive Web Mission Control UI (`http://localhost:5000`)**:
  - Set exact target **Origin Coordinates (X, Y, Z)** with 1-click **"📌 Use Current Bot Position"** binding.
  - Choose schematic from local library or **Drag & Drop** to upload new files (`.litematic`, `.nbt`, `.schem`, `.schematic`).
  - Procedural Structure Generator: build Walls, Floors/Platforms, Solid Boxes, Hollow Cubes, Pyramids, and Domes on the fly.
  - Rotation Selector: 0°, 90°, 180°, 270°.
  - Real-time build progress gauge, blocks/second rate, and live log console with command input.
- 🎮 **In-Game Client GUI & 3D Ghost Hologram Preview**:
  - Open instantly by **right-clicking or punching** a BuilderBot in the Minecraft world, or by running `/builderbot menu`.
  - **3D Ghost Preview**: Projects the schematic as a holographic client-side structure in the world at the exact assigned coordinates and rotation, allowing you to walk through rooms and inspect before placing.
  - **Coordinate Persistence**: Keeps coordinates stored across screen tabs and re-inits without resetting to player position.
  - Real-time in-game HUD card displaying placed blocks, percentage, and ETA.
- 🧱 **Ultra-Reliable Block Placement**:
  - Bottom-to-top layer-by-layer build planning (Y ascending).
  - Two-phase placement: solid structural support blocks are placed first, and attachable blocks (torches, ladders, lanterns, doors, redstone, trapdoors, carpets, banners) are placed in a second pass once supporting blocks exist.
  - Native `bot.placeBlock()` with exact inventory and creative slot provisioning.
  - **OP `/setblock <x> <y> <z> <state> replace` Fallback**: Guarantees 100% build fidelity for modded blocks (e.g. Create Mod cogwheels, shafts, basins) and complex blockstates. **Never substitutes wrong blocks** (no random dirt or cobblestone).
- 🤖 **Multi-Bot Swarm Fleet (1 to 10 Bots)**:
  - Scale workforce up to 10 bots (`Builder_Bot_2` ... `Builder_Bot_10`) for 10x faster parallel construction.
  - Build plan is automatically partitioned across connected swarm bots.
  - 24/7 Supervisor watchdog with auto-reconnect and auto-authentication (`/login <password>`).
- ↩️ **Undo Engine & Area Excavation**:
  - Revert and clear the last placed build with 1-click or `!undo`.
  - Clear out ground obstacles and trees before building with `!cleararea <radius> [height]`.
- 🛡️ **Safety & Keep-Alive**:
  - Auto-Eat (maintains food level >= 14).
  - Creative flight maintenance to prevent falling during elevated builds.
  - Lava and hazard defense.

---

## 🎮 How to Control the Bot

### 1. Through the Browser Dashboard (Recommended):
Open **`http://localhost:5000`** in your browser:
* Click **"🚀 Build Studio"**
* Set Origin Coordinates (or click **"📌 Use Current Bot Position"**)
* Select Schematic or Procedural Geometry
* Select Rotation (0°, 90°, 180°, 270°) and Workforce Count (1 to 10 bots)
* Click **"🚀 Launch Build Mission"**

### 2. Through the In-Game Client GUI:
* Walk up to the BuilderBot in Minecraft and **Right-Click** or **Punch** it (or type `/builderbot menu`).
* Select a schematic from the list and enter your target coordinates.
* Click **"🔮 Preview 3D Ghost Blocks"** to inspect the hologram in the world.
* Click **"🔨 Build Selected Schematic"** to start!

### 3. In-Game Chat Commands:
| Command | Description | Example |
| :--- | :--- | :--- |
| `!schematic <name\|index> [x y z] [rot]` | Launch schematic build at coordinates | `!schematic andesitefarm 100 64 200 90` |
| `!schematic swarm <count> <name> [x y z] [rot]` | Launch build across multi-bot swarm | `!schematic swarm 5 andesitefarm 100 64 200` |
| `!schematics` or `!list` | List all available schematics in `schematics/` | `!schematics` |
| `!cleararea <radius> [height]` | Clear out terrain before building | `!cleararea 10 12` |
| `!stop` or `!stopall` | Abort all building tasks and stop bots | `!stop` |
| `!pause` / `!resume` | Pause and resume active build | `!pause` |
| `!undo` | Revert and remove all blocks from last build | `!undo` |
| `!swarm <count>` | Set swarm fleet size (1 to 10) | `!swarm 5` |
| `!coords` / `!pos` | Print bot's current coordinates | `!coords` |
| `!come` / `!follow` | Teleport bot to commanding player | `!come` |
| `!fly` | Enable creative flight | `!fly` |
| `!status` | Print build progress and bot health | `!status` |

---

## 🚀 How to Run

```bash
cd "e:\Minecraft Bots\Minecraft Builder bot"
npm install
npm start
```

Dashboard will start immediately at **`http://localhost:5000`**, and the bot will connect to the server configured in `settings.json`.
