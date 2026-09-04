'use strict';

/**
 * Minimal Fabric Protocol & Configuration State Handler.
 * Replies to select_known_packs exactly ONCE to avoid "Invalid custom payload" kick.
 * Does NOT intercept generic 'packet' events to avoid double-sends.
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

  // Send the Fabric brand + channel registrations once when entering configuration state
  function sendFabricRegistration() {
    try {
      client.write('custom_payload', {
        channel: 'minecraft:brand',
        data: Buffer.from([6, ...Buffer.from('fabric', 'utf8')]),
      });

      const channelBuf = Buffer.from(MOD_CHANNELS.join('\0'), 'utf8');
      client.write('custom_payload', {
        channel: 'minecraft:register',
        data: channelBuf,
      });
      console.log('[Fabric Spoof] Sent Fabric brand and registered channels.');
    } catch (e) {
      // Silently ignore if channel is not open yet
    }
  }

  // Fire registration once on entering configuration state
  client.on('state', (newState) => {
    if (newState === 'configuration') {
      sendFabricRegistration();
    }
  });

  // Reply to select_known_packs EXACTLY once (only this handler, no duplicate in 'packet')
  client.on('select_known_packs', (packet) => {
    try {
      console.log('[Fabric Spoof] Intercepted select_known_packs, replying...');

      // Echo back whatever packs the server told us about (or vanilla core as fallback)
      const knownPacks = Array.isArray(packet?.knownPacks) && packet.knownPacks.length > 0
        ? packet.knownPacks.map((p) => ({
            namespace: String(p.namespace || 'minecraft'),
            id: String(p.id || 'core'),
            version: String(p.version || '1.21.4'),
          }))
        : [{ namespace: 'minecraft', id: 'core', version: '1.21.4' }];

      client.write('select_known_packs', { knownPacks });
    } catch (e) {
      console.log('[Fabric Spoof] select_known_packs reply error:', e.message);
    }
  });

  bot._fabricSpoofInstalled = true;
}

module.exports = { installFabricSpoof };
