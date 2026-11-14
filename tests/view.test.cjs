'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const target=path.join(__dirname,'../src/view.js');
const {binding,keyframes}=require('../src/character.js');
const {deformPoint}=require('../src/material-rig.js');
test('review cameras keep the jump apex head visible without changing the default character scale',()=>{
  assert.ok(fs.existsSync(target),'Shared camera mapping is missing');
  const {cameraFor}=require(target);
  const normal=cameraFor(240,348,false,binding);
  assert.ok(Math.abs(binding.height/normal.h*348-348*0.8)<1e-10);
  const detail=cameraFor(440,448,true,binding);
  for(const frame of keyframes)for(const p of [[250,0],[300,0],[345,0],[252,137],[344,137]]){
    const point=deformPoint(p,frame.pose,binding);
    assert.ok(point[0]>detail.x&&point[0]<detail.x+detail.w&&point[1]>detail.y&&point[1]<detail.y+detail.h,'Clipped head in '+frame.id);
  }
});
