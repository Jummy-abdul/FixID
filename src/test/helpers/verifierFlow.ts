import { fireEvent, screen, within } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';
import type { Member } from '@/domain/types';
import { statedDetails } from './identity';

type User = ReturnType<typeof userEvent.setup>;

/** Step 1 in the Verifier Workspace: enter the identifier and find the participant. */
export async function findParticipant(user: User, identifier: string) {
  const input = await screen.findByRole('textbox', { name: /./ });
  await user.clear(input);
  await user.type(input, identifier);
  await user.click(screen.getByRole('button', { name: 'Find Participant' }));
}

/**
 * Runs a guided verification for an activity that verifies stated details (name and date of birth):
 * find the participant, continue, enter the details, and verify. Returns the outcome region.
 */
export async function verifyByDetails(user: User, m: Member) {
  await findParticipant(user, m.identifier!.value);
  const found = await screen.findByRole('region', { name: 'Participant found' }, { timeout: 4000 });
  await user.click(within(found).getByRole('button', { name: /^Continue/ }));
  const details = statedDetails(m);
  await user.type(screen.getByLabelText('Full name'), details['Full name']);
  fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: details['Date of birth'] } });
  await user.click(screen.getByRole('button', { name: 'Verify Identity' }));
  return screen.findByRole('region', { name: 'Outcome' }, { timeout: 4000 });
}
