import { useMemo } from 'react';
import { BadgeCheck, UserPlus } from 'lucide-react';
import { ButtonLink, Card, DataTable, EmptyState, FilterSelect, PageHeader, Pagination, SearchInput, Tabs, usePageSlice } from '@/components/ui';
import { CredentialStatusBadge, WalletBadge } from '@/components/domain/StatusBadges';
import { usePageParam, useQueryState } from '@/hooks/useQueryState';
import { isExpiringWithin } from '@/domain/metrics';
import type { CredentialStatus } from '@/domain/types';
import { formatDate } from '@/lib/dates';
import { useOrgData } from '@/store/AppStore';

const PAGE_SIZE = 15;
const STATUSES: (CredentialStatus | 'all')[] = ['all', 'active', 'pending', 'suspended', 'revoked', 'expired'];

export function CredentialsPage() {
  const { credentials, credentialTypes, memberById, credentialTypeById } = useOrgData();
  const [q, setQ] = useQueryState('q');
  const [status, setStatus] = useQueryState('status', 'all');
  const [type, setType] = useQueryState('type', 'all');
  const [wallet, setWallet] = useQueryState('wallet', 'all');
  const [expiring, setExpiring] = useQueryState('expiring', '');
  const [page, setPage] = usePageParam();
  const now = useMemo(() => new Date(), []);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return credentials
      .filter((c) => status === 'all' || c.status === status)
      .filter((c) => type === 'all' || c.credentialTypeId === type)
      .filter((c) => wallet === 'all' || c.wallet.status === wallet)
      .filter((c) => !expiring || isExpiringWithin(c, Number(expiring), now))
      .filter((c) => !query || c.identifier.toLowerCase().includes(query) || memberById.get(c.memberId)?.displayName.toLowerCase().includes(query))
      .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  }, [credentials, q, status, type, wallet, expiring, now, memberById]);

  const counts = useMemo(() => {
    const m = new Map<string, number>([['all', credentials.length]]);
    for (const c of credentials) m.set(c.status, (m.get(c.status) ?? 0) + 1);
    return m;
  }, [credentials]);

  const { pageRows, pageCount, current } = usePageSlice(filtered, page, PAGE_SIZE);
  const hasFilters = q || type !== 'all' || wallet !== 'all' || expiring;

  return (
    <>
      <PageHeader
        title="Credentials"
        description="Credentials issued by your organization and their delivery to Seamfix Wallet."
        actions={<ButtonLink to="/users/new" variant="primary" icon={<UserPlus className="h-4 w-4" />}>Add user</ButtonLink>}
      />
      <Card>
        <div className="px-4 pt-2">
          <Tabs value={status as CredentialStatus | 'all'} onChange={setStatus}
            tabs={STATUSES.map((s) => ({ value: s, label: s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1), count: counts.get(s) ?? 0 }))} />
        </div>
        <div className="flex flex-col flex-wrap gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
          <SearchInput value={q} onChange={setQ} placeholder="Search identifier or holder" className="sm:w-72" />
          <FilterSelect label="Credential type" value={type} onChange={setType}
            options={[{ value: 'all', label: 'All types' }, ...credentialTypes.map((t) => ({ value: t.id, label: t.name }))]} />
          <FilterSelect label="Wallet delivery" value={wallet} onChange={setWallet}
            options={[{ value: 'all', label: 'Any wallet status' }, { value: 'delivered', label: 'Delivered' }, { value: 'pending', label: 'Pending' }, { value: 'failed', label: 'Failed' }, { value: 'not-sent', label: 'Not sent' }]} />
          <FilterSelect label="Expiry" value={expiring} onChange={setExpiring}
            options={[{ value: '', label: 'Any expiry' }, { value: '30', label: 'Expiring in 30 days' }, { value: '90', label: 'Expiring in 90 days' }]} />
          {hasFilters && (
            <button type="button" className="text-sm font-medium text-brand-600 hover:text-brand-700 sm:ml-auto"
              onClick={() => { setQ(''); setType('all'); setWallet('all'); setExpiring(''); }}>
              Clear filters
            </button>
          )}
        </div>
        <DataTable
          rows={pageRows}
          rowKey={(c) => c.id}
          rowHref={(c) => `/credentials/${c.id}`}
          empty={credentials.length === 0
            ? <EmptyState icon={<BadgeCheck className="h-5 w-5" />} title="No credentials issued yet" description="Credentials are issued as part of adding a person." />
            : <EmptyState title="No matching credentials" description="Try a different search or filter." />}
          columns={[
            { key: 'id', header: 'Identifier', cell: (c) => <span className="font-mono text-xs font-medium text-slate-900">{c.identifier}</span> },
            { key: 'holder', header: 'Holder', cell: (c) => memberById.get(c.memberId)?.displayName ?? '—' },
            { key: 'type', header: 'Type', cell: (c) => credentialTypeById.get(c.credentialTypeId)?.name },
            { key: 'issued', header: 'Issued', cell: (c) => <span className="text-slate-500">{formatDate(c.issuedAt)}</span> },
            { key: 'expires', header: 'Expires', cell: (c) => <span className="text-slate-500">{c.expiresAt ? formatDate(c.expiresAt) : 'No expiry'}</span> },
            { key: 'wallet', header: 'Wallet', cell: (c) => <WalletBadge status={c.wallet.status} /> },
            { key: 'status', header: 'Status', cell: (c) => <CredentialStatusBadge status={c.status} /> },
          ]}
        />
        <Pagination page={current} pageCount={pageCount} total={filtered.length} pageSize={PAGE_SIZE} onPage={setPage} />
      </Card>
    </>
  );
}
