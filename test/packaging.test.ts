import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The release identity lives in three files and nothing at runtime reads more
 * than one of them, so a bump or a rename that misses one is invisible until a
 * client installs the result. `scripts/bundle.mjs` compares the versions too,
 * but that only runs at release time, and by then the mismatch is
 * already committed.
 */
const read = (name: string): any => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'));

const pkg = read('package.json');
const manifest = read('manifest.json');
const server = read('server.json');

describe('release metadata', () => {
  it('carries one version across package.json, manifest.json and server.json', () => {
    expect(manifest.version).toBe(pkg.version);
    // The registry entry may run ahead of npm: registry versions are immutable,
    // so a metadata-only update (adding the hosted remote, 0.1.1) takes a new
    // one without a package release. The next release bumps past it and
    // scripts/bundle.mjs then requires all of them to match again.
    const semver = (v: string) => v.split('.').map(Number);
    const [server_, package_] = [semver(server.version), semver(pkg.version)];
    const cmp = server_.map((part, i) => part - (package_[i] ?? 0)).find((d) => d !== 0) ?? 0;
    expect(cmp).toBeGreaterThanOrEqual(0);
    // The registry entry repeats the version once per package it lists, so the
    // list has to be non-empty for the comparison below to mean anything.
    expect(server.packages.length).toBeGreaterThan(0);
    expect(server.packages.map((entry: any) => entry.version)).toEqual(
      server.packages.map(() => pkg.version),
    );
  });

  it('names the same package to npm and to the MCP registry', () => {
    expect(pkg.mcpName).toBe(server.name);
    expect(server.packages.map((entry: any) => entry.identifier)).toEqual(
      server.packages.map(() => pkg.name),
    );
  });

  it('points the .mcpb manifest at the published bin', () => {
    const bin = pkg.bin['ultimaps-mcp'];
    expect(manifest.server.entry_point).toBe(bin);
    expect(manifest.server.mcp_config.args).toEqual([`\${__dirname}/${bin}`]);
    // `files` ships dist and the vendored schema; package.json comes free.
    expect(pkg.files).toContain(bin.split('/')[0]);
  });

  it('exposes no importable entry point, on purpose', () => {
    // `dist/index.js` starts a stdio server at module load, so a `main` would
    // make `import '@ultimaps/mcp'` boot one on the importer's stdout. The
    // exports map instead makes the import fail by name.
    expect(pkg.main).toBeUndefined();
    expect(Object.keys(pkg.exports)).toEqual(['./package.json']);
  });
});
