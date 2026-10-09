import { maskEmail, newId } from '@/lib/identifiers';
import { simulateLatency } from './latency';
import type { EnrollmentService } from './types';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Mock portrait-enrollment invitations. No email is sent: the link is generated and recorded only.
 * Live capture and liveness checks belong to the enrollment experience, which isn't built yet.
 */
export function createMockEnrollment(): EnrollmentService {
  return {
    async sendInvitation({ email }) {
      await simulateLatency();
      if (!EMAIL.test(email.trim())) throw new Error("The email address on record isn't valid, so no link was created.");
      return { invitationId: newId('inv'), sentTo: maskEmail(email.trim()), simulated: true };
    },
  };
}
