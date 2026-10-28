import { fireEvent, screen } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

/** A local "YYYY-MM-DDTHH:MM" value `days` from now, for datetime-local inputs. */
export function localInput(days: number, hour = 9): string {
  const d = new Date(Date.now() + days * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:00`;
}

export const cont = (user: UserEvent) => user.click(screen.getByRole('button', { name: 'Continue' }));

/**
 * Walks the activity wizard to the Verifiers step: details, then who can be verified (open, or one group),
 * an open-ended schedule starting tomorrow, then the identity source.
 */
export async function wizardToVerifiers(user: UserEvent, opts: { name: string; description?: string; group?: string; source: string }) {
  await user.type(screen.getByLabelText('Activity name'), opts.name);
  if (opts.description) await user.type(screen.getByLabelText('Description (optional)'), opts.description);
  await cont(user);
  if (opts.group) await user.click(screen.getByRole('checkbox', { name: `Select group ${opts.group}` }));
  else await user.click(screen.getByRole('radio', { name: /Open verification/ }));
  await user.click(screen.getByRole('radio', { name: /Open-ended/ }));
  fireEvent.change(screen.getByLabelText('Starts'), { target: { value: localInput(1) } });
  await cont(user);
  await user.click(screen.getByRole('radio', { name: opts.source }));
  await cont(user);
}
