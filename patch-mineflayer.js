// patch-mineflayer.js — Runs during Docker build
// Cleanly registers Minecraft 26.2 (Protocol 776) inside minecraft-data

const fs = require('fs');
const path = require('path');

const mcDataDir = path.join(__dirname, 'node_modules', 'minecraft-data');

// ── 1. Update dataPaths.json if it exists ───────────────────────────────────
const dataPathsFile = path.join(mcDataDir, 'data', 'dataPaths.json');
if (fs.existsSync(dataPathsFile)) {
    try {
        const dataPaths = JSON.parse(fs.readFileSync(dataPathsFile, 'utf8'));
        if (dataPaths.pc) {
            const pcVersions = Object.keys(dataPaths.pc);
            const latestVer = pcVersions[pcVersions.length - 1];
            if (latestVer && !dataPaths.pc['26.2']) {
                dataPaths.pc['26.2'] = Object.assign({}, dataPaths.pc[latestVer]);
                fs.writeFileSync(dataPathsFile, JSON.stringify(dataPaths, null, 2), 'utf8');
                console.log(`[Patch] dataPaths.json: registered 26.2 mapped to ${latestVer}`);
            }
        }
    } catch (err) {
        console.log('[Patch Notice] dataPaths.json:', err.message);
    }
}

// ── 2. Update protocolVersions.json if it exists ─────────────────────────────
const protocolVersionsFile = path.join(mcDataDir, 'data', 'pc', 'common', 'protocolVersions.json');
if (fs.existsSync(protocolVersionsFile)) {
    try {
        const protoList = JSON.parse(fs.readFileSync(protocolVersionsFile, 'utf8'));
        if (Array.isArray(protoList)) {
            const exists = protoList.some(v => v.minecraftVersion === '26.2' || v.version === 776);
            if (!exists) {
                protoList.unshift({
                    minecraftVersion: '26.2',
                    version: 776,
                    dataVersion: 4903,
                    usesNetty: true,
                    majorVersion: '26.2'
                });
                fs.writeFileSync(protocolVersionsFile, JSON.stringify(protoList, null, 2), 'utf8');
                console.log('[Patch] protocolVersions.json: registered Protocol 776 for 26.2');
            }
        }
    } catch (err) {
        console.log('[Patch Notice] protocolVersions.json:', err.message);
    }
}

// ── 3. Cleanly wrap minecraft-data entry point ───────────────────────────────
const mcIndexCandidates = [
    path.join(mcDataDir, 'index.js'),
    path.join(mcDataDir, 'minecraft-data.js'),
    path.join(mcDataDir, 'lib', 'index.js')
];

for (const indexPath of mcIndexCandidates) {
    if (fs.existsSync(indexPath)) {
        let src = fs.readFileSync(indexPath, 'utf8');
        if (!src.includes('WRAPPER_26_2')) {
            src += `
// ── WRAPPER_26_2: Auto-fallback for Minecraft 26.2 (Protocol 776) ─────────────
(function() {
    const _origExport = module.exports;
    const _wrapped = function(version) {
        if (version === '26.2' || version === 776 || version === '776' || version === false || version === undefined) {
            const _latest = (_origExport.supportedVersions && _origExport.supportedVersions.pc)
                ? _origExport.supportedVersions.pc[_origExport.supportedVersions.pc.length - 1]
                : '1.21.4';
            const _baseData = _origExport(_latest);
            if (_baseData) {
                return Object.assign({}, _baseData, {
                    version: Object.assign({}, _baseData.version, {
                        minecraftVersion: '26.2',
                        version: 776,
                        majorVersion: '26.2',
                        dataVersion: 4903
                    })
                });
            }
        }
        try {
            return _origExport(version);
        } catch(e) {
            const _latest = (_origExport.supportedVersions && _origExport.supportedVersions.pc)
                ? _origExport.supportedVersions.pc[_origExport.supportedVersions.pc.length - 1]
                : '1.21.4';
            return _origExport(_latest);
        }
    };
    Object.assign(_wrapped, _origExport);
    if (_wrapped.supportedVersions && _wrapped.supportedVersions.pc) {
        if (!_wrapped.supportedVersions.pc.includes('26.2')) {
            _wrapped.supportedVersions.pc.push('26.2');
        }
    }
    if (_wrapped.versions && _wrapped.versions.pc) {
        const _latest = _wrapped.supportedVersions.pc[_wrapped.supportedVersions.pc.length - 1];
        _wrapped.versions.pc['26.2'] = Object.assign({}, _wrapped.versions.pc[_latest] || {}, {
            minecraftVersion: '26.2',
            version: 776,
            majorVersion: '26.2',
            dataVersion: 4903
        });
    }
    module.exports = _wrapped;
})();
`;
            fs.writeFileSync(indexPath, src, 'utf8');
            console.log('[Patch] minecraft-data entry point wrapped at:', indexPath);
        }
        break;
    }
}

console.log('[Patch] ✅ 26.2 Protocol 776 data injection complete.');
