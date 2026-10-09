import { useState } from 'react';
import { ArrowRight, Plus } from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import { IdentifierDrawer } from '@/components/config/IdentifierDrawer';
import { previewIdentifier } from '@/domain/identifierPattern';
import type { OrgData } from '@/store/AppStore';
import type { Draft } from './draft';
import { RadioCard, StepShell } from './parts';

/** Suggestions only: none of these exist until the administrator configures and saves them. */
const SUGGESTIONS = ['Matric Number', 'Staff ID', 'Employee Number', 'Membership Number'];

export function StepIdentifier({ org, draft, update, footerStart }: {
  org: OrgData; draft: Draft; update: (patch: Partial<Draft>) => void; footerStart: React.ReactNode;
}) {
  const [drawer, setDrawer] = useState<{ open: boolean; name: string }>({ open: false, name: '' });
  const [error, setError] = useState<string | null>(null);
  const configs = org.identifierConfigs;
  const taken = new Set(configs.map((c) => c.name.toLowerCase()));
  const suggestions = SUGGESTIONS.filter((s) => !taken.has(s.toLowerCase()));

  const proceed = () => {
    if (!draft.identifierConfigId || !org.identifierConfigById.get(draft.identifierConfigId)) return setError('Select an identifier to continue.');
    update({ phase: 'details' });
  };

  return (
    <>
      <StepShell
        title="Select identifier"
        description="Choose how this person will be identified in your organization."
        footer={<>{footerStart}<Button onClick={proceed}>Continue <ArrowRight className="h-4 w-4" /></Button></>}
      >
        <div className="space-y-6">
          {configs.length > 0 && (
            <div role="radiogroup" aria-label="Your identifiers" className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {configs.map((c) => (
                <RadioCard key={c.id} checked={draft.identifierConfigId === c.id}
                  onSelect={() => { update({ identifierConfigId: c.id }); setError(null); }}
                  title={c.name}
                  badge={<Badge tone="neutral">{c.mode === 'manual' ? 'Manual' : 'Generated'}</Badge>}
                  description={c.mode === 'manual'
                    ? 'Entered for each user.'
                    : <>Next likely value: <span className="font-mono text-slate-700">{previewIdentifier(c.segments, c.nextSequence, org.organization.timezone)}</span></>} />
              ))}
            </div>
          )}

          <div>
            <p className="mb-3 text-sm font-medium text-slate-700">{configs.length > 0 ? 'Or set up another identifier' : 'Pick one to set up. You only do this once.'}</p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((name) => (
                <button key={name} type="button" onClick={() => setDrawer({ open: true, name })}
                  className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-brand-400 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                  {name}
                </button>
              ))}
              <button type="button" onClick={() => setDrawer({ open: true, name: '' })}
                className="inline-flex items-center gap-1.5 rounded-full border border-brand-300 bg-white px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                <Plus className="h-4 w-4" aria-hidden="true" /> Other
              </button>
            </div>
          </div>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        </div>
      </StepShell>

      <IdentifierDrawer open={drawer.open} suggestedName={drawer.name}
        onClose={() => setDrawer((d) => ({ ...d, open: false }))}
        onSaved={(configId) => { setDrawer((d) => ({ ...d, open: false })); update({ identifierConfigId: configId }); setError(null); }} />
    </>
  );
}
