'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const rig=require('../src/material-rig.js'),character=require('../src/character.js');
test('I31 renderer computes receiving material coordinates only for shadow draws',async t=>{
 const {createHarness}=require('./helpers/interaction-fixtures.cjs'),h=await createHarness({idle:false});t.after(()=>h.runtime.destroy());
 const original=rig.localPoint;let calls=0;rig.localPoint=(...args)=>{calls++;return original(...args);};t.after(()=>{rig.localPoint=original;});
 h.renderer.render({referenceMotion:true,lookX:.2,breath:.4},'3942',false,0,false,[{face:'3942',weight:1}]);
 const shadowVertices=h.draws.filter(d=>d.uniforms.u_shadow===1).reduce((n,d)=>n+d.positions.length/2,0);
 assert.ok(calls<=shadowVertices,'non-shadow shader never consumes v_material; do not recompute it for every body/arm/skirt vertex');assert.ok(shadowVertices>0);
});
test('I31 immutable rendering meshes bake fixed neck weights instead of rereading them on each frame',()=>{
 let reads=0;const binding={...character.binding};Object.defineProperty(binding,'neckTransition',{get(){reads++;return character.binding.neckTransition;}});
 const mesh=rig.makeMesh({x:220,y:55,w:140,h:220},8),pose={referenceMotion:true,lookX:.8,lookY:.2,headRoll:.1,bodyRoll:.02,breath:.4};rig.deformMesh(mesh,pose,binding,null);reads=0;
 rig.deformMesh(mesh,{...pose,lookX:-.7},binding,null);assert.equal(reads,0,'fixed neck binding must not be rebuilt per vertex per frame');
});
test('I31 prepared mesh output stays Float32-exact against uncached production points in all nine actions',()=>{
 const ids=['lookAround','hum','stretch','sneeze','peek','doze','bounce','wake','rouse'],parts=[null,...Object.values(character.parts)],meshes=new Map(parts.map(part=>[part,rig.makeMesh({x:20,y:40,w:490,h:750},32)]));
 for(const id of ids){const folder=['wake','rouse'].includes(id)?'gpu-final':'gpu-baseline',states=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../31-交付版集成-V1/revisions/i31-action-completion/evidence',folder,id,'states.json')));
  for(const i of [0,Math.floor(states.length/3),Math.floor(states.length/2),states.length-1]){
   const pose=states[i].pose;
   for(const part of parts){const mesh=meshes.get(part);assert.deepEqual(rig.deformMesh(mesh,pose,character.binding,part),Float32Array.from(Array.from({length:mesh.rest.length/2},(_,i)=>rig.deformPoint([mesh.rest[2*i],mesh.rest[2*i+1]],pose,character.binding,part)).flat()),id+' '+i+' '+part?.name);}
  }
 }
});
