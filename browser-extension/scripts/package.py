#!/usr/bin/env python3
"""Build deterministic browser/source/reader archives. No private evidence or upstream fixtures."""
from pathlib import Path
import hashlib, json, zipfile
root = Path(__file__).resolve().parents[1]
dist = root / 'dist'
version = json.loads((root/'manifest.json').read_text())['version']
assert version == json.loads((root/'package.json').read_text())['version']
assert version == json.loads((dist/'extension/manifest.json').read_text())['version'], 'Run npm run build first'
fixed_time = (2026, 10, 9, 0, 0, 0)

def make_archive(path, entries):
    names = [name for _, name in entries]
    assert len(names) == len(set(names)), 'Duplicate archive entries'
    with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for src, name in sorted(entries, key=lambda e:e[1]):
            if src.is_symlink():
                raise RuntimeError('Refusing symlink in archive: '+str(src))
            info = zipfile.ZipInfo(name, date_time=fixed_time)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, src.read_bytes())

runtime_names = ['manifest.json','background.js','content.js','reader.js','dock.css','LICENSE','THIRD_PARTY_NOTICES.md','README.md','INSTALL.zh-CN.md']
assert {p.name for p in (dist/'extension').iterdir()} == set(runtime_names), 'Unexpected runtime file'
extension_entries = [(dist/'extension'/name, name) for name in runtime_names]
source_names = ['README.md','README.zh-CN.md','THIRD_PARTY_NOTICES.md','LICENSE','manifest.json','package.json','package-lock.json','tsconfig.json','upstream-lock.json','INSTALL-0.4.1.zh-CN.md','.gitignore','docs/REAL-E2E-0.4.0.md','docs/REAL-E2E-0.4.1.md']
for folder in ['src','scripts','examples','packaging']:
    source_names += [p.relative_to(root).as_posix() for p in (root/folder).rglob('*') if p.is_file() and '__pycache__' not in p.parts]
source_names += [p.relative_to(root).as_posix() for p in (root/'tests').iterdir() if p.is_file()]
source_names += [p.relative_to(root).as_posix() for p in (root/'tests/fixtures/stored').iterdir() if p.is_file()]
source_entries = [(root/name, 'dmn-browser-preview/'+name) for name in source_names]
source_entries += [(p, 'dmn-browser-preview/dist/extension/'+name) for p,name in extension_entries]
reader_entries = [(root/'examples'/name,name) for name in ['reader-latest.yml','reader-version.yml','reader-connections.example.json']]
reader_entries += [(root/'INSTALL-0.4.1.zh-CN.md','INSTALL.zh-CN.md'),(root/'LICENSE','LICENSE')]
paths = [dist/f'dmn-browser-preview-{version}.zip',dist/f'dmn-browser-preview-{version}-source.zip',dist/f'dmn-reader-workflows-{version}.zip']
for path, entries in zip(paths,[extension_entries,source_entries,reader_entries]):
    make_archive(path, entries)
report = {p.name:{'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in paths}
(dist/'SHA256SUMS.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
