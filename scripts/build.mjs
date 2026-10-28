import { build } from 'esbuild';
import { mkdir, cp, rm, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'extension');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(path.join(root, 'public'), out, { recursive: true });
const result = await build({
  absWorkingDir: root, entryPoints: ['src/background.js', 'src/resolve.js', 'src/popup.js'],
  outdir: out, bundle: true, splitting: true, format: 'esm', platform: 'browser', target: 'chrome120',
  minify: true, legalComments: 'eof', chunkNames: 'chunks/[name]-[hash]',
  define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  inject: [path.join(root, 'src/buffer-shim.js')], logLevel: 'info', metafile: true,
});
// Explicitly prune stale content-hashed chunks, including on mounted filesystems
// whose recursive directory removal may retain previously materialized files.
const outputs = new Set(Object.keys(result.metafile.outputs).map(file => path.resolve(root, file)));
for (const name of await readdir(path.join(out, 'chunks'))) {
  const file = path.join(out, 'chunks', name);
  if (!outputs.has(file)) await unlink(file);
}
const packages = new Map();
for (const input of Object.keys(result.metafile.inputs).filter(p => p.includes('node_modules/'))) {
  let directory = path.dirname(path.join(root, input));
  while (directory.startsWith(path.join(root, 'node_modules'))) {
    try {
      const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
      if (pkg.name && pkg.version) { packages.set(directory, pkg); break; }
    } catch { /* Walk to the owning package. */ }
    directory = path.dirname(directory);
  }
}
let notices = 'Web3 Domain Router — bundled runtime dependencies\n\n';
for (const [directory, pkg] of [...packages].sort((a,b) => a[1].name.localeCompare(b[1].name))) {
  notices += `\n${'='.repeat(72)}\n${pkg.name}@${pkg.version}\nLicense: ${JSON.stringify(pkg.license || pkg.licenses || 'See package source')}\n`;
  const files = (await readdir(directory)).filter(name => /^(licen[sc]e|copying|notice)(\.|$)/i.test(name));
  for (const name of files) {
    try { notices += `\n--- ${name} ---\n${await readFile(path.join(directory, name), 'utf8')}\n`; } catch { /* A matching directory is not a license file. */ }
  }
}
await writeFile(path.join(root, 'THIRD_PARTY_NOTICES.txt'), notices);
await writeFile(path.join(out, 'THIRD_PARTY_NOTICES.txt'), notices);
const manifest = JSON.parse(await readFile(path.join(out, 'manifest.json'), 'utf8'));
await writeFile(path.join(out, 'BUILD.json'), JSON.stringify({ version: manifest.version, outputs: [...outputs].map(file => path.relative(out, file)) }, null, 2));
await writeFile(path.join(out, 'BUILD.txt'), `Web3 Domain Router ${manifest.version}\nBuilt from bundled local JavaScript. No remote code.\n`);
console.log('Load unpacked:', out);
