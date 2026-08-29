'use strict';

/**
 * Universal Fabric Protocol & Configuration State Handler.
 * Auto-acknowledges all Fabric API channels and custom payloads.
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
      client.write('custom_payload', {
        channel: 'minecraft:brand',
        data: Buffer.from([6, ...Buffer.from('fabric', 'utf8')]),
      });

      const channelBuf = Buffer.from(MOD_CHANNELS.join('\0'), 'utf8');
      client.write('custom_payload', {
        channel: 'minecraft:register',
        data: channelBuf,
      });

      client.write('custom_payload', {
        channel: 'fabric-networking-api-v1:c2s_register',
        data: channelBuf,
      });
      console.log('[Fabric Spoof] Sent Fabric brand and registered channels.');
    } catch (e) {}
  }

  client.on('state', (newState) => {
    if (newState === 'configuration' || newState === 'play') {
      sendFabricRegistration();
    }
  });

  client.on('login', () => {
    sendFabricRegistration();
  });

  client.on('select_known_packs', (packet) => {
    try {
      console.log('[Fabric Spoof] Intercepted select_known_packs, replying...');
      const knownPacks = packet?.knownPacks || [
        { namespace: 'minecraft', id: 'core', version: '1.21.4' }
      ];
      client.write('select_known_packs', { knownPacks });
    } catch (e) {}
  });

  client.on('finish_configuration', () => {
    try {
      console.log('[Fabric Spoof] Received finish_configuration from server, acknowledging...');
      client.write('finish_configuration', {});
    } catch (e) {}
  });

  client.on('packet', (data, meta) => {
    if (!meta) return;

    if (meta.name === 'select_known_packs') {
      try {
        client.write('select_known_packs', {
          knownPacks: data.knownPacks || [{ namespace: 'minecraft', id: 'core', version: '1.21.4' }]
        });
      } catch (e) {}
      return;
    }

    if (meta.name === 'finish_configuration') {
      try {
        client.write('finish_configuration', {});
      } catch (e) {}
      return;
    }

    if (meta.name === 'custom_payload' || meta.name === 'custom_report') {
      if (!data || !data.channel) return;
      const channel = String(data.channel);
      console.log(`[Fabric Spoof] Received custom_payload on channel: "${channel}"`);

      // 1. Fabric Registry Sync ACK
      if (channel.includes('registry/sync')) {
        try {
          client.write('custom_payload', { channel, data: Buffer.alloc(0) });
          client.write('custom_payload', { channel: 'fabric:registry/sync', data: Buffer.alloc(0) });
          client.write('custom_payload', { channel: 'fabric:registry/sync/direct', data: Buffer.alloc(0) });
        } catch (e) {}
      }

      // 2. Fabric S2C Registration ACK
      if (channel.startsWith('fabric-networking-api-v1')) {
        try {
          const channelBuf = Buffer.from(MOD_CHANNELS.join('\0'), 'utf8');
          client.write('custom_payload', {
            channel: 'fabric-networking-api-v1:c2s_register',
            data: channelBuf,
          });
        } catch (e) {}
      }

      // 3. Generic Mod Channel Handshake Response
      if (channel.includes(':')) {
        try {
          client.write('custom_payload', { channel, data: Buffer.alloc(0) });
        } catch (e) {}
      }
    }
  });

  bot._fabricSpoofInstalled = true;
}

module.exports = { installFabricSpoof };
