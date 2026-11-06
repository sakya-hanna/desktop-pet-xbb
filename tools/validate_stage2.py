"""Source-bound Stage 2 checks; output must be a new project directory."""
import argparse,hashlib,json,os,re,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--out',type=Path,required=True)
parser.add_argument('--manifest',type=Path,required=True)
parser.add_argument('--skip-electron',action='store_true')
args=parser.parse_args()
OUT=args.out.resolve();OUT.mkdir(parents=True,exist_ok=False)
manifest=json.loads(args.manifest.read_text(encoding='utf-8'))
hashes={e['path']:hashlib.sha256((ROOT/e['path']).read_bytes()).hexdigest() for e in manifest}
if hashes!={e['path']:e['sha256'] for e in manifest}:raise RuntimeError('Preflight source does not match frozen manifest')
summary={'source_hashes':hashes,'checks':[],'passed':False,'electron_skipped':args.skip_electron}
try:
    tests=sorted(str(p.relative_to(ROOT)) for p in (ROOT/'tests').glob('*.test.js'))
    checks=[('node',['node','--test','--test-concurrency=1',*tests],70),
            ('python',[sys.executable,'-m','unittest','discover','-s','tests','-v'],40)]
    if not args.skip_electron:
        checks.append(('electron',[str(Path(os.environ['USERPROFILE'])/'.dsh/electron/electron.exe'),'tests/electron-stage2.cjs'],160))
    for name,command,timeout in checks:
        result=subprocess.run(command,cwd=ROOT,env=dict(os.environ,BAIJIE_TEST_OUT=str(OUT/'render')),capture_output=True,timeout=timeout)
        (OUT/(name+'-stdout.log')).write_bytes(result.stdout);(OUT/(name+'-stderr.log')).write_bytes(result.stderr)
        summary['checks'].append({'name':name,'exit_code':result.returncode})
        if name=='node':
            text=result.stdout.decode(errors='replace')
            summary['node_totals']={k:int(v) for k,v in re.findall(r'^# (tests|pass|fail|skipped) (\d+)',text,re.M)}
        if result.returncode:raise RuntimeError(name+' failed; see saved logs')
    if not args.skip_electron:
        render=json.loads((OUT/'render/result.json').read_text())
        if not render['passed']:raise RuntimeError('Electron report failed')
        summary.update(render_scenes=len(render['scenes']),eye_pairs=len(render['eyePairs']),hop_frames=len(render['hopFrames']),manual_blink_passed=render['manualBlink']['passed'])
    summary['passed']=True
except Exception as error:summary['failure']=str(error)
finally:
    summary['post_source_hashes']={p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in hashes}
    if summary['post_source_hashes']!=hashes:summary['passed']=False;summary['failure']='Source drift during validation'
    (OUT/'summary.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in summary.items() if 'hashes' not in k},indent=2))
sys.exit(0 if summary['passed'] else 1)
