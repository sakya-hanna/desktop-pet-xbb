"""Frozen-source Node and real hidden Electron companion acceptance; no desktop input."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
ROOT = Path(__file__).resolve().parents[1]
def hashes():
    files = [p for p in (ROOT/'puppet').rglob('*') if p.is_file() and p.suffix in ('.js','.html','.css','.png','.bat')]
    files += list((ROOT/'tests').glob('*.test.js')) + [ROOT/'tests/helpers/renderer-harness.cjs',ROOT/'tests/electron-touch.cjs',Path(__file__).resolve()]
    return {p.relative_to(ROOT).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(set(files))}
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--out',required=True);ap.add_argument('--electron',required=True);args=ap.parse_args()
    out=Path(args.out).resolve();out.mkdir(parents=True,exist_ok=False)
    report={'passed':False,'before':hashes(),'checks':[]}
    def run(name,cmd,env=None):
        try:
            r=subprocess.run(cmd,cwd=ROOT,env=env,capture_output=True,timeout=150)
            (out/(name+'-stdout.log')).write_bytes(r.stdout);(out/(name+'-stderr.log')).write_bytes(r.stderr)
            report['checks'].append({'name':name,'exit_code':r.returncode})
            if r.returncode:raise RuntimeError(name+' failed')
        except subprocess.TimeoutExpired as e:
            (out/(name+'-stdout.log')).write_bytes(e.stdout or b'');(out/(name+'-stderr.log')).write_bytes(e.stderr or b'');raise
    try:
        run('node',['node','--test','--test-concurrency=1',*[str(p) for p in sorted((ROOT/'tests').glob('*.test.js'))]])
        env=dict(os.environ,BAIJIE_TOUCH_OUT=str(out/'render'))
        run('electron',[args.electron,str(ROOT/'tests/electron-touch.cjs')],env)
        assert json.loads((out/'render/result.json').read_text(encoding='utf-8'))['passed'] is True
        report['after']=hashes();assert report['before']==report['after'],'source drift during acceptance'
        report['passed']=True
    except Exception as e:
        report['error']=str(e);raise
    finally:
        (out/'summary.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps({'passed':report['passed'],'checks':report['checks'],'out':str(out)},ensure_ascii=False))
if __name__=='__main__':main()
