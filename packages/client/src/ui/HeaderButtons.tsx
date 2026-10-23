import { useEffect, useState } from 'react';
import { useT } from '../i18n/context';
import { RulesSheet } from '../screens/sheets/RulesSheet';
import { SettingsSheet } from '../screens/sheets/SettingsSheet';

/**
 * The gear (Settings) and the "?" (How to play), on every screen. They keep
 * their own sheet state and touch nothing of the screen they sit on. While the
 * game forces a sheet open (discarding, choosing a victim) both are off, and a
 * sheet already open is closed when the duty appears, so they never cover it.
 */
export function HeaderButtons({ locked = false, rules = true, vpToWin }: { locked?: boolean; rules?: boolean; vpToWin?: number }) {
  const t = useT();
  const [open, setOpen] = useState<'settings' | 'rules' | null>(null);
  useEffect(() => {
    if (locked) setOpen(null);
  }, [locked]);

  const button = (name: 'settings' | 'rules', label: string, glyph: string) => (
    <button
      type="button"
      className="btn quiet icon-button"
      data-action={name}
      aria-label={label}
      aria-disabled={locked}
      aria-haspopup="dialog"
      title={locked ? t('sheet.lockedByDuty') : label}
      onClick={() => !locked && setOpen(name)}
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );

  return (
    <div className="header-buttons">
      {rules && button('rules', t('rules.open'), '?')}
      {button('settings', t('settings.title'), '⚙')}
      {!locked && open === 'rules' && <RulesSheet onClose={() => setOpen(null)} vpToWin={vpToWin} />}
      {!locked && open === 'settings' && <SettingsSheet onClose={() => setOpen(null)} />}
    </div>
  );
}
