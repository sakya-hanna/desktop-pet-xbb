const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {resolveResource,install}=require('../puppet/resource-protocol');
test('rig entry has external styles and explicit CSP for the secure protocol',()=>{const html=require('node:fs').readFileSync(path.join(__dirname,'../puppet/rig/index.html'),'utf8');assert.doesNotMatch(html,/<style[ >]/i);assert.match(html,/Content-Security-Policy/);assert.match(html,/connect-src 'none'/);});
test('resource URL resolves only immutable rig files inside supplied root',()=>{
 const root=path.resolve('/project/puppet');
 assert.equal(resolveResource('baijie://app/rig/js/app.js?x=1',root),path.join(root,'rig/js/app.js'));
 for(const u of ['https://app/rig/a.png','baijie://other/rig/a.png','baijie://app/main.js','baijie://app/rig/a.exe','baijie://app/rig/%2e%2e/%2e%2e/main.js','baijie://app/rig/%2fetc.png','baijie://user:pass@app/rig/a.png'])assert.equal(resolveResource(u,root),null,u);
});
test('protocol serves only GET rig bytes with strict MIME and CSP, denying symlink escapes',async t=>{
 const fs=require('node:fs'),os=require('node:os');const root=fs.mkdtempSync(path.join(os.tmpdir(),'baijie-resource-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'rig'));fs.writeFileSync(path.join(root,'rig/a.js'),'hello');fs.writeFileSync(path.join(root,'secret.js'),'secret');
 let handler;install({protocol:{handle:(name,fn)=>{assert.equal(name,'baijie');handler=fn;}},root});
 const ok=await handler({method:'GET',url:'baijie://app/rig/a.js'});assert.equal(ok.status,200);assert.equal(await ok.text(),'hello');assert.match(ok.headers.get('content-type'),/javascript/);assert.match(ok.headers.get('content-security-policy'),/connect-src 'none'/);
 assert.equal((await handler({method:'POST',url:'baijie://app/rig/a.js'})).status,405);assert.equal((await handler({method:'GET',url:'baijie://app/main.js'})).status,404);assert.equal((await handler({method:'GET',url:'baijie://app/rig/missing.js'})).status,404);
 if(process.platform!=='win32'){fs.symlinkSync(path.join(root,'secret.js'),path.join(root,'rig/link.js'));assert.equal((await handler({method:'GET',url:'baijie://app/rig/link.js'})).status,404);}
});
