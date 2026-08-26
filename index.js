const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const express = require('express');
const Builder = require('./builder');

// Configuration from Environment Variables (set in Railway Dashboard)
const SERVER_HOST = process.env.SERVER_HOST || 'localhost';
const SERVER_PORT = parseInt(process.env.SERVER_PORT || '25565');
const BOT_USERNAME = process.env.BOT_NAME || 'BuilderBot';
const BOT_VERSION = process.env.BOT_VERSION || false;
const WEB_PORT = process.env.PORT || 3000;

let bot = null;
let builder = null;
let reconnectTimer = null;
let botStatus = 'Initializing...';

function createBot() {
    console.log(`[Bot] Connecting to ${SERVER_HOST}:${SERVER_PORT} as ${BOT_USERNAME}...`);
    botStatus = `Connecting to ${SERVER_HOST}:${SERVER_PORT}...`;

    bot = mineflayer.createBot({
        host: SERVER_HOST,
        port: SERVER_PORT,
        username: BOT_USERNAME,
        version: BOT_VERSION || undefined,
        checkTimeoutInterval: 60000,
        keepAlive: true
    });

    bot.loadPlugin(pathfinder);
    builder = new Builder(bot);

    bot.on('spawn', () => {
        console.log(`[Bot] ${BOT_USERNAME} successfully spawned into world!`);
        botStatus = 'Online (In World)';
        bot.chat(`🤖 ${BOT_USERNAME} is online and ready! Type !help for commands.`);
    });

    bot.on('chat', (username, message) => {
        if (username === bot.username) return;
        handleCommand(username, message.trim());
    });

    bot.on('kicked', (reason) => {
        console.log(`[Bot] Kicked from server: ${reason}`);
        botStatus = `Kicked: ${reason}`;
        scheduleReconnect();
    });

    bot.on('end', () => {
        console.log('[Bot] Disconnected from server.');
        botStatus = 'Disconnected. Retrying...';
        scheduleReconnect();
    });

    bot.on('error', (err) => {
        console.error('[Bot Error]', err.message);
        botStatus = `Error: ${err.message}`;
    });
}

function scheduleReconnect() {
    if (reconnectTimer) return;
    console.log('[Bot] Will attempt reconnect in 15 seconds...');
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        createBot();
    }, 15000);
}

function handleCommand(username, message) {
    if (!message.startsWith('!')) return;

    const parts = message.slice(1).split(' ');
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    const player = bot.players[username];
    const playerPos = player && player.entity ? player.entity.position.floored() : bot.entity.position.floored();

    switch (cmd) {
        case 'help':
            bot.chat('📜 Commands: !pyramid <size>, !dome <radius>, !tower <radius> <height>, !cube <size>, !undo, !come, !follow, !stop, !status');
            break;

        case 'come':
            if (!player || !player.entity) {
                bot.chat('❌ I cannot see you.');
                return;
            }
            bot.chat(`🏃 Coming to ${username}...`);
            bot.pathfinder.setGoal(new goals.GoalNear(playerPos.x, playerPos.y, playerPos.z, 2));
            break;

        case 'follow':
            if (!player || !player.entity) {
                bot.chat('❌ I cannot see you.');
                return;
            }
            bot.chat(`🚶 Following ${username}...`);
            bot.pathfinder.setGoal(new goals.GoalFollow(player.entity, 2), true);
            break;

        case 'stop':
            bot.pathfinder.stop();
            if (builder) builder.stop();
            bot.chat('⏹ All tasks stopped.');
            break;

        case 'pyramid':
            const pSize = parseInt(args[0]) || 16;
            const pTasks = builder.createPyramid(playerPos.offset(2, 0, 2), pSize);
            builder.startBuild(`Pyramid (${pSize}x${pSize})`, pTasks);
            break;

        case 'dome':
            const dRadius = parseInt(args[0]) || 8;
            const dTasks = builder.createDome(playerPos.offset(dRadius + 2, 0, 0), dRadius);
            builder.startBuild(`Glass Dome (r=${dRadius})`, dTasks);
            break;

        case 'tower':
            const tRadius = parseInt(args[0]) || 4;
            const tHeight = parseInt(args[1]) || 20;
            const tTasks = builder.createTower(playerPos.offset(tRadius + 2, 0, 0), tRadius, tHeight);
            builder.startBuild(`Castle Tower (r=${tRadius}, h=${tHeight})`, tTasks);
            break;

        case 'cube':
            const cSize = parseInt(args[0]) || 4;
            const cTasks = builder.createCube(playerPos.offset(2, 0, 2), cSize);
            builder.startBuild(`Cube (${cSize}x${cSize})`, cTasks);
            break;

        case 'undo':
            builder.undo();
            break;

        case 'status':
            const stat = builder.getStatus();
            if (stat.status === 'Idle') {
                bot.chat(`🟢 Bot is idle at (${Math.round(bot.entity.position.x)}, ${Math.round(bot.entity.position.y)}, ${Math.round(bot.entity.position.z)})`);
            } else {
                bot.chat(`🔨 Building ${stat.project}: ${stat.placed}/${stat.total} blocks (${stat.percent}%)`);
            }
            break;

        default:
            bot.chat(`❓ Unknown command '!${cmd}'. Type !help for list of commands.`);
            break;
    }
}

// ── EXPRESS WEB DASHBOARD (FOR RAILWAY) ──────────────────────────────────────
const app = express();

app.get('/', (req, res) => {
    const buildStat = builder ? builder.getStatus() : { status: 'Idle', percent: 100, project: 'None' };
    const botPos = bot && bot.entity ? `${Math.round(bot.entity.position.x)}, ${Math.round(bot.entity.position.y)}, ${Math.round(bot.entity.position.z)}` : 'Offline';

    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Builder Bot - 24/7 Cloud Dashboard</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&display=swap" rel="stylesheet">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Outfit', sans-serif; }
        body { background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px; }
        .card { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 32px; width: 100%; max-width: 500px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
        .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
        .title { font-size: 24px; font-weight: 800; color: #f59e0b; display: flex; align-items: center; gap: 8px; }
        .badge { font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 999px; background: #0284c7; color: #fff; }
        .row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #334155; }
        .label { color: #94a3b8; font-size: 14px; }
        .val { font-weight: 600; font-size: 14px; color: #38bdf8; }
        .progress-box { margin-top: 20px; background: #0f172a; border-radius: 8px; padding: 16px; }
        .bar { height: 10px; border-radius: 5px; background: #334155; overflow: hidden; margin-top: 8px; }
        .fill { height: 100%; width: ${buildStat.percent}%; background: linear-gradient(90deg, #f59e0b, #38bdf8); transition: width 0.3s ease; }
        .commands { margin-top: 20px; font-size: 13px; color: #94a3b8; }
        code { background: #0f172a; padding: 2px 6px; border-radius: 4px; color: #f59e0b; }
    </style>
</head>
<body>
    <div class="card">
        <div class="header">
            <div class="title">🤖 Builder Bot</div>
            <div class="badge">24/7 Cloud</div>
        </div>
        <div class="row">
            <span class="label">Server Host:</span>
            <span class="val">${SERVER_HOST}:${SERVER_PORT}</span>
        </div>
        <div class="row">
            <span class="label">Bot Name:</span>
            <span class="val">${BOT_USERNAME}</span>
        </div>
        <div class="row">
            <span class="label">Status:</span>
            <span class="val" style="color: ${botStatus.includes('Online') ? '#4ade80' : '#f87171'}">${botStatus}</span>
        </div>
        <div class="row">
            <span class="label">World Position:</span>
            <span class="val">${botPos}</span>
        </div>

        <div class="progress-box">
            <div style="display:flex; justify-content:space-between; font-size:13px;">
                <span>Active Build: <b>${buildStat.project}</b></span>
                <span>${buildStat.percent}%</span>
            </div>
            <div class="bar">
                <div class="fill"></div>
            </div>
        </div>

        <div class="commands">
            <b>In-Game Chat Commands:</b><br>
            <code>!pyramid &lt;size&gt;</code>, <code>!dome &lt;radius&gt;</code>, <code>!tower &lt;r&gt; &lt;h&gt;</code>, <code>!come</code>, <code>!undo</code>
        </div>
    </div>
</body>
</html>
    `);
});

app.listen(WEB_PORT, () => {
    console.log(`[Web] Dashboard live on port ${WEB_PORT}`);
    createBot();
});
