import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyMotionAttribute, prefs, useAnimationsEnabled } from '../src/audio';
import { shouldShowMotionNote } from '../src/audio/motionNote';
import { createPrefs, DEFAULT_PREFS, loadPrefs } from '../src/audio/preferences';
import { I18nProvider } from '../src/i18n/context';
import { createStorage, storage } from '../src/net/storage';
import { MotionNote } from '../src/ui/MotionNote';

const memory = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

/** GDD v0.9: motion is on unless the player turns it off by hand; the system's reduce-motion setting is not consulted. */
describe('the animations preference', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is on by default, even when the system reports reduced motion', () => {
    vi.stubGlobal('window', { matchMedia: (q: string) => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {} }) });
    expect(DEFAULT_PREFS.animations).toBe(true);
    expect(loadPrefs(createStorage(() => memory())).animations).toBe(true);
    expect(prefs.get().animations).toBe(true);
  });

  it('is saved as 1/0 under ada.animations and read back; garbage falls back to on', () => {
    const b = memory();
    const p = createPrefs(createStorage(() => b));
    p.set({ animations: false });
    expect(b.m.get('ada.animations')).toBe('0');
    expect(loadPrefs(createStorage(() => b)).animations).toBe(false);
    p.set({ animations: true });
    expect(b.m.get('ada.animations')).toBe('1');
    b.m.set('ada.animations', 'x');
    expect(loadPrefs(createStorage(() => b)).animations).toBe(true);
  });

  it('carries on in memory when storage is blocked', () => {
    const blocked = createStorage(() => { throw new Error('blocked'); });
    const p = createPrefs(blocked);
    p.set({ animations: false });
    expect(p.get().animations).toBe(false);
    expect(loadPrefs(blocked).animations).toBe(false);
  });

  it('useAnimationsEnabled reports the current choice', () => {
    function Probe() {
      return <span>{String(useAnimationsEnabled())}</span>;
    }
    expect(renderToStaticMarkup(<Probe />)).toContain('true');
    prefs.set({ animations: false });
    expect(renderToStaticMarkup(<Probe />)).toContain('false');
    prefs.set({ animations: true });
  });

  it('is mirrored on <html data-motion="off"> and nowhere else', () => {
    const attrs = new Map<string, string>();
    const root = { setAttribute: (k: string, v: string) => void attrs.set(k, v), removeAttribute: (k: string) => void attrs.delete(k) };
    applyMotionAttribute(false, root);
    expect(attrs.get('data-motion')).toBe('off');
    applyMotionAttribute(true, root);
    expect(attrs.has('data-motion')).toBe(false);
  });
});

describe('the system setting is not followed', () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
  const src = join(__dirname, '..', 'src');

  it('only the one-time note asks the system, and the stylesheet never does', () => {
    const files = walk(src).filter((f) => /\.(ts|tsx|css)$/.test(f));
    const asking = files.filter((f) => /prefers-reduced-motion/.test(readFileSync(f, 'utf8'))).map((f) => relative(src, f).split(sep).join('/'));
    expect(asking).toEqual(['audio/motionNote.ts']);
  });
});

describe('the one-time note about the system setting', () => {
  const store = (o: Record<string, string> = {}) => ({ get: (k: string) => o[k] ?? null });

  it('shows only for: system reduces + nothing chosen + not closed before', () => {
    expect(shouldShowMotionNote(store(), true)).toBe(true);
    expect(shouldShowMotionNote(store(), false)).toBe(false);
    expect(shouldShowMotionNote(store({ animations: '1' }), true)).toBe(false);
    expect(shouldShowMotionNote(store({ animations: '0' }), true)).toBe(false);
    expect(shouldShowMotionNote(store({ motionNote: '1' }), true)).toBe(false);
  });

  describe('rendered', () => {
    beforeAll(() => void vi.stubGlobal('navigator', { languages: ['en'], language: 'en' }));
    const html = () => renderToStaticMarkup(<I18nProvider><MotionNote /></I18nProvider>);
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.stubGlobal('navigator', { languages: ['en'], language: 'en' });
      storage.remove('animations');
      storage.remove('motionNote');
    });
    // the preference tests above saved a choice into the shared storage; start these from a device that has none
    const system = (reduce: boolean) => (storage.remove('animations'), vi.stubGlobal('window', { matchMedia: () => ({ matches: reduce }) }));

    it('appears with a close button, then is gone once closed or once a choice is saved', () => {
      system(true);
      expect(html()).toMatch(/data-note="motion"/);
      expect(html()).toContain('data-action="dismiss-motion-note"');
      storage.set('motionNote', '1');
      expect(html()).toBe('');
      storage.remove('motionNote');
      storage.set('animations', '1');
      expect(html()).toBe('');
    });

    it('never appears when the system does not ask for reduced motion', () => {
      system(false);
      expect(html()).toBe('');
    });
  });
});
