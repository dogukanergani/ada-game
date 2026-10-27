import { useEffect, useState } from 'react';

type Doc = Pick<Document, 'fullscreenElement' | 'exitFullscreen' | 'documentElement' | 'addEventListener' | 'removeEventListener'>;

export const canFullscreen = (doc: Pick<Document, 'fullscreenEnabled'> | undefined = typeof document === 'undefined' ? undefined : document): boolean => doc?.fullscreenEnabled === true;

/** Toggles full screen; a refusal (the browser may say no) is swallowed. */
export async function toggleFullscreen(doc: Doc = document): Promise<void> {
  try {
    if (doc.fullscreenElement) await doc.exitFullscreen();
    else await doc.documentElement.requestFullscreen();
  } catch {
    /* not allowed right now: nothing to do */
  }
}

/** whether the page is in full screen now, following `fullscreenchange` */
export function useFullscreen(): boolean {
  const [on, setOn] = useState(() => typeof document !== 'undefined' && !!document.fullscreenElement);
  useEffect(() => {
    const sync = () => setOn(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', sync);
    sync();
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  return on;
}
