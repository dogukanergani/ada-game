import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const source = readFileSync(join(root, 'src', 'styles.css'), 'utf8');
const assets = join(root, 'dist', 'assets');
const built = existsSync(assets) ? readdirSync(assets).filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(assets, f), 'utf8')).join('\n') : null;

/** the animations the dice and the production flight depend on, with the class that plays each */
const ANIMATIONS: Record<string, string> = {
  'dice-tumble-a': '.dice-stage[data-stage=rolling] .die[data-die="0"] .die-face',
  'dice-tumble-b': '.dice-stage[data-stage=rolling] .die[data-die="1"] .die-face',
  'dice-land': '.dice-stage[data-stage=hold] .die-face',
  'dice-in': '.dice-stage[data-stage=hold] .dice-sum',
  'prod-ring': '.prod-ring{',
  'gain-pop': '.hand-gain{',
};

const keyframes = (css: string) => new Set([...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]));
const used = (css: string) => new Set([...css.matchAll(/animation:\s*([\w-]+)\s/g)].map((m) => m[1]).filter((n) => n !== 'none'));

/**
 * The browser tests (Playwright) look at the DOM and at what the browser reports it is playing, so they would not
 * notice a stylesheet that lost its @keyframes in the build. These read the CSS the build produced.
 * `dist` exists only after `npm run build`; without it the built-CSS checks are skipped, the source checks always run.
 */
describe('animation CSS', () => {
  it('every animation the source stylesheet uses has its @keyframes', () => {
    const defined = keyframes(source);
    for (const name of used(source)) expect(defined, name).toContain(name);
    for (const name of Object.keys(ANIMATIONS)) expect(defined, name).toContain(name);
  });

  it('the flier is moved by the Web Animations API, so its class and layer exist in the stylesheet', () => {
    expect(source).toMatch(/\.flier\s*\{/);
    expect(source).toMatch(/\.flight-layer\s*\{/);
  });

  const built_ = built ? it : it.skip;
  built_('the built CSS keeps every @keyframes and each rule that plays it', () => {
    const defined = keyframes(built!);
    for (const [name, rule] of Object.entries(ANIMATIONS)) {
      expect(defined, `@keyframes ${name} missing from the built CSS`).toContain(name);
      const at = built!.indexOf(rule);
      expect(at, `${rule} missing from the built CSS`).toBeGreaterThanOrEqual(0);
      expect(built!.slice(at, built!.indexOf('}', at)), `${rule} no longer plays ${name}`).toContain(name);
    }
    for (const name of used(built!)) expect(defined, name).toContain(name);
  });

  built_('the class names the components render are the ones the built CSS defines (no renaming)', () => {
    for (const cls of ['dice-stage', 'dice-tray', 'die-face', 'prod-ring', 'hand-gain', 'flier', 'flight-layer']) {
      expect(built!, cls).toContain(`.${cls}`);
    }
  });
});
