import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Card, DataTable, EmptyState, FilterSelect, Pagination, SearchInput, Button, usePageSlice } from '@/components/ui';
import { usePageParam, useQueryState } from '@/hooks/useQueryState';
import { formatDate } from '@/lib/dates';
import { type Institution, type Session, type StudentRecord } from './data';
import { recordsOf, useJambState } from './store';
import { CLEARANCE_FILTER, ClearanceBadge, MATRIC_FILTER, MatriculationBadge, VERIFICATION_FILTER, VerificationBadge } from './ui';

const PAGE = 20;

/** Searchable, filterable records of one institution's admission session (filters live in the URL). */
export function StudentTable({ inst, session, studentPath, showFaculty = true, showMatriculation = true }: {
  inst: Institution; session: Session; studentPath: (reg: string) => string; showFaculty?: boolean; showMatriculation?: boolean;
}) {
  const state = useJambState();
  const [q, setQ] = useQueryState('q');
  const [verification, setVerification] = useQueryState('verification', 'all');
  const [clearance, setClearance] = useQueryState('clearance', 'all');
  const [matric, setMatric] = useQueryState('matriculation', 'all');
  const [faculty, setFaculty] = useQueryState('faculty', 'all');
  const [department, setDepartment] = useQueryState('department', 'all');
  const [page, setPage] = usePageParam();
  const [, setParams] = useSearchParams();
  const all = useMemo(() => recordsOf(inst, session, state), [inst, session, state]);
  const query = q.trim().toLowerCase().replace(/\s+/g, ' ');
  const rows = useMemo(() => all.filter((r) =>
    (verification === 'all' || r.verification === verification) && (clearance === 'all' || r.clearance === clearance)
    && (matric === 'all' || r.matriculation === matric) && (faculty === 'all' || r.faculty === faculty) && (department === 'all' || r.department === department)
    && (!query || r.reg.toLowerCase().includes(query.replace(/ /g, '')) || `${r.firstName} ${r.middleName} ${r.lastName}`.toLowerCase().includes(query) || `${r.firstName} ${r.lastName}`.toLowerCase().includes(query)),
  ).sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName)), [all, verification, clearance, matric, faculty, department, query]);
  const { pageRows, pageCount, current } = usePageSlice(rows, page, PAGE);
  const departments = (faculty === 'all' ? inst.faculties : inst.faculties.filter((f) => f.name === faculty)).flatMap((f) => f.departments);
  const clear = () => setParams((prev) => { const n = new URLSearchParams(prev); ['q', 'verification', 'clearance', 'matriculation', 'faculty', 'department', 'page'].forEach((k) => n.delete(k)); return n; }, { replace: true });
  const lastVerification = (r: StudentRecord) => r.verifiedAt ?? r.exam?.at ?? r.registeredAt;

  return (
    <Card>
      <div className="flex flex-col flex-wrap gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-end">
        <SearchInput value={q} onChange={setQ} placeholder="Student name or JAMB registration number" className="sm:w-80" label="Search students" />
        <FilterSelect label="Verification status" value={verification} onChange={setVerification} options={VERIFICATION_FILTER} />
        <FilterSelect label="Clearance status" value={clearance} onChange={setClearance} options={CLEARANCE_FILTER} />
        {showMatriculation && <FilterSelect label="Matriculation status" value={matric} onChange={setMatric} options={MATRIC_FILTER} />}
        {showFaculty && <FilterSelect label="Faculty" value={faculty} onChange={(v) => { setFaculty(v); setDepartment('all'); }} options={[{ value: 'all', label: 'All faculties' }, ...inst.faculties.map((f) => ({ value: f.name, label: f.name }))]} />}
        {showFaculty && <FilterSelect label="Department" value={department} onChange={setDepartment} options={[{ value: 'all', label: 'All departments' }, ...departments.map((d) => ({ value: d, label: d }))]} />}
      </div>
      <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500" role="status">{rows.length.toLocaleString()} of {all.length.toLocaleString()} students</p>
      <DataTable rows={pageRows} rowKey={(r) => r.reg} rowHref={(r) => studentPath(r.reg)}
        empty={<EmptyState title="No students match" description="Try a different name, registration number or filter." action={<Button variant="secondary" onClick={clear}>Clear filters</Button>} />}
        columns={[
          { key: 'name', header: 'Student', className: '!whitespace-normal min-w-[10rem]', cell: (r) => <Link to={studentPath(r.reg)} className="font-medium text-slate-900 hover:text-brand-700">{r.lastName}, {r.firstName} {r.middleName}</Link> },
          { key: 'reg', header: 'JAMB registration number', cell: (r) => <span className="font-mono text-xs text-slate-700">{r.reg}</span> },
          { key: 'department', header: 'Department', className: '!whitespace-normal', cell: (r) => <span className="text-slate-600">{r.department}<span className="block text-xs text-slate-400">{r.faculty}</span></span> },
          { key: 'verification', header: 'Identity verification', cell: (r) => <VerificationBadge status={r.verification} /> },
          { key: 'clearance', header: 'Clearance', cell: (r) => <ClearanceBadge status={r.clearance} /> },
          ...(showMatriculation ? [{ key: 'matric', header: 'Matriculation', cell: (r: StudentRecord) => <MatriculationBadge status={r.matriculation} /> }] : []),
          { key: 'last', header: 'Last verification', cell: (r) => <span className="tabular-nums text-slate-600">{formatDate(lastVerification(r))}</span> },
        ]} />
      <Pagination page={current} pageCount={pageCount} total={rows.length} pageSize={PAGE} onPage={setPage} />
    </Card>
  );
}
