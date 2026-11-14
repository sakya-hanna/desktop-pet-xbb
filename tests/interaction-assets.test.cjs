'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {resolveEvidenceRoot}=require('./helpers/interaction-evidence.cjs');
const E=resolveEvidenceRoot(path.resolve(__dirname,'..'));
const tool=path.join(E,'implementation/png-adapter.cjs');
const adapter=fs.existsSync(tool)?require(tool):{};
const B=JSON.parse(fs.readFileSync(path.join(E,'before.json')));
function input(suffix){const f=B.inputs.find(f=>f.path.endsWith(suffix));assert.ok(f);return adapter.decode(fs.readFileSync(path.join(E,f.frozenPath)));}
function realAssembly(){return {source:input('三束补底-无表情无发影.png'),clean:input('layers/clean.png'),arm:input('layers/arm.png'),cloth:input('layers/cloth.png'),rest:input('composites/body-rest.png'),skirt:input('all-skirt-ownership-L.png'),base:adapter.decode(fs.readFileSync(path.join(E,'baseline/assets/baijie-front-body.png'))),outer:['left','right'].map(n=>adapter.decode(fs.readFileSync(path.join(E,'baseline/assets/baijie-outer-'+n+'.png'))))};}
test('I1 A2: real 06 removal/underlay changes only the proven local body support, never five-hair ownership',()=>{
 assert.equal(typeof adapter.assemble,'function','06 must be assembled locally, not laid over the old arm');
 const a=realAssembly(),out=adapter.assemble(a);
 assert.deepEqual([out.body.width,out.body.height],[530,800]);
 assert.ok(out.report.sourceChanged>100000);assert.equal(out.report.outerOverlap,0);
 assert.ok(out.report.replaced>5000);assert.equal(out.report.unprotectedChanges,0);
 assert.ok(out.report.clothSkirtIntersection>0,'cloth/skirt ownership conflict must be measured, skirt stays static');
 const clean=adapter.resize(a.clean,530,800);
 for(let i=0;i<out.body.data.length;i+=4){const expected=out.support[i/4]?clean.data:a.base.data;assert.deepEqual([...out.body.data.subarray(i,i+4)],[...expected.subarray(i,i+4)]);}
 assert.equal(out.report.originalPngChanges,0);
});
test('I1 A4: runtime rejects malformed real author meshes and failed loads without falling back to a fake old arm',async()=>{
 const {createHarness}=require('./helpers/interaction-fixtures.cjs');
 const mutations={index:m=>{m.triangles[0][0]=1308;},fractionIndex:m=>{m.triangles[0][0]=0.5;},uv:m=>{m.vertices[0].uv[0]=2;},uvMapping:m=>{m.vertices[0].uv[0]+=0.01;},weights:m=>{m.vertices[0].weights=[0,0,0];},negativeWeight:m=>{m.vertices[0].weights=[-1,1,1];},canvas:m=>{m.canvas=[530,800];},nan:m=>{m.vertices[0].xy[0]=NaN;},oldMesh:m=>{m.vertices.length=1301;},order:m=>{m.weight_order.reverse();},palm:m=>{m.vertices.find(v=>v.xy[1]>=1703).weights=[0.1,0,0.9];},degenerate:m=>{m.triangles[0]=[0,0,0];}};
 for(const [name,mutateMesh]of Object.entries(mutations))await assert.rejects(createHarness({mutateMesh}),/Invalid left-arm mesh/,name+' must fail before GL/runtime start');
 await assert.rejects(createHarness({failMesh:true}),/Failed to load left-arm mesh/);
 await assert.rejects(createHarness({badImage:'baijie-arm-screen-left.png'}),/Unexpected texture size/);
 await assert.rejects(createHarness({failImage:'baijie-arm-screen-left.png'}),/image decode failed/);
 const ok=await createHarness({idle:false});ok.runtime.start();assert.ok(ok.draws.some(d=>d.texture==='baijie-arm-screen-left.png'));ok.runtime.destroy();
});
// Verification-only: compare produced assets with real frozen pixels, not fixtures.
test('I1 V3: delivered PNG/mesh bytes and local body reproduce the selected provenance and protection proof',()=>{
 const crypto=require('node:crypto'),S=path.resolve(__dirname,'..'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
 for(const [name,suffix]of [['baijie-arm-screen-left.png','layers/arm.png'],['baijie-arm-screen-left-cloth.png','layers/cloth.png'],['baijie-arm-screen-left.mesh.json','arm-triangle-mesh.json']])assert.equal(hash(fs.readFileSync(path.join(S,'assets',name))),B.inputs.find(f=>f.path.endsWith(suffix)).sha256);
 const actual=adapter.decode(fs.readFileSync(path.join(S,'assets/baijie-arm-screen-left-body.png'))),out=adapter.assemble(realAssembly());assert.equal(Buffer.compare(Buffer.from(actual.data),Buffer.from(out.body.data)),0);
 assert.equal(out.report.sourceStackVs06Rest.pixels,0);assert.equal(out.report.sourceStackVs06Rest.alphaChanges,0);assert.equal(out.report.outerOverlap,0);assert.equal(out.report.unprotectedChanges,0);
 for(const f of B.candidate.filter(f=>f.path.endsWith('.png')))assert.equal(hash(fs.readFileSync(path.join(S,f.path))),f.sha256,'immutable existing PNG '+f.path);
 const meta=JSON.parse(fs.readFileSync(path.join(S,'assets/manifest.json')));assert.equal(meta.interaction.rightArm.enabled,true);assert.equal(meta.interaction.rightArm.id,'arm-screen-right');assert.equal(meta.interaction.skirts.enabled,true);
 const broken=fixturePNG();broken[40]^=1;assert.throws(()=>adapter.decode(broken),/PNG/);
 console.log('I1_ASSEMBLY '+JSON.stringify(out.report));
});
// Independent tiny RGBA PNG fixture; hidden red must not contaminate blue.
function fixturePNG(){
 const crc=b=>{let c=0xffffffff;for(const v of b){c^=v;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
 const chunk=(name,b)=>{const h=Buffer.from(name),n=Buffer.alloc(4),c=Buffer.alloc(4);n.writeUInt32BE(b.length);c.writeUInt32BE(crc(Buffer.concat([h,b])));return Buffer.concat([n,h,b,c]);};
 const ih=Buffer.alloc(13);ih.writeUInt32BE(2);ih.writeUInt32BE(1,4);ih[8]=8;ih[9]=6;
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ih),chunk('IDAT',zlib.deflateSync(Buffer.from([0,255,0,0,0,0,0,255,255]))),chunk('IEND',Buffer.alloc(0))]);
}
test('I1 A1: PNG adaptation downsamples in premultiplied alpha without hidden-colour bleed',()=>{
 assert.equal(typeof adapter.decode,'function','offline adapter must decode the selected PNGs');
 const src=adapter.decode(fixturePNG());assert.deepEqual([src.width,src.height],[2,1]);
 const out=adapter.resize(src,1,1);assert.deepEqual([...out.data],[0,0,255,128]);
 assert.deepEqual([...adapter.decode(adapter.encode(out)).data],[0,0,255,128]);
 assert.deepEqual([...adapter.resize(src,2,1).data],[255,0,0,0,0,0,255,255],'identity preserves source bytes');
});
test('I1 private evidence: main and revision candidate layouts resolve the same fixed evidence sibling without cwd fallback',()=>{
 const file=path.join(__dirname,'helpers/interaction-evidence.cjs'),locator=fs.existsSync(file)?require(file):{};
 assert.equal(typeof locator.resolveEvidenceRoot,'function','private evidence locator must support the main candidate layout');
 const workspace=path.join(path.parse(__dirname).root,'baijie-evidence-test-workspace'),expected=path.join(workspace,'evidence','I1-left-grab-01');
 assert.equal(locator.resolveEvidenceRoot(path.join(workspace,'candidate')),expected);
 assert.equal(locator.resolveEvidenceRoot(path.join(workspace,'revisions','isolated-test','candidate')),expected);
 assert.throws(()=>locator.resolveEvidenceRoot('candidate'),/Absolute candidate directory required/);
 assert.throws(()=>locator.resolveEvidenceRoot(path.join(workspace,'not-a-candidate')),/Absolute candidate directory required/);
 assert.throws(()=>locator.resolveEvidenceRoot(null),/Absolute candidate directory required/);
});
