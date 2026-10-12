import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RotateCcw } from 'lucide-react';
import { Button, Card, CardBody, CardHeader, ConfirmDialog, DescriptionList, Field, Select, useToast } from '@/components/ui';
import { INDUSTRY_LABEL } from '@/domain/labels';
import { useServices } from '@/services/ServicesProvider';
import { formatDateTime } from '@/lib/dates';
import { RESET_EXPLANATION, useDemoReset } from '@/demo/useDemoReset';
import { useSession, useStore } from '@/store/AppStore';

export function DemoDataPanel() {
  const { state } = useStore();
  const { canReset, problem, reset } = useDemoReset();
  const { idSwitch } = useServices();
  const { organization, organizations, switchOrganization } = useSession();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [outage, setOutage] = useState(() => idSwitch.simulation.isOutage());
  const d = state.data;
  return (
    <Card>
      <CardHeader title="Demo data" description="Sample organizations for exploring FixID. Changes are saved in this browser." />
      <CardBody>
        <DescriptionList items={[
          { label: 'Seeded', value: formatDateTime(state.seededAt) },
          { label: 'Records', value: `${d.organizations.length} organizations · ${d.members.length} people · ${d.credentials.length} credentials · ${d.transactions.length.toLocaleString()} transactions` },
        ]} />
        <div className="mt-4 max-w-md">
          <Field label="Demo organization" hint="Crestfield Organization is brand new. The others show organizations already using FixID.">
            {(p) => (
              <Select {...p} value={organization.id} onChange={(e) => {
                switchOrganization(e.target.value);
                toast({ tone: 'info', title: `Now viewing ${organizations.find((o) => o.id === e.target.value)?.name}` });
              }}>
                {organizations.map((o) => <option key={o.id} value={o.id}>{o.name} · {INDUSTRY_LABEL[o.industry]}</option>)}
              </Select>
            )}
          </Field>
        </div>
        <label className="mt-4 flex items-start gap-3 rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-600">
          <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600" checked={outage}
            onChange={(e) => { idSwitch.simulation.setOutage(e.target.checked); setOutage(e.target.checked); }} />
          <span><span className="font-medium text-slate-800">Make the identity service unavailable</span>. Adding users fails safely, so you can see how errors are handled.</span>
        </label>
        <div className="mt-4 flex items-center justify-between gap-4 rounded-lg border border-red-200 bg-red-50/50 p-4">
          <div>
            <p className="text-sm font-medium text-slate-900">Reset demo data</p>
            <p className="text-sm text-slate-500">Restore the demonstration organizations to their original state. Organizations registered through sign-up are kept.</p>
            {problem && <p className="mt-1 text-sm text-red-700">{problem}</p>}
            <p className="mt-1 text-sm text-slate-500">Guided scenarios and account switching are in the <Link to="/demo" className="font-medium text-brand-600 hover:text-brand-700">Demo Control Centre</Link>.</p>
          </div>
          <Button variant="danger" icon={<RotateCcw className="h-4 w-4" />} disabled={!canReset} onClick={() => setConfirming(true)}>Reset</Button>
        </div>
      </CardBody>
      <ConfirmDialog
        open={confirming}
        title="Reset all demo data?"
        description={`Restores: ${RESET_EXPLANATION.restores.join(' ')} Keeps: ${RESET_EXPLANATION.keeps.join(' ')} This cannot be undone.`}
        confirmLabel="Reset demo data"
        tone="danger"
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          await new Promise((r) => setTimeout(r, 400));
          const r = reset();
          if (!r.ok) {
            setConfirming(false);
            toast({ tone: 'error', title: 'Nothing was changed', description: r.error });
            return;
          }
          setOutage(false);
          setConfirming(false);
          toast({ tone: 'success', title: 'Demo data reset', description: 'The demonstration organizations were restored to their original state.' });
        }}
      />
    </Card>
  );
}
