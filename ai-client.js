'use strict';
const http = require('node:http');
const https = require('node:https');
const {parse} = require('./ai-response');
const networkCodes=new Set(['ENOTFOUND','EAI_AGAIN','ECONNREFUSED','ECONNRESET','ETIMEDOUT','ENETUNREACH','EHOSTUNREACH','EPIPE','CERT_HAS_EXPIRED','ERR_TLS_CERT_ALTNAME_INVALID','UNABLE_TO_VERIFY_LEAF_SIGNATURE','SELF_SIGNED_CERT_IN_CHAIN','DEPTH_ZERO_SELF_SIGNED_CERT']);
function transportFailure(nativeError){
  const error=new Error('AI request failed');
  if(networkCodes.has(nativeError?.code))error.code=nativeError.code;
  return error;
}
// Main-only: request({config:store.getRequestConfig(),messages,system,signal,
// timeoutMs=30000}) -> Promise<{reply,face,action}>. Parent owns static system
// prompt, generation/discard policy and AbortController. Never expose config
// or accept a renderer URL/headers. Root -> /chat/completions; /v1 is preserved.
// Only user/assistant {role,content} history, 1..40 messages; max 4000 Unicode
// codepoints/message and 32000 total. Static system: 1..16000 UTF-16 units.
// Timeout: integer 1..300000 ms, total including response body (default 30000).
// Response cap: 262144 bytes; no redirects, tools, arbitrary headers or retries.
// Keyless endpoints omit Authorization. Invalid responses fail closed.
// All errors have fixed/sanitized messages (HTTP status only); cancellation is
// Error with name='AbortError'. Parent must handle errors and ignore stale replies.
async function request({config,messages,system,signal,timeoutMs=30000}) {
  let url,body;
  try {
    if (!config || typeof config.baseUrl !== 'string' || config.baseUrl.length > 2048 || !/^https?:\/\/[^/]/i.test(config.baseUrl) || /[\s?#\\]/u.test(config.baseUrl) || config.baseUrl.split('/')[2].includes('@')) throw new Error();
    url=new URL(config.baseUrl.replace(/\/+$/,'')+'/chat/completions');
    const loopback=url.hostname==='localhost' || url.hostname==='[::1]' || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
    if (!['http:','https:'].includes(url.protocol) || (url.protocol==='http:' && !loopback) || url.username || url.password) throw new Error();
    if (typeof config.model!=='string' || !config.model.trim() || config.model.length>200 || /[\x00-\x1f\x7f]/.test(config.model)) throw new Error();
    if (typeof config.apiKey!=='string' || config.apiKey.length>4096 || /[^\x21-\x7e]/.test(config.apiKey)) throw new Error();
    if (typeof system!=='string' || !system.trim() || system.length>16000 || !Number.isInteger(timeoutMs) || timeoutMs<1 || timeoutMs>300000) throw new Error();
    if (signal !== undefined && !(signal instanceof AbortSignal)) throw new Error();
    if (!Array.isArray(messages) || !messages.length || messages.length>40) throw new Error();
    let total=0;
    const rows=messages.map(row=>{
      if (!row || !['user','assistant'].includes(row.role) || typeof row.content!=='string' || !row.content.trim()) throw new Error();
      const length=[...row.content].length;total+=length;
      if (length>4000 || total>32000) throw new Error();
      return {role:row.role,content:row.content};
    });
    body=JSON.stringify({model:config.model,messages:[{role:'system',content:system},...rows],stream:false});
  } catch { throw new Error('Invalid AI request'); }
  return new Promise((resolve,reject)=>{
    let req,timer,settled=false;
    function finish(error,result) {
      if(settled) return;
      settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);
      if(error){req?.destroy();reject(error);}else resolve(result);
    }
    function cancel() {const error=new Error('AI request cancelled');error.name='AbortError';finish(error);}
    if(signal?.aborted){cancel();return;}
    signal?.addEventListener('abort',cancel,{once:true});
    timer=setTimeout(()=>finish(new Error('AI request timed out')),timeoutMs);
    try {
      const headers={'Content-Type':'application/json'};
      if(config.apiKey) headers.Authorization=`Bearer ${config.apiKey}`;
      req=(url.protocol === 'https:' ? https : http).request(url,{method:'POST',headers},res=>{
        res.on('error',error=>finish(transportFailure(error)));
        res.on('aborted',()=>finish(new Error('AI request failed')));
        if (res.statusCode < 200 || res.statusCode >= 300) {finish(new Error(`AI endpoint returned HTTP ${res.statusCode}`));res.destroy();return;}
        const chunks=[];let bytes=0;
        res.on('data',c=>{bytes+=c.length;if(bytes>262144){finish(new Error('AI response too large'));res.destroy();}else chunks.push(c);});
        res.on('end',()=>{
          try { finish(null,parse(JSON.parse(Buffer.concat(chunks).toString('utf8')).choices[0].message.content)); }
          catch { finish(new Error('Invalid AI response')); }
        });
      });
      req.on('error',error=>finish(transportFailure(error)));req.end(body);
    } catch(error) { finish(transportFailure(error)); }
  });
}
module.exports = {request};
