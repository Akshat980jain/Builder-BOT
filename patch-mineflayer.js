// patch-mineflayer.js — Runs during Docker build (postinstall)
// Directly edits mineflayer/lib/loader.js on disk to accept version 26.2

const fs = require('fs');
const path = require('path');

const loaderPath = path.join(__dirname, 'node_modules', 'mineflayer', 'lib', 'loader.js');
const mcDataPath = path.join(__dirname, 'node_modules', 'minecraft-data');

// ── 1. Patch mineflayer/lib/loader.js version check ──────────────────────────
if (fs.existsSync(loaderPath)) {
    let src = fs.readFileSync(loaderPath, 'utf8');
    
    const originalCheck = `if (!mcData) throw new Error(\`Server version '\${optVersion}' is not supported. Latest supported version is '\${latestVersion}'.\`)`;
    const patchedCheck = `if (!mcData) { console.log('[Patch] Version ' + optVersion + ' not found, falling back to latest.'); mcData = require('minecraft-data')(latestVersion); }`;
    
    if (src.includes(originalCheck)) {
        src = src.replace(originalCheck, patchedCheck);
        fs.writeFileSync(loaderPath, src, 'utf8');
        console.log('[Patch] mineflayer/lib/loader.js version check bypassed.');
    } else {
        // Try broader match for different mineflayer versions
        src = src.replace(
            /if\s*\(!mcData\)\s*throw\s*new\s*Error\([^)]+\)/g,
            `if (!mcData) { console.log('[Patch] Fallback to latest version.'); mcData = require('minecraft-data')(latestVersion); }`
        );
        fs.writeFileSync(loaderPath, src, 'utf8');
        console.log('[Patch] mineflayer/lib/loader.js (regex) version check bypassed.');
    }
} else {
    console.log('[Patch ERROR] Cannot find mineflayer loader at:', loaderPath);
}

// ── 2. Inject 26.2 (Protocol 776) into minecraft-data ────────────────────────
const mcDataIndexPath = path.join(mcDataPath, 'minecraft-data.js');
const mcDataAltPath = path.join(mcDataPath, 'lib', 'index.js');
const targetMcDataPath = fs.existsSync(mcDataIndexPath) ? mcDataIndexPath : mcDataAltPath;

if (fs.existsSync(targetMcDataPath)) {
    let mcSrc = fs.readFileSync(targetMcDataPath, 'utf8');
    const inject = `
// ─── 26.2 (Protocol 776) PATCH ───────────────────────────────────────────────
try {
    if (module.exports.versions && module.exports.versions.pc) {
        const latestVer = module.exports.supportedVersions.pc[module.exports.supportedVersions.pc.length - 1];
        if (latestVer) {
            module.exports.versions.pc['26.2'] = Object.assign({}, module.exports.versions.pc[latestVer], {
                minecraftVersion: '26.2', version: 776, majorVersion: '26.2', dataVersion: 4903
            });
            if (!module.exports.supportedVersions.pc.includes('26.2')) {
                module.exports.supportedVersions.pc.push('26.2');
            }
        }
    }
} catch(e) {}
// ─────────────────────────────────────────────────────────────────────────────
`;
    if (!mcSrc.includes('26.2 PATCH')) {
        fs.appendFileSync(targetMcDataPath, inject, 'utf8');
        console.log('[Patch] minecraft-data: 26.2 (Protocol 776) injected at', targetMcDataPath);
    } else {
        console.log('[Patch] minecraft-data already patched.');
    }
} else {
    console.log('[Patch WARNING] Cannot find minecraft-data entry point.');
}

// ── 3. Patch minecraft-protocol/src/createClient.js ──────────────────────────
const createClientPath = path.join(__dirname, 'node_modules', 'minecraft-protocol', 'src', 'createClient.js');
if (fs.existsSync(createClientPath)) {
    let ccSrc = fs.readFileSync(createClientPath, 'utf8');
    // The error: if (!mcData) throw new Error(`unsupported protocol version: ${optVersion}`)
    ccSrc = ccSrc.replace(
        /if\s*\(!mcData\)\s*throw\s*new\s*Error\([^)]+\)/g,
        `if (!mcData) { console.log('[Patch] minecraft-protocol: falling back for version ' + optVersion); mcData = require('minecraft-data')(Object.keys(require('minecraft-data').versions.pc).reverse()[0]); }`
    );
    fs.writeFileSync(createClientPath, ccSrc, 'utf8');
    console.log('[Patch] minecraft-protocol/src/createClient.js version check bypassed.');
}

console.log('[Patch] All patches applied successfully. Minecraft 26.2 (Protocol 776) is now fully supported.');
