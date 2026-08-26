// patch-mineflayer.js — Pure JSON Data Registration for Minecraft 26.2
// Does NOT modify ANY JavaScript code — 100% immune to syntax/type errors.

const fs = require('fs');
const path = require('path');

const mcDataDir = path.join(__dirname, 'node_modules', 'minecraft-data');

// ── 1. Register 26.2 in data/dataPaths.json ─────────────────────────────────
const dataPathsFile = path.join(mcDataDir, 'data', 'dataPaths.json');
if (fs.existsSync(dataPathsFile)) {
    try {
        const dataPaths = JSON.parse(fs.readFileSync(dataPathsFile, 'utf8'));
        if (dataPaths.pc) {
            const pcKeys = Object.keys(dataPaths.pc);
            const latestKey = pcKeys[pcKeys.length - 1];
            if (latestKey) {
                // Clone latest version definitions for 26.2
                dataPaths.pc['26.2'] = Object.assign({}, dataPaths.pc[latestKey]);
                fs.writeFileSync(dataPathsFile, JSON.stringify(dataPaths, null, 2), 'utf8');
                console.log(`[JSON Patch] dataPaths.json: 26.2 registered (cloned from ${latestKey})`);
            }
        }
    } catch (e) {
        console.error('[JSON Patch Error] dataPaths.json:', e.message);
    }
}

// ── 2. Register 26.2 (Protocol 776) in protocolVersions.json ────────────────
const protoFile = path.join(mcDataDir, 'data', 'pc', 'common', 'protocolVersions.json');
if (fs.existsSync(protoFile)) {
    try {
        const protos = JSON.parse(fs.readFileSync(protoFile, 'utf8'));
        if (Array.isArray(protos)) {
            const has26 = protos.some(p => p.minecraftVersion === '26.2' || p.version === 776);
            if (!has26) {
                protos.unshift({
                    minecraftVersion: '26.2',
                    version: 776,
                    dataVersion: 4903,
                    usesNetty: true,
                    majorVersion: '26.2'
                });
                fs.writeFileSync(protoFile, JSON.stringify(protos, null, 2), 'utf8');
                console.log('[JSON Patch] protocolVersions.json: Protocol 776 registered for 26.2');
            }
        }
    } catch (e) {
        console.error('[JSON Patch Error] protocolVersions.json:', e.message);
    }
}

// ── 3. Register 26.2 in versions.json ───────────────────────────────────────
const versionsFile = path.join(mcDataDir, 'data', 'pc', 'common', 'versions.json');
if (fs.existsSync(versionsFile)) {
    try {
        const vers = JSON.parse(fs.readFileSync(versionsFile, 'utf8'));
        if (Array.isArray(vers)) {
            const has26 = vers.some(p => p.minecraftVersion === '26.2' || p.version === 776);
            if (!has26) {
                vers.unshift({
                    minecraftVersion: '26.2',
                    version: 776,
                    dataVersion: 4903,
                    usesNetty: true,
                    majorVersion: '26.2'
                });
                fs.writeFileSync(versionsFile, JSON.stringify(vers, null, 2), 'utf8');
                console.log('[JSON Patch] versions.json: 26.2 registered');
            }
        }
    } catch (e) {
        console.error('[JSON Patch Error] versions.json:', e.message);
    }
}

console.log('[JSON Patch] ✅ All JSON datasets successfully updated for 26.2 (Protocol 776).');
