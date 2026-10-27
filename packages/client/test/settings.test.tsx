import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../src/i18n/context';
import { DeviceSettings, SoundSettings } from '../src/ui/DeviceSettings';

beforeAll(() => {
  vi.stubGlobal('navigator', { languages: ['en'], language: 'en' });
});

const html = (el: React.ReactElement) => renderToStaticMarkup(<I18nProvider>{el}</I18nProvider>);

describe('the sound section', () => {
  const out = html(<SoundSettings />);
  it('has the effects switch (on by default), the volume slider at 60, and a disabled music switch marked "Soon"', () => {
    expect(out).toMatch(/data-setting="sfx"[^>]*aria-checked="true"/);
    expect(out).toMatch(/type="range"[^>]*value="60"/);
    expect(out).toMatch(/data-setting="music"[^>]*aria-checked="false"[^>]*disabled/);
    expect(out).toContain('class="switch-tag"');
  });
});

describe('the device section', () => {
  it('shows neither vibration nor full screen where the browser has neither', () => {
    expect(html(<DeviceSettings vibrateSupported={false} fullscreenSupported={false} />)).toBe('');
  });
  it('shows vibration (off by default) without full screen, and the reverse: each on its own', () => {
    const v = html(<DeviceSettings vibrateSupported fullscreenSupported={false} />);
    expect(v).toMatch(/data-setting="vibrate"[^>]*aria-checked="false"/);
    expect(v).not.toContain('data-action="fullscreen"');
    const f = html(<DeviceSettings vibrateSupported={false} fullscreenSupported />);
    expect(f).toContain('data-action="fullscreen"');
    expect(f).toContain('aria-pressed="false"');
    expect(f).toMatch(/Enter full screen|Tam ekrana gir/);
    expect(f).not.toContain('data-setting="vibrate"');
  });
  it('detects support from the browser by default (none in this test environment)', () => {
    expect(html(<DeviceSettings />)).toBe('');
  });
});
