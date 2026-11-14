'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {root,E}=require('./helpers/interaction-fixtures.cjs');
const prep=path.join(path.dirname(E),'I3-skirt-grab-01');
function image(width,height,pixel){const data=new Uint8Array(width*height*4);for(let i=0;i<width*height;i++)data.set(pixel(i%width,Math.floor(i/width)),i*4);return {width,height,data};}
test('I3 resources: move skirt ownership out of body and fixed cloth without altering other pixels or inputs',()=>{
 const {assemble}=require(path.join(prep,'resource-assembly.cjs'));
 const base=image(2,1,x=>x?[10,20,30,255]:[200,40,20,255]);
 const front=image(4,2,x=>x<2?[200,40,20,255]:[0,0,0,0]),empty=image(4,2,()=>[0,0,0,0]);
 const donor=image(4,2,x=>x<2?[80,90,100,255]:[0,0,0,0]);
 const cloth=image(4,2,x=>x<2?[200,40,20,255]:[1,2,3,120]);
 const baseBefore=new Uint8Array(base.data),clothBefore=new Uint8Array(cloth.data);
 const out=assemble({base,skirts:[front,empty,empty],cloths:[cloth,cloth],underlay:donor});
 assert.deepEqual([...out.body.data],[80,90,100,255,10,20,30,255]);
 assert.deepEqual([...out.support],[1,0]);
 for(const result of out.cloths)for(let y=0;y<2;y++)for(let x=0;x<4;x++){const i=(y*4+x)*4;if(x<2)assert.equal(result.data[i+3],0);else assert.deepEqual(result.data.slice(i,i+4),cloth.data.slice(i,i+4));}
 assert.deepEqual(base.data,baseBefore);assert.deepEqual(cloth.data,clothBefore);
 assert.equal(out.report.artApproved,false);assert.equal(out.report.underlayComplete,false);
});
test('I3 resources: enabled real skirt assets resolve and remove duplicate fixed ownership only inside the new support',()=>{
 const meta=JSON.parse(fs.readFileSync(path.join(root,'assets/manifest.json'))),config=meta.interaction.skirts;
 assert.equal(config.enabled,true);assert.equal(config.artApproved,false);assert.equal(config.underlayComplete,false);
 assert.deepEqual(config.parts.filter(p=>p.grab).map(p=>p.id).sort(),['skirt-front','skirt-right']);
 const policy=require('../resource-policy.cjs'),png=require(path.join(path.dirname(E),'I2-right-resource-pack-01/codec.cjs'));
 const read=name=>png.decode(fs.readFileSync(path.join(root,'assets',name)));
 for(const name of [config.body,config.leftCloth,config.rightCloth,...config.parts.flatMap(p=>[p.texture,p.mesh])])assert.equal(policy.resolveResource('baijie28://app/assets/'+name,root),path.join(root,'assets',name));
 assert.equal(policy.resolveResource('baijie28://app/assets/unlisted-skirt.mesh.json',root),null);
 const parts=config.parts.map(p=>{const data=JSON.parse(fs.readFileSync(path.join(root,'assets',p.mesh)));assert.equal(p.id,data.part);assert.equal(p.source,data.texture.source);assert.deepEqual(meta.images[p.texture].size,[data.texture.width,data.texture.height]);return read(p.texture);});
 const base=read(meta.interaction.rightArm.body),body=read(config.body),oldCloths=[meta.interaction.leftArm.cloth,meta.interaction.rightArm.cloth].map(read),newCloths=[config.leftCloth,config.rightCloth].map(read);
 const w=parts[0].width,h=parts[0].height,support=new Uint8Array(base.width*base.height);let owned=0,residual=0,outsideClothChanges=0,outsideBodyChanges=0;
 for(let k=0;k<w*h;k++){const i=k*4,isOwned=parts.some(p=>p.data[i+3]>0);if(isOwned){owned++;const x=k%w,y=Math.floor(k/w);for(let yy=Math.floor(y*base.height/h);yy<Math.ceil((y+1)*base.height/h);yy++)for(let xx=Math.floor(x*base.width/w);xx<Math.ceil((x+1)*base.width/w);xx++)support[yy*base.width+xx]=1;}
  for(let n=0;n<2;n++){if(isOwned){if(newCloths[n].data[i+3])residual++;}else for(let c=0;c<4;c++)if(newCloths[n].data[i+c]!==oldCloths[n].data[i+c])outsideClothChanges++;}
 }
 for(let k=0;k<support.length;k++)if(!support[k])for(let c=0;c<4;c++)if(body.data[k*4+c]!==base.data[k*4+c])outsideBodyChanges++;
 assert.ok(owned>0);assert.equal(residual,0,'old fixed cloth must not leave another baked copy of a moving skirt');assert.equal(outsideClothChanges,0);assert.equal(outsideBodyChanges,0,'new body may not touch face, arms or other pixels outside skirt support');
});
