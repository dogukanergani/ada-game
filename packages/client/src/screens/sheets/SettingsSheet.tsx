import { useState } from 'react';
import { useT } from '../../i18n/context';
import { useApp } from '../../net/app';
import { forgetIdentity, storage } from '../../net/storage';
import { LanguageSwitch } from '../../ui/LanguageSwitch';
import { Sheet } from '../../ui/Sheet';

/** Language, and a way to forget this device's identity (leaves the room first when in one, then starts over from the entry screen). */
export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { state, api } = useApp();
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);

  const reset = async () => {
    if (!sure) return setSure(true);
    setBusy(true);
    if (state.lobby) await api.ask('room:leave');
    forgetIdentity(storage);
    window.location.reload();
  };

  return (
    <Sheet title={t('settings.title')} onClose={onClose}>
      <section className="stack" aria-labelledby="settings-lang">
        <h3 id="settings-lang">{t('lang.label')}</h3>
        <LanguageSwitch />
      </section>
      <section className="stack" aria-labelledby="settings-identity">
        <h3 id="settings-identity">{t('settings.identity.title')}</h3>
        <p className="field-hint">{t('settings.identity.body')}</p>
        <button type="button" className="btn wide" data-action="forget-identity" data-sure={sure} aria-disabled={busy} onClick={() => !busy && void reset()}>
          {sure ? t('settings.identity.sure') : t('settings.identity.reset')}
        </button>
        {sure && !busy && (
          <button type="button" className="btn quiet" onClick={() => setSure(false)}>
            {t('game.action.cancel')}
          </button>
        )}
      </section>
    </Sheet>
  );
}
