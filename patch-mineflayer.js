// patch-mineflayer.js — JSON Data & Protocol Fixes for 1.21+ & 26.2

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

// ── 4. Patch processNbtMessage in minecraft-protocol/src/client/chat.js ──────
const chatJsPath = path.join(__dirname, 'node_modules', 'minecraft-protocol', 'src', 'client', 'chat.js');
if (fs.existsSync(chatJsPath)) {
    try {
        let content = fs.readFileSync(chatJsPath, 'utf8');
        content = content.replace(
            /processNbtMessage\(msg\)/g,
            "(function(m){ try { const pnbt = require('prismarine-nbt'); return pnbt.simplify(m); } catch (e) { return m; } })(msg)"
        );
        fs.writeFileSync(chatJsPath, content, 'utf8');
        console.log('[Patch] minecraft-protocol chat.js successfully patched for processNbtMessage.');
    } catch (e) {
        console.error('[Patch Error] chat.js:', e.message);
    }
}

// ── 5. Patch JSON.parse in mineflayer/lib/plugins/chat.js ───────────────────
const mineflayerChatPath = path.join(__dirname, 'node_modules', 'mineflayer', 'lib', 'plugins', 'chat.js');
if (fs.existsSync(mineflayerChatPath)) {
    try {
        let content = fs.readFileSync(mineflayerChatPath, 'utf8');
        content = content.replace(
            /JSON\.parse\(([^)]+)\)/g,
            '(typeof $1 === "object" ? $1 : (function(x){ try { return JSON.parse(x); } catch(e){ return { text: String(x || "") }; } })($1))'
        );
        fs.writeFileSync(mineflayerChatPath, content, 'utf8');
        console.log('[Patch] mineflayer chat.js successfully patched for Object messages.');
    } catch (e) {
        console.error('[Patch Error] mineflayer chat.js:', e.message);
    }
}

console.log('[JSON Patch] ✅ All datasets & protocol handlers updated.');
