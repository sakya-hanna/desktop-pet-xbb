'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
test('I2 resources: the enabled right-hand contract resolves its declared mesh and local textures',()=>{
 const meta=JSON.parse(fs.readFileSync(path.join(root,'assets/manifest.json'),'utf8')),r=meta.interaction.rightArm;
 assert.equal(r.enabled,true,'right hand must be enabled by the actual product manifest');
 assert.equal(meta.interaction.leftArm.enabled,true);assert.equal(meta.interaction.skirts.enabled,true);
 const policy=require('../resource-policy.cjs');
 const names=[r.body,r.cloth,r.mesh,...r.parts.map(p=>p.texture)];
 for(const name of names)assert.equal(policy.resolveResource('baijie28://app/assets/'+name,root),path.join(root,'assets',name));
 assert.equal(policy.resolveResource('baijie28://app/assets/unlisted-right.mesh.json',root),null);
 const payload=JSON.parse(fs.readFileSync(path.join(root,'assets',r.mesh),'utf8'));
 for(const part of payload.parts){const mapped=r.parts.find(p=>p.id===part.id);assert.ok(mapped);assert.equal(mapped.source,part.texture.source);assert.deepEqual(meta.images[mapped.texture].size,[part.texture.width,part.texture.height]);}
 assert.equal(r.artApproved,false,'runtime enablement must not claim art acceptance');
});
