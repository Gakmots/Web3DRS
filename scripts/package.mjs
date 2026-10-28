import { execFileSync } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
await access(path.join(root, 'extension/manifest.json'));
const output = path.resolve(root, '..', `web3-domain-router-v${version}.zip`);
// Python's standard zip writer avoids another build-time dependency.
execFileSync('python3', ['-c', `
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import sys
root=Path(sys.argv[1]); output=Path(sys.argv[2])
with ZipFile(output,'w',ZIP_DEFLATED,compresslevel=9) as z:
    for name in ['src','public','scripts','test','extension']:
        for f in sorted((root/name).rglob('*')):
            if f.is_file(): z.write(f, str(Path(root.name)/f.relative_to(root)))
    for name in ['README.md','VALIDATION.md','THIRD_PARTY_NOTICES.txt','LICENSE','package.json','package-lock.json','.gitignore']:
        z.write(root/name, str(Path(root.name)/name))
print(output)
`, root, output], { stdio: 'inherit' });
