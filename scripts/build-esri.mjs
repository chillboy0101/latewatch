#!/usr/bin/env node
// Bundles Esri's map library (src/components/location/esri-sdk.ts) on its own into public/esri, so
// `next build` never has to: bundling the SDK inside the app build takes many minutes and more
// memory than a build machine has. Runs before `next build` and `next dev` (package.json); the
// Office Location page loads the result in the browser through public/esri/manifest.json.
//
//   npm run esri

import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = path.join(root, 'public', 'esri');
const ENTRY = 'src/components/location/esri-sdk.ts';

export async function buildEsri() {
  const started = Date.now();
  await rm(outdir, { force: true, recursive: true });
  await mkdir(outdir, { recursive: true });
  const result = await build({
    absWorkingDir: root,
    bundle: true,
    // Hashed names, so a new version never mixes with files a browser kept from the last one.
    assetNames: 'assets/[name]-[hash]',
    chunkNames: 'chunks/[name]-[hash]',
    define: { 'process.env.NODE_ENV': '"production"' },
    entryNames: '[name]-[hash]',
    entryPoints: { esri: ENTRY },
    format: 'esm',
    legalComments: 'none',
    loader: { '.gif': 'file', '.png': 'file', '.svg': 'file', '.ttf': 'file', '.woff': 'file', '.woff2': 'file' },
    logLevel: 'warning',
    metafile: true,
    minify: true,
    outdir,
    publicPath: '/esri',
    splitting: true,
    target: 'es2022',
  });
  const outputs = Object.entries(result.metafile.outputs);
  const entry = outputs.find(([, output]) => output.entryPoint === ENTRY);
  const style = outputs.find(([file]) => /\/esri-[^/]+\.css$/.test(file));
  if (!entry || !style) throw new Error('The Esri bundle has no script or style sheet');
  const url = (file) => `/esri/${path.relative(outdir, path.join(root, file)).split(path.sep).join('/')}`;
  await writeFile(path.join(outdir, 'manifest.json'), JSON.stringify({ script: url(entry[0]), style: url(style[0]) }));
  const bytes = outputs.reduce((total, [, output]) => total + output.bytes, 0);
  console.log(`Esri map library: ${outputs.length} files, ${(bytes / 1e6).toFixed(1)} MB, in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildEsri();
}
