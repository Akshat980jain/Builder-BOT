'use strict';

/**
 * Fixes two real bugs, verified against the actual installed library source
 * (mineflayer@4.37.1 / minecraft-protocol@1.68.0), not just their symptoms:
 *
 * 1. "[object Object]" is not valid JSON — mineflayer's own chat.js plugin
 *    (lib/plugins/chat.js, the `playerChat` handler) calls JSON.parse() on
 *    `data.senderName` / `data.targetName` / `message` unconditionally,
 *    assuming they're always JSON strings. minecraft-protocol is *supposed*
 *    to normalize NBT-formatted chat into a JSON string first (via
 *    prismarine-chat's processNbtMessage, confirmed present and correct in
 *    the installed version) — but depending on how a version's protocol
 *    schema types a given field (and how ViaProxy's translation shapes the
 *    resulting packet), that normalization can be skipped, leaving an
 *    already-parsed object where mineflayer expects a string.
 *
 * 2. "unknown chat format code: [object Object]" — prismarine-chat's
 *    ChatMessage.fromNetwork(type, params) expects `type` to be a plain
 *    number (a registry index). mineflayer's chat.js already *tries* to
 *    unwrap this via `data.type.chatType`, but if the actual object shape
 *    differs (e.g. no `.chatType` key), that unwrap silently fails and the
 *    raw object gets passed through, crashing one level deeper.
 *
 * FIX APPROACH: rather than patching node_modules (fragile — gets wiped on
 * every `npm install`, breaks on every dependency bump), we register our own
 * listener on the *raw* minecraft-protocol client object using
 * `prependListener`, which Node's EventEmitter guarantees runs BEFORE
 * already-registered listeners — including mineflayer's own chat.js
 * listener, which is already attached by the time `mineflayer.createBot()`
 * returns. This sanitizes the data in place so that by the time mineflayer's
 * own (unmodified) code runs, everything is in the shape it expects.
 */
function installChatCompat(bot) {
  const client = bot._client;

  function toJsonStringIfNeeded(value) {
    if (value === undefined || value === null) return value;
    if (typeof value === 'string') return value; // already fine
    try {
      return JSON.stringify(value);
    } catch (err) {
      bot.emit('chatcompat_warning', `Failed to stringify chat field: ${err.message}`);
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

  bot._chatCompatInstalled = true;
}

module.exports = { installChatCompat };
