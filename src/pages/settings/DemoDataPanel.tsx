import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button, Card, CardBody, CardHeader, ConfirmDialog, DescriptionList, Field, Select, useToast } from '@/components/ui';
import { INDUSTRY_LABEL } from '@/domain/labels';
import { useServices } from '@/services/ServicesProvider';
import { formatDateTime } from '@/lib/dates';
import { useActions, useSession, useStore } from '@/store/AppStore';

export function DemoDataPanel() {
  const { state } = useStore();
  const { resetDemoData } = useActions();
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
          <Field label="Demo organization" hint="Crestfield Academy is brand new. The others show organizations already using FixID.">
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
            <p className="text-sm text-slate-500">Restore every organization to the original demo state. Your changes will be lost.</p>
          </div>
          <Button variant="danger" icon={<RotateCcw className="h-4 w-4" />} onClick={() => setConfirming(true)}>Reset</Button>
        </div>
      </CardBody>
      <ConfirmDialog
        open={confirming}
        title="Reset all demo data?"
        description="All organizations, people, credentials and transactions will be restored to the original demo state, and people added since are removed. This cannot be undone."
        confirmLabel="Reset demo data"
        tone="danger"
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          await new Promise((r) => setTimeout(r, 400));
          resetDemoData();
          idSwitch.simulation.reset();
          setOutage(false);
          try {
            Object.keys(window.sessionStorage).filter((k) => k.startsWith('fixid.prototype.addUserDraft.')).forEach((k) => window.sessionStorage.removeItem(k));
          } catch {
            /* nothing to clear */
          }
          setConfirming(false);
          toast({ tone: 'success', title: 'Demo data reset', description: 'All organizations were restored to their original state.' });
        }}
      />
    </Card>
  );
}
