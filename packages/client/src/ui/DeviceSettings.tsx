import { audio, prefs, usePrefs } from '../audio';
import { canFullscreen, toggleFullscreen, useFullscreen } from '../audio/fullscreen';
import { canVibrate } from '../audio/haptics';
import { MUSIC_AVAILABLE } from '../audio/music';
import { useT } from '../i18n/context';

function Switch({ id, label, checked, disabled, onChange, tag }: { id: string; label: string; checked: boolean; disabled?: boolean; onChange?: (v: boolean) => void; tag?: string }) {
  return (
    <div className="toggle-row">
      <span id={`${id}-label`} className="toggle-label">
        {label}
        {tag ? <span className="toggle-tag">{tag}</span> : null}
      </span>
      <button type="button" role="switch" className="toggle" data-setting={id} aria-checked={checked} aria-labelledby={`${id}-label`} disabled={disabled} onClick={() => onChange?.(!checked)}>
        <span className="toggle-knob" aria-hidden="true" />
      </button>
    </div>
  );
}

/** sound effects on/off, the level, and the music switch that is not live yet */
export function SoundSettings() {
  const t = useT();
  const p = usePrefs();
  return (
    <section className="stack" aria-labelledby="settings-sound">
      <h3 id="settings-sound">{t('settings.sound.title')}</h3>
      <Switch
        id="sfx"
        label={t('settings.sfx')}
        checked={p.sfx}
        onChange={(v) => {
          prefs.set({ sfx: v });
          if (v) audio.unlock(); // the tap that turns it on is the gesture the browser wants
        }}
      />
      <label className="slider-row">
        <span>{t('settings.volume')}</span>
        <input type="range" min={0} max={100} step={5} value={p.volume} disabled={!p.sfx} data-setting="volume" aria-valuetext={`${p.volume}%`} onChange={(e) => prefs.set({ volume: Number(e.target.value) })} />
        <output>{p.volume}</output>
      </label>
      <Switch id="music" label={t('settings.music')} checked={false} disabled={!MUSIC_AVAILABLE} tag={t('settings.soon')} />
    </section>
  );
}

/** animations off (always there), vibration and full screen (each only where the browser has it), independent of each other and of the sound */
export function DeviceSettings({ vibrateSupported = canVibrate(), fullscreenSupported = canFullscreen() }: { vibrateSupported?: boolean; fullscreenSupported?: boolean }) {
  const t = useT();
  const p = usePrefs();
  const full = useFullscreen();
  return (
    <section className="stack" aria-labelledby="settings-device">
      <h3 id="settings-device">{t('settings.device.title')}</h3>
      <Switch id="animations" label={t('settings.animations')} checked={!p.animations} onChange={(v) => prefs.set({ animations: !v })} />
      <p className="field-hint">{t('settings.animations.hint')}</p>
      {vibrateSupported && <Switch id="vibrate" label={t('settings.vibrate')} checked={p.vibrate} onChange={(v) => prefs.set({ vibrate: v })} />}
      {vibrateSupported && <p className="field-hint">{t('settings.vibrate.hint')}</p>}
      {fullscreenSupported && (
        <button type="button" className="btn wide" data-action="fullscreen" aria-pressed={full} onClick={() => void toggleFullscreen()}>
          {full ? t('settings.fullscreen.exit') : t('settings.fullscreen.enter')}
        </button>
      )}
    </section>
  );
}
