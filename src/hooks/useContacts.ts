import { useEffect, useState } from 'react';
import { useServices } from '@/services/ServicesProvider';

export type Contacts = { status: 'loading' } | { status: 'ready'; byId: Map<string, { email?: string }> } | { status: 'error' };

/** Email addresses aren't stored in FixID; they're looked up for the visible rows only. */
export function useContacts(idSwitchIds: string[]): Contacts {
  const { idSwitch } = useServices();
  const key = idSwitchIds.join(',');
  const [state, setState] = useState<Contacts>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    idSwitch.getContacts(key ? key.split(',') : [])
      .then((byId) => { if (!cancelled) setState({ status: 'ready', byId }); })
      .catch(() => { if (!cancelled) setState({ status: 'error' }); });
    return () => { cancelled = true; };
  }, [idSwitch, key]);
  return state;
}
