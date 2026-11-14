'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
test('source-only policy imports without art; resource installation still rejects missing manifest',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'baijie-source-policy-'));
  const file=path.join(root,'resource-policy.cjs');
  try {
    fs.copyFileSync(path.join(__dirname,'../resource-policy.cjs'),file);
    const policy=require(file);let registered=false;
    assert.equal(policy.ENTRY_URL,'baijie28://app/desktop.html');
    assert.throws(()=>policy.installResources({root,protocol:{handle(){registered=true;}}}),{code:'ENOENT'});
    assert.equal(registered,false);
    fs.mkdirSync(path.join(root,'assets'));
    fs.writeFileSync(path.join(root,'assets/manifest.json'),JSON.stringify({images:{'baijie-test.png':{},'unlisted.png':{}}}));
    for(const name of ['baijie-test.png','unlisted.png'])fs.writeFileSync(path.join(root,'assets',name),'fixture');
    policy.installResources({root,protocol:{handle(){registered=true;}}});
    assert.equal(registered,true);
    assert.equal(policy.resolveResource('baijie28://app/assets/baijie-test.png',root),path.join(root,'assets/baijie-test.png'));
    assert.equal(policy.resolveResource('baijie28://app/assets/unlisted.png',root),null);
    assert.equal(policy.resolveResource('baijie28://app/assets/../resource-policy.cjs',root),null);
  } finally {delete require.cache[file];fs.rmSync(root,{recursive:true,force:true});}
});
