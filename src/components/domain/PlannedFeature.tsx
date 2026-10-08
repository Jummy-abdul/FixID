import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { Badge, Button, Modal } from '@/components/ui';

export interface PlannedFeatureInfo {
  title: string;
  milestone: string;
  summary: string;
  steps?: string[];
}

const PlannedContext = createContext<((info: PlannedFeatureInfo) => void) | null>(null);

/**
 * Explicitly labelled preview for capabilities that are not built yet.
 * Never simulates success: it only explains what is planned.
 */
export function PlannedFeatureProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<PlannedFeatureInfo | null>(null);
  const close = useCallback(() => setInfo(null), []);
  return (
    <PlannedContext.Provider value={setInfo}>
      {children}
      <Modal open={!!info} onClose={close} size="md"
        title={<span className="flex items-center gap-2">{info?.title} <Badge tone="violet">Planned · {info?.milestone}</Badge></span>}
        description="This capability is not available in the current prototype milestone. Nothing has been changed."
        footer={<Button variant="secondary" onClick={close} data-autofocus>Got it</Button>}>
        {info && (
          <div className="space-y-3 text-sm text-slate-600">
            <div className="flex gap-3 rounded-lg bg-violet-50 p-3 text-violet-900">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{info.summary}</p>
            </div>
            {info.steps && (
              <ol className="list-decimal space-y-1 pl-5">
                {info.steps.map((s) => <li key={s}>{s}</li>)}
              </ol>
            )}
          </div>
        )}
      </Modal>
    </PlannedContext.Provider>
  );
}

export function usePlannedFeature() {
  const open = useContext(PlannedContext);
  if (!open) throw new Error('usePlannedFeature must be used inside PlannedFeatureProvider');
  return open;
}

export function PlannedButton({ info, children, icon, variant = 'secondary', size = 'md' }: { info: PlannedFeatureInfo; children: ReactNode; icon?: ReactNode; variant?: 'primary' | 'secondary' | 'ghost'; size?: 'sm' | 'md' }) {
  const open = usePlannedFeature();
  return (
    <Button variant={variant} size={size} icon={icon} onClick={() => open(info)}>
      {children}
      <span className={variant === 'primary' ? 'rounded bg-white/20 px-1.5 text-[10px] font-semibold uppercase tracking-wide' : 'rounded bg-violet-100 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700'}>
        Planned
      </span>
    </Button>
  );
}

/** Shared definitions so planned features are described consistently everywhere. */
export const PLANNED = {
  onboardAndIssue: {
    title: 'Add person & issue credential',
    milestone: 'Milestone 2',
    summary: 'A single guided journey that resolves the person in ID Switch, links them to your organization, collects only the FixID-specific details you need, and issues their first credential to Seamfix Wallet.',
    steps: [
      'Search ID Switch for an existing identity (name, email, phone or ID Switch ID).',
      'Link the existing identity, or request a new canonical identity when there is no match.',
      'Capture minimal organization context (relationship, unit, reference number).',
      'Choose a credential type. Defaults, identifier and validity are pre-filled.',
      'Review, issue, and deliver to Seamfix Wallet.',
    ],
  },
  issueAdditional: {
    title: 'Issue additional credential',
    milestone: 'Milestone 2',
    summary: 'Issue another credential type to a person who is already linked to your organization, without re-onboarding them.',
  },
  credentialLifecycle: {
    title: 'Credential lifecycle actions',
    milestone: 'Milestone 3',
    summary: 'Activate, suspend, revoke and renew credentials with confirmation, reason capture, wallet sync and a full audit trail.',
  },
  credentialTypeEditor: {
    title: 'Create or edit credential type',
    milestone: 'Milestone 2',
    summary: 'Define a credential type: identifier format, effective date, validity, renewal window, lifecycle rules and card design. It can also be created inline during the guided issuance journey and reused later.',
  },
  cardDesignEditor: {
    title: 'Card design editor',
    milestone: 'Milestone 3',
    summary: 'Customize colours, layout and visible fields of your digital ID card, with live preview. Every organization already has a default design.',
  },
  activityBuilder: {
    title: 'Verification activity builder',
    milestone: 'Milestone 4',
    summary: 'Configure purpose, eligibility, primary and fallback methods, assurance level, schedule and outcome. Fallbacks that would downgrade assurance are blocked.',
  },
  verifierSimulator: {
    title: 'Verifier simulator',
    milestone: 'Milestone 4',
    summary: 'Present a credential at an activity and watch the decision pipeline: credential validation → identity match → authorization → decision → transaction.',
  },
  export: {
    title: 'Export',
    milestone: 'Later milestone',
    summary: 'Export filtered transactions and audit records as CSV for investigation and reporting.',
  },
} satisfies Record<string, PlannedFeatureInfo>;
