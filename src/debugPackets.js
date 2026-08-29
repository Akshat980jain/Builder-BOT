'use strict';

/**
 * Logs every raw packet in both directions during the configuration phase
 * (and briefly into play), so a stuck handshake shows exactly which packet
 * never arrived or never got a reply — instead of guessing.
 *
 * Enable with DEBUG_PACKETS=true.
 */
function installPacketDebugger(bot) {
  const client = bot._client;
  if (!client) return;
  const start = Date.now();

  function ts() {
    return `+${((Date.now() - start) / 1000).toFixed(2)}s`;
  }

  client.on('packet', (data, meta) => {
    console.log(`[PKT IN  ${ts()}] state=${meta.state} name=${meta.name}`);
  });

  const originalWrite = client.write.bind(client);
  client.write = (name, params) => {
    console.log(`[PKT OUT ${ts()}] state=${client.state} name=${name}`);
    return originalWrite(name, params);
  };

  client.on('state', (newState, oldState) => {
    console.log(`[STATE   ${ts()}] ${oldState} -> ${newState}`);
  });

  client.on('select_known_packs', (data) => {
    console.log(`[WATCH   ${ts()}] select_known_packs received:`, JSON.stringify(data));
  });

  client.on('finish_configuration', () => {
    console.log(`[WATCH   ${ts()}] finish_configuration received`);
  });

  bot.once('spawn', () => {
    console.log(`[WATCH   ${ts()}] spawn event fired — reached PLAY state successfully`);
  });
}

module.exports = { installPacketDebugger };
