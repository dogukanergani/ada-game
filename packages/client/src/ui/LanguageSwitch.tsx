import { useI18n } from '../i18n/context';
import { LOCALES } from '../i18n';

export function LanguageSwitch() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div className="lang-switch" role="group" aria-label={t('lang.label')}>
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          className="lang-button"
          aria-pressed={locale === l}
          lang={l}
          onClick={() => setLocale(l)}
        >
          {l === 'tr' ? t('lang.tr') : t('lang.en')}
        </button>
      ))}
    </div>
  );
}
