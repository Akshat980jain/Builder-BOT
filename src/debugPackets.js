'use strict';

/**
 * Lightweight packet logger for debugging connection flow.
 * READ-ONLY: this module never calls client.write().
 */
function installPacketDebugger(bot) {
  const client = bot._client;
  if (!client) return;
  const start = Date.now();

  function ts() {
    return `+${((Date.now() - start) / 1000).toFixed(2)}s`;
  }

  // Log all incoming packets
  client.on('packet', (data, meta) => {
    if (!meta) return;
    if (meta.name === 'custom_payload' || meta.name === 'custom_report') {
      console.log(`[PKT IN  ${ts()}] state=${meta.state} name=${meta.name} channel=${data?.channel}`);
    } else {
      console.log(`[PKT IN  ${ts()}] state=${meta.state} name=${meta.name}`);
    }
  });

  // Wrap client.write to log outgoing packets
  const originalWrite = client.write.bind(client);
  client.write = (name, params) => {
    if (name === 'custom_payload') {
      console.log(`[PKT OUT ${ts()}] state=${client.state} name=${name} channel=${params?.channel}`);
    } else {
      console.log(`[PKT OUT ${ts()}] state=${client.state} name=${name}`);
    }
    return originalWrite(name, params);
  };

  // Log state transitions
  client.on('state', (newState, oldState) => {
    console.log(`[STATE   ${ts()}] ${oldState} -> ${newState}`);
  });

  // Log when we fully reach PLAY state
  bot.once('spawn', () => {
    console.log(`[WATCH   ${ts()}] spawn event fired — reached PLAY state successfully`);
  });
}

module.exports = { installPacketDebugger };
