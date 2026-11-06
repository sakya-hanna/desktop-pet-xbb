"""Idle release: real Node suites and two hidden Electron launches; no desktop input."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]

def hashes():
    files = list((ROOT / 'puppet/rig').rglob('*.js')) + list((ROOT / 'puppet/rig').rglob('*.png'))
    files += [ROOT / 'puppet/rig/index.html', ROOT / 'puppet/rig/desktop-ui.css', ROOT / 'puppet/resize-geometry.js']
    files += [ROOT / p for p in ('puppet/main.js', 'puppet/preload.js', 'puppet/window-state.js', 'puppet/run-rig.bat', 'tests/electron-desktop-controls.cjs')]
    files += list((ROOT / 'tests').glob('*.test.js'))
    files += [Path(__file__).resolve()]
    return {p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(files)}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True)
    parser.add_argument('--electron', required=True)
    args = parser.parse_args()
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=False)
    report = {'before': hashes(), 'checks': [], 'passed': False}
    def run(name, command, env=None):
        try:
            result = subprocess.run(command, cwd=ROOT, env=env, capture_output=True, timeout=90)
            (out / (name + '-stdout.log')).write_bytes(result.stdout)
            (out / (name + '-stderr.log')).write_bytes(result.stderr)
            report['checks'].append({'name': name, 'exit_code': result.returncode})
            if result.returncode:
                raise RuntimeError(name + ' failed; inspect preserved stdout/stderr')
        except subprocess.TimeoutExpired as error:
            (out / (name + '-stdout.log')).write_bytes(error.stdout or b'')
            (out / (name + '-stderr.log')).write_bytes(error.stderr or b'')
            raise
    try:
        tests = sorted(str(p) for p in (ROOT / 'tests').glob('*.test.js'))
        run('node', ['node', '--test', '--test-concurrency=1', *tests])
        for phase in ('write', 'restore'):
            env = dict(os.environ, BAIJIE_DESKTOP_OUT=str(out / 'render'), BAIJIE_DESKTOP_PHASE=phase)
            run('electron-' + phase, [args.electron, str(ROOT / 'tests/electron-desktop-controls.cjs')], env)
            result = json.loads((out / 'render' / (phase + '-result.json')).read_text(encoding='utf-8'))
            if result['passed'] is not True:
                raise RuntimeError('Missing hidden Electron acceptance')
        report['after'] = hashes()
        if report['before'] != report['after']:
            raise RuntimeError('Sources changed during verification')
        report['passed'] = True
    except Exception as error:
        report['error'] = str(error)
        raise
    finally:
        (out / 'summary.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps({'passed': report['passed'], 'checks': report['checks'], 'report': str(out)}, ensure_ascii=False))

if __name__ == '__main__':
    main()
