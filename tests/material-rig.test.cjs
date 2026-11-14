'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const target = path.join(__dirname, '../src/material-rig.js');
const binding = { width: 530, height: 800, neck: [298.2, 149.3], hips: [265, 448], headFade: [145, 235], bodyFade: [360, 795] };

test('head response changes the real head region while feet remain planted', () => {
  assert.ok(fs.existsSync(target), 'The new material-space binding has not been implemented');
  const { deformPoint } = require(target);
  assert.deepEqual(deformPoint([298.2, 100], {}, binding), [298.2, 100]);
  const moved = deformPoint([298.2, 100], { headRoll: -0.1, headX: -0.01, bodyRoll: 0.012 }, binding);
  assert.ok(moved[0] < 298.2 - 6, 'Head response must remain readable instead of cancelling into a tiny shift');
  assert.deepEqual(deformPoint([205, 798], { headRoll: -0.1, headX: -0.01, bodyRoll: 0.012 }, binding), [205, 798]);
  assert.deepEqual(deformPoint([298.2, 100], {}, binding), [298.2, 100], 'Deformation must not accumulate');
});

test('a material hair mesh bends at the tips while its root shares the body transform and UVs stay fixed', () => {
  const rig = require(target);
  assert.equal(typeof rig.makeMesh, 'function', 'Material mesh construction is missing');
  assert.equal(typeof rig.deformMesh, 'function', 'Material vertex deformation is missing');
  const part = { name: 'outer-left', root: [199, 194], centerline: [[199,194],[150,290],[70,450]] };
  const mesh = rig.makeMesh({x: 50,y: 194,w: 149,h: 256}, 6, {x:0,y:0,w:530,h:800});
  const rest = Array.from(mesh.rest), uv = Array.from(mesh.uv);
  const pose = {headRoll:-0.1,headX:-0.01,hair:{'outer-left':[0.02,0.04,0.07]}};
  assert.deepEqual(rig.deformPoint(part.root, pose, binding, part), rig.deformPoint(part.root, pose, binding));
  const tip = rig.deformPoint([70,450], pose, binding, part);
  assert.ok(Math.hypot(tip[0]-70,tip[1]-450)>10, 'The local hair motion must be geometrically visible');
  const first = rig.deformMesh(mesh, pose, binding, part);
  rig.deformMesh(mesh, {}, binding, part);
  assert.deepEqual(Array.from(rig.deformMesh(mesh, pose, binding, part)), Array.from(first));
  assert.deepEqual(Array.from(mesh.rest), rest);
  assert.deepEqual(Array.from(mesh.uv), uv, 'No inverse-UV texture sliding');
  assert.ok(Array.from(first).every(Number.isFinite));
});

test('jump preparation lowers the upper body without squashing the face and a hop lifts both feet equally', () => {
  const {deformPoint}=require(target);
  const a=[275,95],b=[320,105],prep={compression:0.016};
  const pa=deformPoint(a,prep,binding),pb=deformPoint(b,prep,binding);
  assert.ok(pa[1]>a[1]+8, 'Preparation must have a real upper-body descent');
  assert.ok(Math.abs(Math.hypot(pa[0]-pb[0],pa[1]-pb[1])-Math.hypot(a[0]-b[0],a[1]-b[1]))<1e-8, 'Do not flatten the face');
  assert.deepEqual(deformPoint([205,798],prep,binding),[205,798]);
  for (const foot of [[205,798],[318,798]]) {
    assert.deepEqual(deformPoint(foot,{hop:0.075},binding),[foot[0],foot[1]-binding.height*0.075]);
  }
});

test('the complete visible root band remains attached, not only one pivot point',()=>{
  const {deformPoint}=require(target);
  const part={name:'front-left',root:[253.34,167.47],rootLockY:169,rootBlendY:185,centerline:[[253.34,167.47],[246,188],[228,210],[238,230]]};
  const pose={headRoll:-0.1,headX:-0.01,hair:{'front-left':[0.04,0.07,0.09]}};
  for(const x of [246,250,254,260])for(const y of [165,167,169]){
    const point=[x,y];
    assert.deepEqual(deformPoint(point,pose,binding,part),deformPoint(point,pose,binding),'Root band must share the parent mapping at '+point);
  }
});
