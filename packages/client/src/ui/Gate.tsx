import { useApp } from '../net/app';
import { useT } from '../i18n/context';
import { LanguageSwitch } from './LanguageSwitch';

/** Full-screen states that replace the app: the page is out of date, or the identity moved to another tab. */
export function IncompatibleScreen() {
  const t = useT();
  return (
    <main className="gate" role="alert">
      <h1>{t('conn.incompatible.title')}</h1>
      <p>{t('conn.incompatible.body')}</p>
      <button type="button" className="btn primary" onClick={() => window.location.reload()}>
        {t('conn.incompatible.reload')}
      </button>
      <LanguageSwitch />
    </main>
  );
}

export function ReplacedScreen() {
  const t = useT();
  const { api } = useApp();
  return (
    <main className="gate" role="alert">
      <h1>{t('app.name')}</h1>
      <p>{t('conn.replaced')}</p>
      <button type="button" className="btn primary" onClick={api.takeBack}>
        {t('conn.takeBack')}
      </button>
      <LanguageSwitch />
    </main>
  );
}
