const { Vec3 } = require('vec3');

class Builder {
    constructor(bot) {
        this.bot = bot;
        this.isBuilding = false;
        this.buildQueue = [];
        this.placedBlocks = [];
        this.totalBlocks = 0;
        this.currentProject = null;
    }

    /**
     * Generates an Egyptian Pyramid
     */
    createPyramid(origin, size) {
        const tasks = [];
        let currentSize = size;
        let currentY = 0;

        while (currentSize > 0) {
            const offset = Math.floor((size - currentSize) / 2);
            for (let x = 0; x < currentSize; x++) {
                for (let z = 0; z < currentSize; z++) {
                    const isBorder = (x === 0 || x === currentSize - 1 || z === 0 || z === currentSize - 1);
                    if (isBorder || currentSize <= 2) {
                        tasks.push(new Vec3(origin.x + offset + x, origin.y + currentY, origin.z + offset + z));
                    }
                }
            }
            currentSize -= 2;
            currentY++;
        }

        // Sort bottom to top
        return tasks.sort((a, b) => a.y - b.y);
    }

    /**
     * Generates a Geodesic Dome (Half-Sphere)
     */
    createDome(origin, radius) {
        const tasks = [];
        const radiusSq = radius * radius;
        const innerRadiusSq = (radius - 1) * (radius - 1);

        for (let y = 0; y <= radius; y++) {
            for (let x = -radius; x <= radius; x++) {
                for (let z = -radius; z <= radius; z++) {
                    const distSq = (x * x) + (y * y) + (z * z);
                    if (distSq <= radiusSq && distSq >= innerRadiusSq) {
                        tasks.push(new Vec3(origin.x + x, origin.y + y, origin.z + z));
                    }
                }
            }
        }

        return tasks.sort((a, b) => a.y - b.y);
    }

    /**
     * Generates a Castle Watchtower with battlements
     */
    createTower(origin, radius, height) {
        const tasks = [];
        const radiusSq = radius * radius;
        const innerRadiusSq = Math.max(0, (radius - 1) * (radius - 1));

        for (let y = 0; y < height; y++) {
            const isFloor = (y === 0 || y % 6 === 0 || y === height - 1);
            for (let x = -radius; x <= radius; x++) {
                for (let z = -radius; z <= radius; z++) {
                    const distSq = (x * x) + (z * z);
                    if (distSq <= radiusSq) {
                        if (isFloor || distSq >= innerRadiusSq) {
                            tasks.push(new Vec3(origin.x + x, origin.y + y, origin.z + z));
                        }
                    }
                }
            }
        }

        // Add Crenellations / Battlements
        for (let x = -radius; x <= radius; x++) {
            for (let z = -radius; z <= radius; z++) {
                const distSq = (x * x) + (z * z);
                if (distSq <= radiusSq && distSq >= innerRadiusSq) {
                    if ((Math.abs(x) + Math.abs(z)) % 2 === 0) {
                        tasks.push(new Vec3(origin.x + x, origin.y + height, origin.z + z));
                    }
                }
            }
        }

        return tasks.sort((a, b) => a.y - b.y);
    }

    /**
     * Generates a Test Cube
     */
    createCube(origin, size) {
        const tasks = [];
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                for (let z = 0; z < size; z++) {
                    tasks.push(new Vec3(origin.x + x, origin.y + y, origin.z + z));
                }
            }
        }
        return tasks.sort((a, b) => a.y - b.y);
    }

    /**
     * Starts building a task list
     */
    async startBuild(projectName, tasks) {
        if (tasks.length === 0) {
            this.bot.chat('⚠ No blocks to place.');
            return;
        }

        this.currentProject = projectName;
        this.buildQueue = [...tasks];
        this.totalBlocks = tasks.length;
        this.placedBlocks = [];
        this.isBuilding = true;

        this.bot.chat(`🏗 Starting ${projectName} (${this.totalBlocks} blocks)...`);
        this.processQueue();
    }

    /**
     * Processes placing blocks in sequence
     */
    async processQueue() {
        if (!this.isBuilding) return;

        if (this.buildQueue.length === 0) {
            this.isBuilding = false;
            this.bot.chat(`🎉 Build Complete! Successfully placed all ${this.totalBlocks} blocks for ${this.currentProject}.`);
            return;
        }

        const targetPos = this.buildQueue.shift();

        try {
            // In creative / op mode, place block via setblock command
            this.bot.chat(`/setblock ${targetPos.x} ${targetPos.y} ${targetPos.z} stone`);
            this.placedBlocks.push(targetPos);

            // Progress report every 50 blocks
            const placedCount = this.totalBlocks - this.buildQueue.length;
            if (placedCount % 50 === 0 || this.buildQueue.length === 0) {
                const percent = Math.round((placedCount / this.totalBlocks) * 100);
                this.bot.chat(`🔨 Progress: ${placedCount}/${this.totalBlocks} blocks (${percent}%)`);
            }

            // Speed: 50ms per block (20 blocks per second)
            setTimeout(() => this.processQueue(), 50);
        } catch (err) {
            console.error('Error placing block:', err);
            setTimeout(() => this.processQueue(), 100);
        }
    }

    /**
     * Undoes the last build session
     */
    async undo() {
        if (this.placedBlocks.length === 0) {
            this.bot.chat('❌ No recent build to undo.');
            return;
        }

        this.stop();
        const toUndo = [...this.placedBlocks].reverse();
        this.bot.chat(`⏪ Undoing ${toUndo.length} blocks...`);

        for (const pos of toUndo) {
            this.bot.chat(`/setblock ${pos.x} ${pos.y} ${pos.z} air`);
        }

        this.placedBlocks = [];
        this.bot.chat('✔ Undo complete.');
    }

    /**
     * Stops active building
     */
    stop() {
        this.isBuilding = false;
        this.buildQueue = [];
        this.bot.chat('⏹ Build cancelled.');
    }

    getStatus() {
        if (!this.isBuilding) return { status: 'Idle', progress: 100, project: 'None' };
        const placed = this.totalBlocks - this.buildQueue.length;
        const percent = Math.round((placed / this.totalBlocks) * 100);
        return {
            status: 'Building',
            project: this.currentProject,
            placed,
            total: this.totalBlocks,
            percent
        };
    }
}

module.exports = Builder;
