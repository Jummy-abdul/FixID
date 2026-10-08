import type { ReactNode } from 'react';

export function DescriptionList({ items }: { items: { label: string; value: ReactNode; hint?: ReactNode }[] }) {
  return (
    <dl className="divide-y divide-slate-100">
      {items.map((it) => (
        <div key={it.label} className="grid grid-cols-3 gap-4 py-2.5 text-sm">
          <dt className="text-slate-500">{it.label}</dt>
          <dd className="col-span-2 text-slate-900">
            {it.value}
            {it.hint && <div className="mt-0.5 text-xs text-slate-500">{it.hint}</div>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
