import type { Reason } from '../game/controls';
import { handText } from '../i18n/format';
import type { Translate } from '../i18n';

/** A reason a control is off, in words. */
export function reasonText(t: Translate, r: Reason): string {
  switch (r.code) {
    case 'notYourTurn':
      return t('reason.notYourTurn');
    case 'phase':
      return t('reason.phase', { phase: t(`phase.${r.phase}`) });
    case 'missing':
      return t('reason.missing', { missing: handText(t, r.missing) });
    case 'noSpot':
      return t('reason.noSpot');
    case 'deckEmpty':
      return t('reason.deckEmpty');
  }
}

/** The short form shown inside a button: only cost problems, which the player can fix. */
export function shortReason(t: Translate, r: Reason | null): string | null {
  if (!r) return null;
  if (r.code === 'missing') return `− ${handText(t, r.missing)}`;
  if (r.code === 'noSpot') return t('reason.noSpot');
  if (r.code === 'deckEmpty') return t('reason.deckEmpty');
  return null;
}
