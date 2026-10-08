import { useState } from 'react';

/** Close with a discard confirmation when there are unsaved changes. Rendered inline, never as a stacked dialog. */
export function useGuardedClose(dirty: boolean, onClose: () => void) {
  const [confirming, setConfirming] = useState(false);
  return {
    confirming,
    requestClose: () => (dirty ? setConfirming(true) : onClose()),
    keepEditing: () => setConfirming(false),
    discard: () => { setConfirming(false); onClose(); },
  };
}
