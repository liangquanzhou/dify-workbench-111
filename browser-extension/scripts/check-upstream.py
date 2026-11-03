#!/usr/bin/env python3
"""Read upstream data, run OUR regression suite, prepare a local candidate only.

Exit 0 = candidate prepared, 2 = changed contract needs adaptation, 1 = failed.
No upstream code is executed, no baseline is rewritten, no push/release/install.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
REPO = 'binhuhu/dify_dmn_plugin'


def api(path):
    headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'dmn-preview-compat-check'}
    if os.environ.get('GITHUB_TOKEN'):
        headers['Authorization'] = 'Bearer ' + os.environ['GITHUB_TOKEN']
    request = urllib.request.Request('https://api.github.com/repos/' + REPO + path, headers=headers)
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def choose(releases, channel):
    eligible = [r for r in releases if not r['draft'] and (channel == 'all' or not r['prerelease'])]
    if not eligible:
        raise ValueError('No release in requested channel')
    return max(eligible, key=lambda r: r['published_at'])


def git(source, *args):
    return subprocess.check_output(['git', '-C', str(source), *args])


def contracts(source, sha, prefixes):
    paths = git(source, 'ls-tree', '-r', '--name-only', sha).decode().splitlines()
    selected = [p for p in paths if any(p == prefix or p.startswith(prefix.rstrip('/') + '/') for prefix in prefixes)]
    if not selected:
        raise ValueError('Upstream contract file set is empty')
    hashes = {}
    for p in selected:
        body = git(source, 'show', f'{sha}:{p}')
        # A plugin version bump alone does not change identity or data semantics.
        if p.endswith('manifest.yaml'):
            body = b'\n'.join(line for line in body.splitlines() if not line.startswith(b'version:'))
        hashes[p] = hashlib.sha256(body).hexdigest()
    return hashes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, help='Existing read-only upstream git checkout (offline mode)')
    parser.add_argument('--ref', help='Required with --source; explicit tag or SHA')
    parser.add_argument('--channel', choices=['all', 'stable'], default='all')
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    if bool(args.source) != bool(args.ref):
        parser.error('--source and --ref must be supplied together')
    args.out.mkdir(parents=True, exist_ok=True)
    baseline = json.loads((ROOT / 'upstream-lock.json').read_text())
    report = {'repository': REPO, 'channel': args.channel, 'baseline_sha': baseline['commit'], 'status': 'FAILED', 'company_dify': 'NOT_RUN', 'release_install': 'NOT_RUN'}
    try:
        with tempfile.TemporaryDirectory(prefix='dmn-upstream-') as tmp:
            tmp = Path(tmp)
            source = args.source
            if source:
                ref = args.ref
                report['discovery'] = 'explicit local ref; online release discovery NOT_RUN'
            else:
                releases = []
                for page in range(1, 101):
                    batch = api(f'/releases?per_page=100&page={page}')
                    releases.extend(batch)
                    if len(batch) < 100:
                        break
                else:
                    raise ValueError('Release pagination exceeded limit; cannot claim latest')
                release = choose(releases, args.channel)
                ref = release['tag_name']
                report['release'] = {k: release[k] for k in ('tag_name', 'prerelease', 'published_at', 'html_url')}
                source = tmp / 'upstream'
                subprocess.run(['git', 'clone', '--quiet', '--no-checkout', 'https://github.com/' + REPO + '.git', str(source)], check=True, timeout=120)
            sha = git(source, 'rev-parse', '--verify', ref + '^{commit}').decode().strip()
            report['target_sha'] = sha
            current = contracts(source, sha, baseline['contract_prefixes'])
            report['changed_contracts'] = sorted(p for p in set(current) | set(baseline['hashes']) if current.get(p) != baseline['hashes'].get(p))
            fixtures = tmp / 'fixtures'
            fixtures.mkdir()
            for p in baseline['fixture_paths']:
                (fixtures / Path(p).name).write_bytes(git(source, 'show', f'{sha}:{p}'))
            env = dict(os.environ, BRIAN_FIXTURES=str(fixtures))
            # Only trusted local build/test commands. Never run scripts from upstream.
            for name in ('build', 'typecheck', 'test:all'):
                result = subprocess.run(['npm', 'run', name], cwd=ROOT, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=120)
                (args.out / (name + '.log')).write_text(result.stdout)
                report[name + '_exit'] = result.returncode
                if result.returncode:
                    raise RuntimeError(f'{name} failed: see {name}.log')
            if report['changed_contracts']:
                report['status'] = 'REVIEW_REQUIRED'
                report['reason'] = 'Upstream contract changed. Passing examples do not prove changed semantics. Adapt/review before updating baseline or publishing.'
                (args.out / 'candidate-upstream-lock.json').write_text(json.dumps({**baseline, 'commit': sha, 'hashes': current}, indent=2) + '\n')
                return 2
            archive = args.out / f'dmn-preview-candidate-{sha[:12]}.zip'
            with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
                for file in sorted((ROOT / 'dist/extension').iterdir()):
                    if file.is_file():
                        z.write(file, file.name)
            report.update(status='CANDIDATE_READY', candidate=str(archive), sha256=hashlib.sha256(archive.read_bytes()).hexdigest())
            return 0
    except Exception as exc:
        report['error'] = str(exc)
        return 1
    finally:
        (args.out / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    raise SystemExit(main())
