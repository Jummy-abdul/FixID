import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button, Card, CardBody, CardHeader, ConfirmDialog, DescriptionList, useToast } from '@/components/ui';
import { formatDateTime } from '@/lib/dates';
import { useActions, useStore } from '@/store/AppStore';
import { STORAGE_KEY } from '@/store/state';

export function DemoDataPanel() {
  const { state } = useStore();
  const { resetDemoData } = useActions();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const d = state.data;
  return (
    <Card>
      <CardHeader title="Demo data" description="This prototype stores its data in your browser so changes persist across reloads." />
      <CardBody>
        <DescriptionList items={[
          { label: 'Seeded', value: formatDateTime(state.seededAt) },
          { label: 'Storage key', value: <span className="font-mono text-xs">{STORAGE_KEY}</span> },
          { label: 'Records', value: `${d.organizations.length} organizations · ${d.members.length} people · ${d.credentials.length} credentials · ${d.transactions.length.toLocaleString()} transactions` },
        ]} />
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
        description="All organizations, people, credentials and transactions will be restored to the original demo state. This cannot be undone."
        confirmLabel="Reset demo data"
        tone="danger"
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          await new Promise((r) => setTimeout(r, 400));
          resetDemoData();
          setConfirming(false);
          toast({ tone: 'success', title: 'Demo data reset', description: 'All organizations were restored to their original state.' });
        }}
      />
    </Card>
  );
}
