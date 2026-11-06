"""Windows-only offline acceptance; does not launch the desktop app or send OS input."""
import hashlib,json,os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'reports/hair-20261102-final'
OUT.mkdir(parents=True,exist_ok=False)
manifest=json.loads((ROOT/'.hermes-hair-20261102-02/apply-started.json').read_text(encoding='utf-8'))
# Record exact current input hashes, not just a release label.
hashes={e['path']:hashlib.sha256((ROOT/e['path']).read_bytes()).hexdigest() for e in manifest}
summary={'source_hashes':hashes,'checks':[],'passed':False}
try:
    for name,command in [
        ('node',['node','--test','tests/alpha-mesh.test.js','tests/hair-motion.test.js','tests/desktop-input.test.js','tests/renderer.test.js']),
        ('python',[sys.executable,'-m','unittest','discover','-s','tests','-v']),
        ('electron',[str(Path(os.environ['USERPROFILE'])/'.dsh/electron/electron.exe'),'tests/electron-smoke.cjs']),
    ]:
        env=dict(os.environ,BAIJIE_TEST_OUT=str(OUT/'render'))
        result=subprocess.run(command,cwd=ROOT,env=env,capture_output=True,timeout=115)
        (OUT/(name+'-stdout.log')).write_bytes(result.stdout)
        (OUT/(name+'-stderr.log')).write_bytes(result.stderr)
        summary['checks'].append({'name':name,'exit_code':result.returncode})
        if result.returncode: raise RuntimeError(name+' acceptance failed')
    render=json.loads((OUT/'render/result.json').read_text(encoding='utf-8'))
    if not render['passed'] or not render.get('inputBridge',{}).get('passed'):
        raise RuntimeError('Renderer or preload IPC acceptance failed')
    summary['render_cases']=len(render['cases'])
    summary['input_bridge']=render['inputBridge']
    summary['passed']=True
except Exception as error:
    summary['failure']=str(error)
finally:
    summary['post_source_hashes']={p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in hashes}
    if summary['post_source_hashes']!=hashes:
        summary['passed']=False;summary['failure']='Source drift during acceptance'
    (OUT/'summary.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in summary.items() if 'hashes' not in k},ensure_ascii=False,indent=2))
sys.exit(0 if summary['passed'] else 1)
