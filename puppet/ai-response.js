'use strict';
// parse(content: object | JSON string | fenced JSON) -> {reply, face, action}.
// Malformed/blank/overlong replies fail closed; unsupported hints are ignored.
const faces = new Set([3901,3942,4006,3599,3831,3523,3861,3711,3751,3791,3496,3625,3665,3563]);
const names = Object.freeze({smile:3901,gentle:3942,calm:3599,curious:3831,angry:3711,sad:3751,surprised:3791,awkward:3496,pout:3665,eyesClosed:3625,slightlySurprised:3563});
function parse(content) {
  try {
    const value = typeof content === 'string'
      ? JSON.parse(content.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1')) : content;
    if (!value || Array.isArray(value) || typeof value.reply !== 'string' || !value.reply.trim() || [...value.reply].length > 4000) throw new Error();
    const emotion = value.emotion;
    const face = Number.isInteger(emotion) && faces.has(emotion) ? emotion :
      typeof emotion === 'string' && emotion.length <= 32 && Object.hasOwn(names, emotion) ? names[emotion] : null;
    return {reply:value.reply.trim(), face, action:['none','blink','hop'].includes(value.action) ? value.action : 'none'};
  } catch { throw new Error('Invalid AI response'); }
}
module.exports = {parse};
