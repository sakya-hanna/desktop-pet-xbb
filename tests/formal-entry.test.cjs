'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
test('formal tests resolve only the explicit historical fixture archive',()=>{
 const {resolveEvidenceRoot}=require('./helpers/interaction-evidence.cjs');
 assert.equal(resolveEvidenceRoot(root),path.resolve(root,'../31-交付版集成-V1/evidence/I1-left-grab-01'));
});
test('formal Electron entry explicitly starts the product even with Electron owning require.main',async()=>{
 const file=path.join(root,'launch.cjs');assert.ok(fs.existsSync(file),'Explicit formal launch.cjs is missing');
 const calls=[],listeners=new Map(),electron={app:{once:(n,f)=>listeners.set(n,f),removeListener:n=>listeners.delete(n),quit:()=>calls.push('quit')},dialog:{showErrorBox:()=>calls.push('dialog')}};
 const load=name=>{if(name==='electron')return electron;if(name==='./product-main.cjs')return {startProduct:options=>{calls.push(options);return Promise.resolve({ready:Promise.resolve(),verified:'product'});}};throw Error('Unexpected import '+name);};load.main={filename:'electron'};
 const module={exports:{}};vm.runInNewContext(fs.readFileSync(file,'utf8'),{require:load,module,exports:module.exports,process:{argv:['electron',file]},console,Promise},{filename:file});
 const result=await module.exports;assert.equal(calls.length,1);assert.equal(calls[0].electron,electron);assert.equal(result.verified,'product');
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'package.json'))).main,'launch.cjs');
});
test('old puppet main forwards only to the one formal entry',()=>{
 const file=path.join(root,'puppet/main.js'),calls=[];
 const load=name=>{calls.push(name);if(name==='../launch.cjs')return Promise.resolve();throw Error('Legacy engine must not load');};
 const source=fs.readFileSync(file,'utf8');assert.ok(source.includes("require('../launch.cjs')"),'Legacy entry still starts its own engine');
 vm.runInNewContext(source,{require:load,module:{exports:{}}});assert.deepEqual(calls,['../launch.cjs']);
});
