'use strict';

/**
 * Universal Fabric Protocol & Registry Handshake Spoofer.
 * Intercepts both Configuration and Play state custom payload packets
 * to satisfy Fabric Loader, Fabric API, BetterEnd, BCLib, and EffortlessBuilding
 * without requiring client-side mod installations.
 */
function installFabricSpoof(bot) {
  const client = bot._client;
  if (!client) return;

  const MOD_CHANNELS = [
    'fabric-networking-api-v1:c2s_register',
    'fabric-networking-api-v1:s2c_register',
    'fabric:registry/sync',
    'fabric:registry/sync/direct',
    'fabric-screen-handler-api-v1:open_screen',
    'bclib:main',
    'betterend:main',
    'effortlessbuilding:main',
    'brigadier:main',
  ];

  function sendFabricRegistration() {
    try {
      // 1. Send brand 'fabric'
      client.write('custom_payload', {
        channel: 'minecraft:brand',
        data: Buffer.from([6, ...Buffer.from('fabric', 'utf8')]),
      });

      // 2. Register vanilla channel list
      const channelBuf = Buffer.from(MOD_CHANNELS.join('\0'), 'utf8');
      client.write('custom_payload', {
        channel: 'minecraft:register',
        data: channelBuf,
      });

      // 3. Register Fabric networking API channel list
      client.write('custom_payload', {
        channel: 'fabric-networking-api-v1:c2s_register',
        data: channelBuf,
      });

      console.log('[Fabric Spoof] Sent Fabric brand and registered all mod channels.');
    } catch (e) {}
  }

  // Hook on state changes
  client.on('state', (newState) => {
    if (newState === 'configuration' || newState === 'play') {
      sendFabricRegistration();
    }
  });

  client.on('login', () => {
    sendFabricRegistration();
  });

  // Complete configuration state transition
  client.on('finish_configuration', () => {
    try {
      console.log('[Fabric Spoof] Received finish_configuration from server, acknowledging and entering play state...');
      client.write('finish_configuration', {});
    } catch (e) {}
  });

  // Catch custom payload packets in both Configuration and Play states
  client.on('packet', (data, meta) => {
    if (!meta) return;

    if (meta.name === 'finish_configuration') {
      try {
        client.write('finish_configuration', {});
      } catch (e) {}
      return;
    }

    if (meta.name !== 'custom_payload' && meta.name !== 'custom_report') return;
    if (!data || !data.channel) return;

    const channel = String(data.channel);

    // Fabric Registry Sync ACK
    if (channel.startsWith('fabric:registry/sync') || channel.includes('registry/sync')) {
      try {
        console.log(`[Fabric Spoof] Intercepted registry sync (${channel}), responding with ACK...`);
        client.write('custom_payload', {
          channel: 'fabric:registry/sync',
          data: Buffer.from([0x00]),
        });
        client.write('custom_payload', {
          channel: 'fabric:registry/sync/direct',
          data: Buffer.from([0x00]),
        });
      } catch (e) {
        console.error('[Fabric Spoof] Registry ACK error:', e.message);
      }
    }

    // Fabric Channel Registration Sync
    if (channel.startsWith('fabric-networking-api-v1')) {
      try {
        const channelBuf = Buffer.from(MOD_CHANNELS.join('\0'), 'utf8');
        client.write('custom_payload', {
          channel: 'fabric-networking-api-v1:c2s_register',
          data: channelBuf,
        });
      } catch (e) {}
    }
  });

  bot._fabricSpoofInstalled = true;
}

module.exports = { installFabricSpoof };
