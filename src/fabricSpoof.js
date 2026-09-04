'use strict';

/**
 * Fabric Brand Registration for Minecraft 1.21.x servers.
 *
 * IMPORTANT: Do NOT intercept select_known_packs here.
 * mineflayer@4.38.0 handles the entire configuration phase (select_known_packs,
 * finish_configuration) automatically via minecraft-protocol internals.
 * Adding a second reply here causes a double-send crash:
 *   TypeError: SizeOf error for undefined (reading 'length')
 *
 * All this plugin needs to do is send the Fabric brand custom_payload
 * so the server recognises the client as a Fabric mod client.
 */
function installFabricSpoof(bot) {
  const client = bot._client;
  if (!client) return;

  const MOD_CHANNELS = [
    'fabric-networking-api-v1:c2s_register',
    'fabric-networking-api-v1:s2c_register',
    'fabric:registry/sync',
    'fabric:registry/sync/direct',
  ];

  function sendFabricBrand() {
    try {
      // Tell the server we are a Fabric client
      client.write('custom_payload', {
        channel: 'minecraft:brand',
        data: Buffer.from([6, ...Buffer.from('fabric', 'utf8')]),
      });

      // Register mod channels so the server can send us mod packets
      const channelBuf = Buffer.from(MOD_CHANNELS.join('\0'), 'utf8');
      client.write('custom_payload', {
        channel: 'minecraft:register',
        data: channelBuf,
      });

      console.log('[Fabric Spoof] Sent Fabric brand and registered channels.');
    } catch (_) {
      // Silently ignore — channel may not be ready yet
    }
  }

  // Send fabric brand once when we enter the configuration state
  client.on('state', (newState) => {
    if (newState === 'configuration') {
      sendFabricBrand();
    }
  });

  // *** DO NOT add a select_known_packs handler here ***
  // mineflayer handles it automatically — a second reply causes a crash.

  bot._fabricSpoofInstalled = true;
}

module.exports = { installFabricSpoof };
