import { useState } from 'react';
import { usePrefs } from '../audio';
import { shouldShowMotionNote, systemReducesMotion } from '../audio/motionNote';
import { useT } from '../i18n/context';
import { storage } from '../net/storage';

/** First visit, system asks for reduced motion, nothing chosen yet: tell the player where to switch the animations off. Closing it is remembered. */
export function MotionNote() {
  const t = useT();
  usePrefs(); // choosing in Settings re-renders this, and the note then goes away
  const [system] = useState(systemReducesMotion);
  const [, closed] = useState(false);
  if (!shouldShowMotionNote(storage, system)) return null;
  return (
    <div className="motion-note" role="note" data-note="motion">
      <span>{t('motionNote.body')}</span>
      <button
        type="button"
        className="btn quiet"
        data-action="dismiss-motion-note"
        onClick={() => {
          storage.set('motionNote', '1');
          closed(true);
        }}
      >
        {t('motionNote.dismiss')}
      </button>
    </div>
  );
}
