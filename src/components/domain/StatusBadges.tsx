import { Badge, type Tone } from '@/components/ui';
import { ASSURANCE_LABEL } from '@/domain/labels';
import type {
  AssuranceLevel, CredentialStatus, CredentialType, Decision, FaceEnrollmentStatus, MemberStatus, VerificationActivity, VerificationResult, WalletDeliveryStatus,
} from '@/domain/types';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ');

export function CredentialStatusBadge({ status }: { status: CredentialStatus }) {
  const tone: Record<CredentialStatus, Tone> = { active: 'success', pending: 'warning', suspended: 'warning', revoked: 'danger', expired: 'neutral' };
  return <Badge tone={tone[status]} dot>{cap(status)}</Badge>;
}

export function MemberStatusBadge({ status }: { status: MemberStatus }) {
  const tone: Record<MemberStatus, Tone> = { active: 'success', pending: 'warning', inactive: 'neutral' };
  return <Badge tone={tone[status]} dot>{cap(status)}</Badge>;
}

export const FACE_ENROLLMENT_LABEL: Record<FaceEnrollmentStatus, string> = {
  'not-enrolled': 'Not enrolled', pending: 'Pending', enrolled: 'Enrolled', expired: 'Expired', failed: 'Failed',
};

export function FaceEnrollmentBadge({ status }: { status: FaceEnrollmentStatus }) {
  const tone: Record<FaceEnrollmentStatus, Tone> = { 'not-enrolled': 'neutral', pending: 'info', enrolled: 'success', expired: 'warning', failed: 'danger' };
  return <Badge tone={tone[status]}>{FACE_ENROLLMENT_LABEL[status]}</Badge>;
}

export function DecisionBadge({ decision }: { decision: Decision }) {
  const tone: Record<Decision, Tone> = { allow: 'success', deny: 'danger', indeterminate: 'warning' };
  return <Badge tone={tone[decision]} dot>{cap(decision)}</Badge>;
}

export function ResultBadge({ result }: { result: VerificationResult }) {
  const tone: Record<VerificationResult, Tone> = { success: 'success', failed: 'danger', rejected: 'warning' };
  return <Badge tone={tone[result]}>{cap(result)}</Badge>;
}

export function WalletBadge({ status }: { status: WalletDeliveryStatus }) {
  const tone: Record<WalletDeliveryStatus, Tone> = { delivered: 'success', pending: 'info', failed: 'danger', 'not-sent': 'neutral' };
  return <Badge tone={tone[status]}>{status === 'not-sent' ? 'Not sent' : cap(status)}</Badge>;
}

export function ActivityStatusBadge({ status }: { status: VerificationActivity['status'] }) {
  const tone: Record<VerificationActivity['status'], Tone> = { active: 'success', paused: 'warning', draft: 'neutral', completed: 'info' };
  return <Badge tone={tone[status]} dot>{cap(status)}</Badge>;
}

export function TypeStatusBadge({ status }: { status: CredentialType['status'] }) {
  const tone: Record<CredentialType['status'], Tone> = { active: 'success', draft: 'neutral', retired: 'warning' };
  return <Badge tone={tone[status]} dot>{cap(status)}</Badge>;
}

export function AssuranceBadge({ level }: { level: AssuranceLevel }) {
  const tone: Record<AssuranceLevel, Tone> = { low: 'neutral', substantial: 'info', high: 'violet' };
  return <Badge tone={tone[level]}>{ASSURANCE_LABEL[level]} assurance</Badge>;
}

export function SimulatedBadge({ label = 'Simulated' }: { label?: string }) {
  return <Badge tone="warning">{label}</Badge>;
}
