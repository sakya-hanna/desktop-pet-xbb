const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName; this.listeners = {}; this.children = [];
    this.attributes = {}; this.style = {}; this.value = ''; this.textContent = '';
    this.disabled = false; this.hidden = false; this.open = false;
    this.scrollTop = 0; this.scrollHeight = 1000; this.clientHeight = 300;
  }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  focus() { this.focused = true; }
  showModal() { this.open = true; }
  close() { this.open = false; }
}
const ids = ['messages', 'message-input', 'send', 'composer', 'status', 'count', 'clear', 'clear-dialog', 'clear-cancel', 'clear-confirm', 'cancel', 'model-state', 'empty-state'];
const source = name => fs.readFileSync(path.join(__dirname, '../../puppet', name), 'utf8');
async function boot(api = {}) {
  const nodes = Object.fromEntries(ids.map(id => [id, new Element()]));
  nodes.status.textContent = source('chat.html').match(/id="status"[^>]*>([^<]*)/)?.[1] || '';
  nodes['empty-state'].hidden = true;
  const chat = { read: async () => ({ messages: [], model: 'unconfigured' }), ...api };
  vm.runInNewContext(source('chat.js'), {
    document: { getElementById: id => nodes[id], createElement: tag => new Element(tag) },
    window: { chat },
  });
  await new Promise(setImmediate);
  return { nodes, input: nodes['message-input'], submit: () => nodes.composer.listeners.submit({ preventDefault() {} }) };
}
const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);
module.exports = { boot, source, descendants };
