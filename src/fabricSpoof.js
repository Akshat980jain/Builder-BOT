'use strict';

/**
 * Fabric Mod & Registry Handshake Spoofer for Mineflayer.
 * Emulates Fabric Loader, Fabric API, and mod registry acknowledgments
 * so the bot can join Fabric modded servers without being kicked.
 */
function installFabricSpoof(bot) {
  const client = bot._client;
  if (!client) return;

  const KNOWN_FABRIC_CHANNELS = [
    'fabric-networking-api-v1:c2s_register',
    'fabric:registry/sync',
    'fabric:registry/sync/direct',
    'fabric-screen-handler-api-v1:open_screen',
    'bclib:main',
    'betterend:main',
    'effortlessbuilding:main',
  ];

  // 1. Send client-side brand 'fabric' on login
  client.on('login', () => {
    try {
      client.write('custom_payload', {
        channel: 'minecraft:brand',
        data: Buffer.from([6, ...Buffer.from('fabric', 'utf8')]),
      });
      console.log('[Fabric Spoof] Sent brand: fabric');
    } catch (e) {}

    // Register Fabric channels
    try {
      const channelBuf = Buffer.from(KNOWN_FABRIC_CHANNELS.join('\0'), 'utf8');
      client.write('custom_payload', {
        channel: 'minecraft:register',
        data: channelBuf,
      });
      console.log('[Fabric Spoof] Registered Fabric channels with server.');
    } catch (e) {}
  });

  // 2. Intercept and acknowledge Fabric registry sync packets
  client.on('custom_payload', (packet) => {
    if (!packet || !packet.channel) return;

    const channel = packet.channel;

    if (channel === 'fabric:registry/sync' || channel === 'fabric:registry/sync/direct') {
      try {
        console.log(`[Fabric Spoof] Intercepted registry sync on ${channel}, replying with ACK...`);
        // Fabric API expects an empty ACK payload back to confirm client received the registry
        client.write('custom_payload', {
          channel: 'fabric:registry/sync',
          data: Buffer.from([0x00]),
        });
      } catch (e) {
        console.error('[Fabric Spoof] Error sending registry ACK:', e.message);
      }
    }

    if (channel === 'fabric-networking-api-v1:s2c_register') {
      try {
        client.write('custom_payload', {
          channel: 'fabric-networking-api-v1:c2s_register',
          data: packet.data || Buffer.alloc(0),
        });
      } catch (e) {}
    }
  });

  bot._fabricSpoofInstalled = true;
}

module.exports = { installFabricSpoof };
