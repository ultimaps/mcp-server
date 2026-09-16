#!/usr/bin/env node
/**
 * Build the one-click Claude Desktop bundle:
 * `ultimaps-<version>.mcpb`. pnpm's symlinked node_modules can't be zipped, so
 * the bundle is staged in ./bundle with a flat production-only npm install.
 *
 *   npm run bundle
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const stage = join(root, 'bundle');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const server = JSON.parse(readFileSync(join(root, 'server.json'), 'utf8'));

// Four version fields across three files, and only package.json's is read at
// runtime, so the other three can drift through a bump unnoticed. Bundling is
// the last build step before a release, so it is where they get compared.
if (!Array.isArray(server.packages) || server.packages.length === 0) {
  // Not a version mismatch but the same accident, and skipping the loop below
  // would let it through quietly.
  throw new Error('server.json lists no packages, so the registry entry points at nothing.');
}
const versions = [
  ['manifest.json version', manifest.version],
  ['server.json version', server.version],
  ...server.packages.map((entry, index) => [`server.json packages[${index}].version`, entry.version]),
];
for (const [label, version] of versions) {
  if (version !== pkg.version) {
    throw new Error(`${label} is ${version}, which does not match package.json ${pkg.version}.`);
  }
}

function run(command, args, cwd = root) {
  execFileSync(command, args, { cwd, stdio: 'inherit' });
}

run('npm', ['run', 'build']);

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const entry of ['dist', 'src/generated', 'manifest.json', 'icon.png', 'screenshots', 'README.md', 'LICENSE']) {
  cpSync(join(root, entry), join(stage, entry), { recursive: true });
}
const { devDependencies, scripts, ...runtimePackage } = pkg;
writeFileSync(join(stage, 'package.json'), `${JSON.stringify(runtimePackage, null, 2)}\n`);

run('npm', ['install', '--omit=dev', '--no-package-lock', '--no-audit', '--no-fund'], stage);
run('mcpb', ['validate', 'manifest.json'], stage);
run('mcpb', ['pack', stage, join(root, `ultimaps-${pkg.version}.mcpb`)]);
