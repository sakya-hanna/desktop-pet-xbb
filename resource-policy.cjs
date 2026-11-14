'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const SCHEME = 'baijie28';
const ENTRY_URL = `${SCHEME}://app/desktop.html`;
const SOURCE_FILES = ['desktop-bootstrap', 'desktop-view', 'character-renderer', 'desktop-runtime',
  'character', 'response-config', 'reference-motion', 'director', 'material-rig', 'view', 'hit-test'];
let allowed;
// Importing session/feedback policy does not require private character assets.
// Loading resources still requires the same checked, exact-name manifest.
function allowedResources() {
  if (allowed) return allowed;
  assertNoSymlinks(path.join(__dirname, 'assets/manifest.json'));
  const artwork = Object.keys(require('./assets/manifest.json').images)
    .filter(name => /^baijie-[a-z0-9-]+\.png$/.test(name));
  allowed = new Set(['chat.html', 'chat.js', 'chat.css', 'settings.html', 'settings.js', 'settings.css', 'assets/chat/baijie-avatar.png', 'feedback.html', 'feedback.css', 'src/feedback-view.js', 'desktop.html', 'desktop.css', 'assets/manifest.json', 'assets/baijie-arm-screen-left.mesh.json', 'assets/baijie-arm-screen-right.mesh.json', 'assets/baijie-skirt-front.mesh.json', 'assets/baijie-skirt-right.mesh.json', 'assets/baijie-skirt-back-visible-center.mesh.json',
    ...SOURCE_FILES.map(name => `src/${name}.js`), ...artwork.map(name => `assets/${name}`)]);
  return allowed;
}
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; worker-src 'none'";
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png' };

/** Reject any symlink/junction component, including a linked candidate/profile root. */
function assertNoSymlinks(target, { allowMissing = false, fsImpl = fs } = {}) {
  const absolute = path.resolve(target), parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let info;
    try { info = fsImpl.lstatSync(current); }
    catch (error) { if (allowMissing && error.code === 'ENOENT') continue; throw error; }
    if (info.isSymbolicLink()) throw new Error('Symlink/junction paths are forbidden');
  }
  return absolute;
}


// Inspect only this target profile, never appData siblings or file contents.
// Missing root is allowed; an entry disappearing during traversal is not.
function assertProfileTree(target, { fsImpl = fs } = {}) {
  let rootInfo;
  try { rootInfo = fsImpl.lstatSync(target); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  const pending = [[target, rootInfo]];
  while (pending.length) {
    const [file, info] = pending.pop();
    if (info.isSymbolicLink()) throw new Error('Profile symlink/junction descendants are forbidden');
    if (info.isDirectory()) {
      for (const name of fsImpl.readdirSync(file)) {
        const child = path.join(file, name);
        pending.push([child, fsImpl.lstatSync(child)]);
      }
    } else if (file === target || !info.isFile()) throw new Error('Unsafe profile data type');
  }
}

// Resolve the existing directory ancestor physically, then append only the
// already syntax-validated missing tail. Never create directories to resolve it.
function physicalDirectory(target, fsImpl) {
  let ancestor = path.resolve(target);
  const tail = [];
  while (true) {
    let info;
    try { info = fsImpl.lstatSync(ancestor); }
    catch (error) {
      const parent = path.dirname(ancestor);
      if (error.code !== 'ENOENT' || parent === ancestor) throw error;
      tail.unshift(path.basename(ancestor)); ancestor = parent; continue;
    }
    if (info.isSymbolicLink()) throw new Error('Symlink/junction paths are forbidden');
    if (!info.isDirectory()) throw new Error('Product path ancestor must be a directory');
    return path.join(fsImpl.realpathSync.native(ancestor), ...tail);
  }
}

/** Check the supplied spelling before path.resolve can erase unsafe components. */
function productPath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('Explicit absolute product path required');
  const parsed = path.parse(value);
  if (path.sep === '\\' && !/^[a-z]:[\\/]$/i.test(parsed.root))
    throw new Error('Product paths require a local absolute drive root');
  const parts = value.slice(parsed.root.length).split(/[\\/]/).filter(Boolean);
  if (parts.some(part => part === '.' || part === '..' || /[:<>"|?*\x00-\x1f\x7f]|[. ]$/.test(part)
    || /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?: *\.|$)/i.test(part)))
    throw new Error('Unsafe product path component');
  return path.resolve(value);
}

function validateProfile({ root, profileRoot, mode = 'hidden', storageLayout = 'candidate', appDataRoot, fsImpl = fs }) {
  if (!['hidden', 'visible'].includes(mode)) throw new TypeError('Invalid mode');
  if (!['candidate', 'product'].includes(storageLayout)) throw new TypeError('Invalid storage layout');
  if (typeof root !== 'string' || !path.isAbsolute(root) || path.resolve(root) !== path.resolve(__dirname))
    throw new Error('Candidate root path must be this batch candidate');
  const batch = path.dirname(path.resolve(root));
  if (storageLayout === 'product') {
    productPath(root); appDataRoot = productPath(appDataRoot);
    if (profileRoot !== undefined) productPath(profileRoot);
    const contains = (parent, child) => {
      const relative = path.relative(parent, child);
      return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
    };
    if (contains(root, appDataRoot) || contains(appDataRoot, root))
      throw new Error('Resource and app-data trees must not overlap');
    assertNoSymlinks(root, { fsImpl });
    assertNoSymlinks(appDataRoot, { allowMissing: true, fsImpl });
    const physicalRoot = physicalDirectory(root, fsImpl);
    const physicalData = physicalDirectory(appDataRoot, fsImpl);
    if (contains(physicalRoot, physicalData) || contains(physicalData, physicalRoot))
      throw new Error('Resource and app-data trees must not overlap physically');
  }
  const interactive = storageLayout === 'product' ? path.join(appDataRoot, 'BaijieDesktopV1') : path.join(batch, 'runtime/interactive');
  if (mode === 'visible' && profileRoot === undefined) profileRoot = interactive;
  if (typeof profileRoot !== 'string' || !path.isAbsolute(profileRoot) || profileRoot.includes('\0'))
    throw new Error('Explicit absolute hidden profile path required');
  if (storageLayout === 'product') productPath(profileRoot);
  const resolved = path.resolve(profileRoot);
  const inside = parent => {
    const relative = path.relative(parent, resolved);
    return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  };
  if (mode === 'visible' ? resolved !== interactive
    : !(storageLayout === 'product' ? inside(path.join(appDataRoot, 'BaijieDesktopV1-Tests'))
      : inside(path.join(batch, 'runtime/tests')) || inside(path.join(batch, 'evidence'))))
    throw new Error('Profile path is outside this batch isolated mode directory');
  if (resolved.slice(path.parse(resolved).root.length).split(path.sep).some(part => /[:\x00-\x1f]|[. ]$/.test(part)))
    throw new Error('Unsafe profile path component');
  assertNoSymlinks(root, { fsImpl });
  assertNoSymlinks(resolved, { allowMissing: true, fsImpl });
  if (storageLayout === 'product') {
    for (const resource of [...allowedResources(), 'desktop-preload.cjs', 'feedback-preload.cjs', 'chat-preload.js', 'settings-preload.js', 'persona.md', 'shared/tray.png'])
      assertNoSymlinks(path.join(root, resource), { fsImpl });
    for (const child of ['userData', 'sessionData', 'logs', 'temp', 'window-state.json'])
      assertNoSymlinks(path.join(resolved, child), { allowMissing: true, fsImpl });
  }
  return resolved;
}

function resolveResource(value, root) {
  if (typeof value !== 'string' || !value.startsWith(`${SCHEME}://app/`)) return null;
  const name = value.slice(`${SCHEME}://app/`.length);
  // Exact names reject percent-encoding, query, fragments and traversal BEFORE URL normalization.
  if (!allowedResources().has(name)) return null;
  try {
    const file = path.resolve(root, name);
    assertNoSymlinks(file);
    return fs.statSync(file).isFile() ? file : null;
  } catch { return null; }
}

function installResources({ protocol, root }) {
  assertNoSymlinks(root);
  allowedResources();
  protocol.handle(SCHEME, request => {
    if (request.method !== 'GET') return new Response(null, { status: 405 });
    const file = resolveResource(request.url, root);
    if (!file) return new Response(null, { status: 404 });
    try {
      // No net.fetch/file redirect: only bytes from a checked whitelisted local file.
      const bytes = fs.readFileSync(file);
      return new Response(bytes, { headers: {
        'Content-Type': MIME[path.extname(file)], 'Content-Security-Policy': CSP,
        'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
      } });
    } catch { return new Response(null, { status: 404 }); }
  });
  let removed = false;
  return () => { if (!removed) { removed = true; protocol.unhandle(SCHEME); } };
}

// Electron exposes setter-only request/permission policy APIs. Never overwrite
// a shared session: allocate a fresh unguessable in-memory partition per boot.
// The WeakMap is our ownership record, not an invented Electron handler getter.
const sessionOwnership = new WeakMap();
function createOwnedSession(sessionModule) {
  if (typeof sessionModule?.fromPartition !== 'function') throw new Error('Independent session API required');
  const session = sessionModule.fromPartition(`baijie28-${randomUUID()}`, { cache: false });
  if (!session || typeof session !== 'object' || session === sessionModule.defaultSession || sessionOwnership.has(session))
    throw new Error('A fresh independent session is required');
  sessionOwnership.set(session, 'fresh');
  return session;
}
function assertSessionPolicy(session) {
  if (sessionOwnership.get(session) !== 'active') throw new Error('An owned session with active policy is required');
}

function installPolicy({ session, root }) {
  if (sessionOwnership.get(session) !== 'fresh') throw new Error('Policy requires a fresh owned session');
  sessionOwnership.set(session, 'installing');
  const undo = [], cleanupErrors = [];
  let removed = false;
  function remove() {
    if (removed) return cleanupErrors; removed = true;
    sessionOwnership.set(session, 'retired');
    for (const release of undo.reverse()) {
      try { release(); } catch (error) { cleanupErrors.push(error); }
    }
    return cleanupErrors;
  }
  function acquire(set, value) {
    // Reserve rollback before calling a setter: it can mutate, then throw.
    undo.push(() => set(null)); set(value);
  }
  try {
    acquire(fn => session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, fn), (details, callback) => {
      callback({ cancel: resolveResource(details.url, root) === null });
    });
    acquire(fn => session.setPermissionRequestHandler(fn), (_contents, _permission, callback) => callback(false));
    acquire(fn => session.setPermissionCheckHandler(fn), () => false);
    acquire(fn => session.setDevicePermissionHandler(fn), () => false);
    acquire(fn => session.setDisplayMediaRequestHandler(fn), (_request, callback) => callback({}));
    const preventDownload = event => event.preventDefault();
    undo.push(() => session.removeListener('will-download', preventDownload));
    session.on('will-download', preventDownload);
    sessionOwnership.set(session, 'active');
    return remove;
  } catch (error) { remove(); throw error; }
}
module.exports = { SCHEME, ENTRY_URL, CSP, resolveResource, assertNoSymlinks, assertProfileTree, validateProfile,
  createOwnedSession, assertSessionPolicy, installResources, installPolicy };
