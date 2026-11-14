'use strict';
// Private test fixture only: two explicit workspace layouts, no cwd/env search.
const path=require('node:path');
function resolveEvidenceRoot(candidateRoot){
 if(typeof candidateRoot==='string'&&path.isAbsolute(candidateRoot)&&path.basename(path.normalize(candidateRoot))==='01-当前工程')return path.resolve(candidateRoot,'../31-交付版集成-V1/evidence/I1-left-grab-01');
 if(typeof candidateRoot!=='string'||!path.isAbsolute(candidateRoot)||path.basename(path.normalize(candidateRoot))!=='candidate')throw new TypeError('Absolute candidate directory required');
 const parent=path.dirname(path.normalize(candidateRoot));
 const workspace=path.basename(path.dirname(parent))==='revisions'?path.dirname(path.dirname(parent)):parent;
 return path.join(workspace,'evidence','I1-left-grab-01');
}
module.exports={resolveEvidenceRoot};
