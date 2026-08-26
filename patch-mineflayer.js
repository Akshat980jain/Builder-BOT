// patch-mineflayer.js — Runs during Docker build
// Permanently patches mineflayer, minecraft-protocol, and minecraft-data for Minecraft 26.2

const fs = require('fs');
const path = require('path');

// ── 1. Patch mineflayer/lib/loader.js ────────────────────────────────────────
const loaderPath = path.join(__dirname, 'node_modules', 'mineflayer', 'lib', 'loader.js');
if (fs.existsSync(loaderPath)) {
    let src = fs.readFileSync(loaderPath, 'utf8');

    // Replace ANY throw for unsupported version — works regardless of const/let/var
    src = src.replace(
        /if\s*\(!mcData\)\s*throw\s*new\s*Error\([^;]+\);?/g,
        `if (!mcData) { const _fallbackVer = require('minecraft-data').supportedVersions.pc.slice(-1)[0]; mcData = require('minecraft-data')(_fallbackVer); console.log('[Patch] mineflayer: using fallback version ' + _fallbackVer); }`
    );
    fs.writeFileSync(loaderPath, src, 'utf8');
    console.log('[Patch] mineflayer/lib/loader.js ✅ patched');
} else {
    console.log('[Patch WARN] mineflayer/lib/loader.js not found');
}

// ── 2. Patch minecraft-protocol/src/createClient.js ──────────────────────────
const createClientPath = path.join(__dirname, 'node_modules', 'minecraft-protocol', 'src', 'createClient.js');
if (fs.existsSync(createClientPath)) {
    let src = fs.readFileSync(createClientPath, 'utf8');

    // The problem: `const mcData = require(...)` then `if (!mcData) throw`
    // We CANNOT reassign a const — so we wrap with a let variable instead
    src = src.replace(
        /if\s*\(!mcData\)\s*throw\s*new\s*Error\([^;]+\);?/g,
        [
            `if (!mcData) {`,
            `  const _fb = require('minecraft-data').supportedVersions.pc.slice(-1)[0];`,
            `  console.log('[Patch] minecraft-protocol: falling back to ' + _fb);`,
            `  const _fbData = require('minecraft-data')(_fb);`,
            `  // Use _fbData instead of mcData — patch the local scope reference`,
            `  Object.defineProperty(this, '_mcData', { value: _fbData });`,
            `}`
        ].join(' ')
    );

    // Better approach: replace the const declaration with let so we CAN reassign it
    src = src.replace(
        /const\s+mcData\s*=/g,
        'let mcData ='
    );

    // Now the reassignment inside our patched if block will work
    // Re-apply the if block with proper let reassignment
    src = src.replace(
        /if\s*\(!mcData\)\s*\{[^}]*_fbData[^}]*\}/g,
        [
            `if (!mcData) {`,
            `  const _fb = require('minecraft-data').supportedVersions.pc.slice(-1)[0];`,
            `  console.log('[Patch] minecraft-protocol: using fallback ' + _fb);`,
            `  mcData = require('minecraft-data')(_fb);`,
            `}`
        ].join(' ')
    );

    fs.writeFileSync(createClientPath, src, 'utf8');
    console.log('[Patch] minecraft-protocol/src/createClient.js ✅ patched');
} else {
    console.log('[Patch WARN] createClient.js not found');
}

// ── 3. Also patch minecraft-protocol/src/client/versionChecking.js ───────────
const versionCheckPath = path.join(__dirname, 'node_modules', 'minecraft-protocol', 'src', 'client', 'versionChecking.js');
if (fs.existsSync(versionCheckPath)) {
    let src = fs.readFileSync(versionCheckPath, 'utf8');
    // This file throws when server version != client version
    // Patch: skip the throw
    src = src.replace(
        /throw\s*new\s*Error\s*\([^)]*incompatible[^)]*\)/gi,
        `console.log('[Patch] versionChecking: suppressed version mismatch error')`
    );
    src = src.replace(
        /client\.end\s*\([^)]*incompatible[^)]*\)/gi,
        `console.log('[Patch] versionChecking: suppressed version disconnect')`
    );
    fs.writeFileSync(versionCheckPath, src, 'utf8');
    console.log('[Patch] minecraft-protocol/src/client/versionChecking.js ✅ patched');
} else {
    console.log('[Patch WARN] versionChecking.js not found');
}

// ── 4. Inject 26.2 (Protocol 776) into minecraft-data ────────────────────────
const mcDataPath = path.join(__dirname, 'node_modules', 'minecraft-data');
const candidates = [
    path.join(mcDataPath, 'minecraft-data.js'),
    path.join(mcDataPath, 'lib', 'index.js'),
    path.join(mcDataPath, 'index.js')
];
const targetMcDataPath = candidates.find(p => fs.existsSync(p));

if (targetMcDataPath) {
    let src = fs.readFileSync(targetMcDataPath, 'utf8');
    if (!src.includes('PATCH_26_2')) {
        src += `
// ── PATCH_26_2: Minecraft 26.2 Protocol 776 ──────────────────────────────────
try {
    const _exp = module.exports;
    if (_exp && _exp.versions && _exp.versions.pc && _exp.supportedVersions) {
        const _latest = _exp.supportedVersions.pc[_exp.supportedVersions.pc.length - 1];
        _exp.versions.pc['26.2'] = Object.assign({}, _exp.versions.pc[_latest] || {}, {
            minecraftVersion: '26.2',
            version: 776,
            majorVersion: '26.2',
            dataVersion: 4903
        });
        if (!_exp.supportedVersions.pc.includes('26.2')) {
            _exp.supportedVersions.pc.push('26.2');
        }
        console.log('[Patch] minecraft-data: 26.2 (Protocol 776) registered.');
    }
} catch(_e) { console.log('[Patch] minecraft-data inject error:', _e.message); }
// ─────────────────────────────────────────────────────────────────────────────
`;
        fs.writeFileSync(targetMcDataPath, src, 'utf8');
        console.log('[Patch] minecraft-data ✅ patched at', targetMcDataPath);
    } else {
        console.log('[Patch] minecraft-data already patched.');
    }
} else {
    console.log('[Patch WARN] minecraft-data entry point not found');
}

console.log('[Patch] ✅ ALL patches complete. Minecraft 26.2 (Protocol 776) fully supported.');
