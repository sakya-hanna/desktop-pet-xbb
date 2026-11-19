'use strict';
// Self-contained: sandboxed preloads may require Electron, not local Node modules.
const { contextBridge, ipcRenderer } = require('electron');
const finite = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const pair = (v, min, max) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === 2 && finite(v.x, min, max) && finite(v.y, min, max);
const actions = new Set(['hop', 'blink', 'face-next', 'face:auto', 'idle:on', 'idle:off', 'idle:hold', 'idle:release',
  'shell:hide', 'shell:show', 'shell:cancel', 'toolbar:toggle', 'walk:now',
  ...['hum','stretch','sneeze','peek','doze','bounce','wake','rouse','lookAround','care','all','stop'].map(id => `motion:${id}`),
  ...[3496, 3563, 3599, 3625, 3665, 3711, 3751, 3791, 3831, 3901, 3942, 9001, 9002, 9003, 9004, 9005, 9006].map(id => `face:${id}`)]);
function subscribe(channel, callback, accept = () => true) {
  if (typeof callback !== 'function') throw new TypeError('Expected callback');
  const listener = (_event, value) => { if (accept(value)) callback(value); };
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
if (process.isMainFrame) contextBridge.exposeInMainWorld('pet', Object.freeze({
  walk(value) {
    if (!value || !Number.isSafeInteger(value.id) || value.id <= 0 ||
      !['begin','step','end'].includes(value.phase) ||
      Object.keys(value).some(k => !['id','phase','offset'].includes(k)) ||
      (value.phase === 'step' && !finite(value.offset, -10000, 10000))) return;
    ipcRenderer.send('desktop:walk', value);
  },
  drag(dx, dy) {
    if (finite(dx, -10000, 10000) && finite(dy, -10000, 10000)) ipcRenderer.send('drag', { dx, dy });
  },
  resizeBy(factor, anchor) {
    if (!finite(factor, 0.5, 2) || (anchor !== undefined && !pair(anchor, 0, 1))) return;
    ipcRenderer.send('resize-by', anchor === undefined ? factor : { factor, anchor: { x: anchor.x, y: anchor.y } });
  },
  setInteractive(value) { if (typeof value === 'boolean') ipcRenderer.send('interactive', value); },
  menu(point) { if (pair(point, 0, 10000)) ipcRenderer.send('menu', { x: point.x, y: point.y }); },
  ready() { ipcRenderer.send('idle-ready'); },
  feedback(value) {
    if (value === null) { ipcRenderer.send('desktop:feedback', null); return; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const keys = Reflect.ownKeys(value);
    if (!keys.includes('id') || !keys.includes('text')
      || keys.some(key => !['id', 'text', 'durationMs', 'kind'].includes(key))) return;
    const id = Object.getOwnPropertyDescriptor(value, 'id'), text = Object.getOwnPropertyDescriptor(value, 'text');
    const duration = Object.getOwnPropertyDescriptor(value, 'durationMs');
    const kind = Object.getOwnPropertyDescriptor(value, 'kind');
    if (kind && (!Object.hasOwn(kind,'value') || kind.value !== 'chat')) return;
    const chat = kind?.value === 'chat';
    if (!id || !text || !Object.hasOwn(id, 'value') || !Object.hasOwn(text, 'value')
      || !Number.isSafeInteger(id.value) || id.value <= 0 || typeof text.value !== 'string'
      || text.value.length === 0 || [...text.value].length > (chat ? 4000 : 200)
      || (duration && (!Object.hasOwn(duration, 'value') || !Number.isInteger(duration.value)
        || duration.value < 3400 || duration.value > (chat ? 60000 : 15000)))) return;
    const payload = { id: id.value, text: text.value };
    if (chat) payload.kind = 'chat';
    if (duration) payload.durationMs = duration.value;
    ipcRenderer.send('desktop:feedback', payload);
  },
  command(name, value) {
    if (['click-through', 'topmost'].includes(name)) {
      if (typeof value === 'boolean') ipcRenderer.send('desktop:command', { name, value });
    } else if (['hide', 'reset', 'quit', 'chat', 'settings', 'chat-cancel'].includes(name) && value === undefined) {
      ipcRenderer.send('desktop:command', { name });
    }
  },
  getState() { return ipcRenderer.invoke('desktop:get-state'); },
  onAction(callback) { return subscribe('action', callback, value => actions.has(value)); },
  onCursor(callback) { return subscribe('desktop:cursor', callback, value => pair(value, -1000000, 1000000)); },
  onSystemIdle(callback) { return subscribe('desktop:system-idle', callback, value => finite(value, 0, Number.MAX_SAFE_INTEGER)); },
  onChatPresentation(callback) {
    if (typeof callback !== 'function') throw new TypeError('Expected callback');
    const listener = (_event,...args) => {
      if (args.length !== 1) return;
      const value=args[0];
      if (!value || typeof value !== 'object' || Array.isArray(value)) return;
      const keys=Reflect.ownKeys(value);
      if(keys.some(k=>!['id','clear','reply','face','action'].includes(k)||!Object.hasOwn(Object.getOwnPropertyDescriptor(value,k),'value'))
        ||!Number.isSafeInteger(value.id)||value.id<=0)return;
      if(keys.length===2&&value.clear===true){callback({id:value.id,clear:true});return;}
      if(keys.length!==4||!keys.includes('reply')||!keys.includes('face')||!keys.includes('action')
        ||typeof value.reply!=='string'||!value.reply.trim()||[...value.reply].length>4000
        ||!(value.face===null||Number.isSafeInteger(value.face))||!['none','blink','hop'].includes(value.action))return;
      callback({id:value.id,reply:value.reply,face:value.face,action:value.action});
    };
    ipcRenderer.on('chat:presentation',listener);
    return ()=>ipcRenderer.removeListener('chat:presentation',listener);
  },
  onState(callback) { return subscribe('desktop:state', callback); },
  awarenessBusy(value){if(typeof value==='boolean')ipcRenderer.send('awareness:busy',value);},
  awarenessResult(id,accepted){if(Number.isSafeInteger(id)&&id>0&&typeof accepted==='boolean')ipcRenderer.send('awareness:result',id,accepted);},
  awarenessEvent(phase,reason){if(['gesture-started','bubble-sent','response-ended'].includes(phase)&&(reason===undefined||(typeof reason==='string'&&/^[a-z-]{1,40}$/.test(reason))))ipcRenderer.send('awareness:event',{phase,...(reason?{reason}:{})});},
  onAwareness(callback){return subscribe('awareness:present',callback,v=>v&&Number.isSafeInteger(v.id)&&v.id>0&&typeof v.text==='string'&&v.text.length>0&&[...v.text].length<=100&&Object.keys(v).every(k=>['id','text'].includes(k)));},
}));
