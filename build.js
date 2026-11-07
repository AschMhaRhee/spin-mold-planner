#!/usr/bin/env node
/*
 * Builds the single-file app: dist/index.html (also copied to
 * dist/spin-mold-planner.html for people who want to download and run it offline).
 * Inlines the engine and the example parts. No dependencies.
 *
 * Usage: node build.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = __dirname;
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const repoUrl = (pkg.repository && (pkg.repository.url || pkg.repository)).replace(/^git\+/, '').replace(/\.git$/, '');

const examples = [
  { file: 'examples/medallion.stl', name: 'Medallion with bail', qty: 6 },
  { file: 'examples/sword-shield.stl', name: 'Sword and shield', qty: 4 },
].map(e => ({ name: e.name, qty: e.qty, b64: zlib.gzipSync(fs.readFileSync(path.join(root, e.file)), { level: 9 }).toString('base64') }));

let html = fs.readFileSync(path.join(root, 'src/app.html'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'src/engine.js'), 'utf8');
html = html
  .replace('/*__ENGINE__*/', () => engine)
  .replace('/*__EXAMPLE__*/', () => 'const EXAMPLES=' + JSON.stringify(examples) + ';')
  .split('__REPO_URL__').join(repoUrl)
  .split('__VERSION__').join(pkg.version);

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/index.html'), html);
fs.writeFileSync(path.join(root, 'dist/spin-mold-planner.html'), html);
console.log(`Built dist/index.html (${(html.length / 1024).toFixed(0)} KB), v${pkg.version}`);
