'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict');
test('I22 retained action targets and durations match Qianhuili 1e7a0b1 ANIMS',()=>{
 const file=path.resolve(__dirname,'../src/reference-motion.js');assert.ok(fs.existsSync(file),'reference action module is missing');
 const {scores,catalog}=require(file),text=fs.readFileSync(path.resolve(__dirname,'../../../references/chieri-live2d-source/js/app.js'),'utf8');
 const begin=text.indexOf('const ANIMS = {'),end=text.indexOf('\nfunction startAnim',begin);assert.ok(begin>0&&end>begin);
 const c=vm.createContext({});vm.runInContext(`const S={gaze:{active:false,x:0}};const notes=()=>{};const smoothstep=(a,b,x)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);};const env=(u,a,b,c,d)=>smoothstep(a,b,u)*(1-smoothstep(c,d,u));\n`+text.slice(begin,end)+'\nthis.original=ANIMS;',c);
 // lookAround is explicitly redesigned; its entry and timing have separate tests.
 const ids=['hum','stretch','sneeze','peek','doze','bounce','wake','rouse'];assert.deepEqual(catalog.filter(x=>x.id!=='lookAround').map(x=>x.id),ids);
 for(const id of ids){assert.equal(scores[id].dur,c.original[id].dur,id+' duration');for(let i=0;i<=100;i++){const t=scores[id].dur*i/100;assert.deepEqual(JSON.parse(JSON.stringify(scores[id].f(t))),JSON.parse(JSON.stringify(c.original[id].f(t))),id+' at '+t);}}
});
