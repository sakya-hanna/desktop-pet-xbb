'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const target=path.join(__dirname,'../src/hit-test.js');
const {makeMesh,deformMesh}=require('../src/material-rig.js'),{binding,keyframes}=require('../src/character.js');
test('pointer picking uses the same deformed triangles and returns their original material point',()=>{
  assert.ok(fs.existsSync(target),'Rendered-triangle picking has not been implemented');
  const {pickMaterial}=require(target),mesh=makeMesh({x:240,y:30,w:110,h:115},5);
  for(const frame of keyframes){
    const positions=deformMesh(mesh,frame.pose,binding),ids=Array.from(mesh.indices.slice(135,138));
    const point=[0,0],expected=[0,0];
    for(const i of ids)for(let d=0;d<2;d++){point[d]+=positions[i*2+d]/3;expected[d]+=mesh.rest[i*2+d]/3;}
    const hit=pickMaterial(mesh,positions,point);assert.ok(hit);
    assert.ok(Math.hypot(hit[0]-expected[0],hit[1]-expected[1])<1e-4,frame.id);
    assert.equal(pickMaterial(mesh,positions,[-1000,-1000]),null);
  }
});
