import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, '.output', 'chrome-mv3');

/**
 * L6 — build integrity.
 *
 * A `wxt build` once failed with EBUSY while a stray static server held .output, the error
 * was lost in unrelated console noise, and a stale bundle missing a critical fix was shipped
 * to the user. Everything here exists to make that impossible to miss again.
 */
describe('production build', () => {
  it('builds without error and emits the expected entrypoints', () => {
    // Throws on non-zero exit, so a silent build failure fails the suite.
    execSync('npx wxt build', { cwd: ROOT, stdio: 'pipe' });

    for (const f of ['manifest.json', 'background.js', 'dashboard.html']) {
      expect(existsSync(join(OUT, f)), `${f} missing from build output`).toBe(true);
    }
    expect(existsSync(join(OUT, 'content-scripts', 'driver.js'))).toBe(true);
  });

  it('contains code from the current sources, not a stale bundle', () => {
    // Marker strings, each unique to a fix that was once silently absent from a build.
    const background = readFileSync(join(OUT, 'background.js'), 'utf8');
    expect(background).toContain('executeScript');
    expect(background).toContain('extension restarted while');

    const driver = readFileSync(join(OUT, 'content-scripts', 'driver.js'), 'utf8');
    expect(driver).toContain('no element on this page matched');
  });

  it('ships no localhost permission — the mock adapter is e2e-only', () => {
    const manifest = JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8')) as {
      host_permissions: string[];
      content_scripts: Array<{ matches: string[] }>;
    };
    const all = [...manifest.host_permissions, ...manifest.content_scripts.flatMap((c) => c.matches)];
    expect(all.some((m) => m.includes('localhost') || m.includes('127.0.0.1'))).toBe(false);
    expect(manifest.host_permissions).toContain('https://claude.ai/*');
  });

  it('emits a dashboard stylesheet, so the console is never unstyled', () => {
    const assets = readdirSync(join(OUT, 'assets'));
    expect(assets.some((f) => f.endsWith('.css'))).toBe(true);
  });
});
