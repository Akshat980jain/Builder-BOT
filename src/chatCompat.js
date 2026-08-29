'use strict';

/**
 * Robust Protocol & Chat Compatibility Engine for Minecraft 1.21.x / 26.2.
 * Sanitizes chat objects and suppresses non-fatal packet deserialization errors.
 */
function installChatCompat(bot) {
  const client = bot._client;
  if (!client) return;

  function toJsonStringIfNeeded(value) {
    if (value === undefined || value === null) return value;
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch (err) {
      return JSON.stringify({ text: String(value) });
    }
  }

  function toPlainTypeIfNeeded(type) {
    if (typeof type === 'number' || typeof type === 'string') return type;
    if (type && typeof type === 'object') {
      return type.chatType ?? type.type ?? type.id ?? 0;
    }
    return type;
  }

  function sanitizeChatData(data) {
    if (!data || typeof data !== 'object') return;

    if ('senderName' in data) data.senderName = toJsonStringIfNeeded(data.senderName);
    if ('targetName' in data) data.targetName = toJsonStringIfNeeded(data.targetName);
    if ('unsignedContent' in data) data.unsignedContent = toJsonStringIfNeeded(data.unsignedContent);
    if ('formattedMessage' in data) data.formattedMessage = toJsonStringIfNeeded(data.formattedMessage);
    if ('type' in data) data.type = toPlainTypeIfNeeded(data.type);
  }

  client.prependListener('playerChat', sanitizeChatData);
  client.prependListener('systemChat', sanitizeChatData);

  // Suppress non-fatal sound/custom payload packet deserialization warnings
  if (client.deserializer) {
    client.deserializer.on('error', (err) => {
      // Ignored non-fatal sound_effect or custom ad partial packet
    });
  }

  bot._chatCompatInstalled = true;
}

module.exports = { installChatCompat };
