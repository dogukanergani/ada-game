import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const manifest = JSON.parse(readFileSync(join(root, 'public', 'manifest.webmanifest'), 'utf8'));
const html = readFileSync(join(root, 'index.html'), 'utf8');

describe('what makes the page installable and phone-ready', () => {
  it('has a manifest in the palette, with icons that exist at the sizes it names', () => {
    expect(manifest.name).toBe('Ada');
    expect(manifest.display).toBe('standalone');
    expect(manifest.background_color).toBe('#0b2530');
    expect(manifest.theme_color).toBe('#0b2530');
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(manifest.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true);
    for (const icon of manifest.icons as { src: string }[]) expect(existsSync(join(root, 'public', icon.src.replace(/^\//, ''))), icon.src).toBe(true);
    // PNG signature and size of the two main icons
    for (const [file, px] of [['icon-192.png', 192], ['icon-512.png', 512]] as const) {
      const buf = readFileSync(join(root, 'public', file));
      expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(buf.readUInt32BE(16)).toBe(px);
      expect(buf.readUInt32BE(20)).toBe(px);
    }
  });

  it('draws under the notch and home bar, and says so to the browser', () => {
    expect(html).toContain('viewport-fit=cover');
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('rel="apple-touch-icon"');
    expect(html).toContain('name="theme-color" content="#0b2530"');
    const css = readFileSync(join(root, 'src', 'styles.css'), 'utf8');
    for (const edge of ['top', 'right', 'bottom', 'left']) expect(css).toContain(`env(safe-area-inset-${edge}`);
  });

  it('registers no service worker (an old cached shell would clash with a newer server)', () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d)) {
        const p = join(d, e);
        if (statSync(p).isDirectory()) walk(p);
        else files.push(p);
      }
    };
    walk(join(root, 'src'));
    walk(join(root, 'public'));
    for (const f of files.filter((p) => /\.(ts|tsx|js|html)$/.test(p))) expect(readFileSync(f, 'utf8'), f).not.toMatch(/serviceWorker/);
    expect(existsSync(join(root, 'public', 'sw.js'))).toBe(false);
    expect(html).not.toMatch(/serviceWorker/);
  });

  it('switches motion off by hand (not by the system setting) and keeps every control at least 44 px', () => {
    const css = readFileSync(join(root, 'src', 'styles.css'), 'utf8');
    // GDD v0.9: the stylesheet follows html[data-motion='off'] (Settings), never the system's prefers-reduced-motion
    expect(css).not.toContain('prefers-reduced-motion');
    expect(css).toContain(":root[data-motion='off']");
    expect(css).toContain('--tap: 44px');
    expect(css).toMatch(/\.btn\s*\{[^}]*min-height:\s*var\(--tap\)/s);
    expect(css).toContain(':focus-visible');
  });
});
