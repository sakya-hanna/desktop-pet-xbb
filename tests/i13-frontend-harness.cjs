'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
// Narrow VM adaptation of legacy tests/helpers/chat-harness.cjs; no Electron or IO API.
class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName; this.listeners = {}; this.children = [];
    this.attributes = {}; this.style = {}; this.value = ''; this.textContent = '';
    this.disabled = false; this.hidden = false; this.open = false; this.checked = false;
    this.scrollTop = 0; this.scrollHeight = 1000; this.clientHeight = 300;
  }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  set innerHTML(_) { throw Error('unsafe HTML assignment'); }
  focus() { this.focused = true; }
  showModal() { this.open = true; }
  close() { this.open = false; }
}
const source = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const flush = () => new Promise(setImmediate);
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; }
async function boot(kind, api = {}) {
  const ids = [...source(kind + '.html').matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
  const nodes = Object.fromEntries(ids.map(id => [id, new Element()]));
  const window = new Element();
  window[kind] = api;
  vm.runInNewContext(source(kind + '.js'), {
    document: {getElementById: id=>nodes[id],createElement:tag=>new Element(tag)}, window,
  }, {filename: kind + '.js'});
  await flush();
  const fire = (id, name, event={}) => nodes[id].listeners[name]?.({preventDefault(){},...event});
  return {nodes,window,fire,input:nodes['message-input'],submit:()=>fire(kind==='chat'?'composer':'settings-form','submit')};
}
const rows = ui => ui.nodes.messages.children.map(item=>({role:item.className.split(' ')[1],text:item.children.find(n=>n.className==='message-text').textContent}));
const state = (messages=[], outcome, model='configured') => ({messages,model,pending:false,...(outcome?{outcome}:{})});
module.exports = {boot,source,rows,state,deferred,flush};
