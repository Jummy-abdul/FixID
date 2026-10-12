import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { FlaskConical, Send } from 'lucide-react';
import { Badge, Button, Card, Field, Input, PageHeader, Select } from '@/components/ui';
import { DEMO_AUTH_ENABLED } from '@/auth/authCore';
import { getVerificationStatus, statusApiClients, type StatusApiResponse } from '@/services/statusApi/statusApi';
import { useActions, useSession, useStore } from '@/store/AppStore';

/**
 * Development-only demonstration of the Verification Status API. Everything here is simulated: the request
 * never leaves the browser, there's no real client authentication, and responses are labelled. It isn't
 * shown in production builds (demo mode off) and isn't in the main navigation.
 */
export function StatusApiDemoPage() {
  const { organization } = useSession();
  const { state } = useStore();
  const { recordStatusRequest } = useActions();
  const clients = statusApiClients(state);
  const own = state.data.verificationAttempts.filter((a) => a.organizationId === organization.id && a.status !== 'in-progress')
    .sort((a, b) => (b.completedAt ?? b.startedAt).localeCompare(a.completedAt ?? a.startedAt)).slice(0, 25);
  const [clientId, setClientId] = useState(`client_${organization.id}`);
  const [transactionId, setTransactionId] = useState(own[0]?.id ?? '');
  const [response, setResponse] = useState<{ request: string; res: StatusApiResponse } | null>(null);
  if (!DEMO_AUTH_ENABLED) return <Navigate to="/" replace />;

  const send = () => {
    const id = transactionId.trim();
    if (!id) return;
    const res = getVerificationStatus(state, { clientId: clientId || undefined, transactionId: id });
    recordStatusRequest(clientId || undefined, id);
    setResponse({ request: `GET /api/verifications/${encodeURIComponent(id)}/status`, res });
  };

  return (
    <>
      <PageHeader title="Verification Status API (simulated)" description="How an authorized integrating system would read a verification’s current status. Development demonstration only." />
      <p className="mb-6 flex gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-300">
        <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>Simulated: requests run in this browser against prototype data. There’s no public endpoint and no real client authentication; the calling client is a registered demonstration identity with no secret. Responses aren’t production evidence. A client may read only its own organization’s transactions, or programme-linked transactions of a programme its organization owns; anything else returns 404.</span>
      </p>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-4 px-5 py-5">
          <h2 className="text-sm font-semibold text-slate-900">Request</h2>
          <Field label="Calling client">{(p) => (
            <Select {...p} value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">No client (unauthenticated)</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          )}</Field>
          <Field label="Sample transaction" hint={`Recent transactions of ${organization.name}.`}>{(p) => (
            <Select {...p} value={own.some((a) => a.id === transactionId) ? transactionId : ''} onChange={(e) => setTransactionId(e.target.value)}>
              <option value="">Enter an ID below</option>
              {own.map((a) => <option key={a.id} value={a.id}>{a.id} · {a.activityName}</option>)}
            </Select>
          )}</Field>
          <Field label="Transaction ID">{(p) => <Input {...p} className="font-mono" value={transactionId} onChange={(e) => setTransactionId(e.target.value)} />}</Field>
          <Button icon={<Send className="h-4 w-4" />} disabled={!transactionId.trim()} onClick={send}>Request status</Button>
        </Card>
        <Card className="space-y-3 px-5 py-5" aria-label="Response">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">Response {response && <Badge tone="warning"><FlaskConical className="h-3 w-3" aria-hidden="true" />Simulated response</Badge>}</h2>
          {response ? (
            <>
              <p className="font-mono text-xs text-slate-600">{response.request}</p>
              <p className="text-sm">HTTP <span className="font-semibold" data-testid="http-status">{response.res.httpStatus}</span></p>
              <pre className="overflow-x-auto rounded-xl bg-slate-900 p-4 text-xs text-slate-100" aria-label="Response body">{JSON.stringify(response.res.body, null, 2)}</pre>
            </>
          ) : <p className="text-sm text-slate-500">Send a request to see the response.</p>}
          <ul className="list-disc space-y-1 pl-5 text-xs text-slate-500">
            <li>While an exception is unresolved the status is PENDING_REVIEW and the decision is never ALLOW.</li>
            <li>After an authorized review, the decision shows the reviewed disposition; identityMatch stays the original result, and originalDecision is included.</li>
            <li>No names, references or identity attributes are returned.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
