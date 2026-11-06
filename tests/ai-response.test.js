const test = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('../puppet/ai-response');
test('parses structured JSON, fenced JSON and objects into a safe response', () => {
  for (const value of [{reply:'你好',emotion:3942,action:'blink'}, '{"reply":"你好","emotion":3942,"action":"blink"}', '```json\n{"reply":"你好","emotion":3942,"action":"blink"}\n```']) {
    assert.deepEqual(parse(value), {reply:'你好',face:3942,action:'blink'});
  }
});

test('whitelists all 14 faces, explicit emotion names and real actions only', () => {
  for (const face of [3901,3942,4006,3599,3831,3523,3861,3711,3751,3791,3496,3625,3665,3563]) assert.equal(parse({reply:'ok',emotion:face}).face,face);
  for (const [name,face] of Object.entries({smile:3901,gentle:3942,calm:3599,curious:3831,angry:3711,sad:3751,surprised:3791,awkward:3496,pout:3665,eyesClosed:3625,slightlySurprised:3563})) assert.equal(parse({reply:'ok',emotion:name}).face,face);
  for (const emotion of [0,9999,'3901','__proto__',{},'x'.repeat(100)]) assert.equal(parse({reply:'ok',emotion}).face,null);
  for (const action of [undefined,'exec','face:3901',{},'constructor']) assert.equal(parse({reply:'ok',action}).action,'none');
  for (const action of ['none','blink','hop']) assert.equal(parse({reply:'ok',action}).action,action);
});
test('rejects malformed replies without echoing input; Unicode bound is 4000 codepoints', () => {
  for (const input of ['secret payload','{',null,[],{}, {reply:123},{reply:'  '},{reply:'🌷'.repeat(4001)}, {reply:'x'.repeat(4001)}]) assert.throws(()=>parse(input),{message:'Invalid AI response'});
  assert.equal(parse({reply:'🌷'.repeat(4000)}).reply,'🌷'.repeat(4000));
  assert.deepEqual(parse({reply:' ok ',emotion:'unknown',action:'delete',tools:['bad']}),{reply:'ok',face:null,action:'none'});
});
