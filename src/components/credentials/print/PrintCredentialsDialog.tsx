import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Printer } from 'lucide-react';
import { Button, Modal, Select, useToast } from '@/components/ui';
import { CredentialCard, type CardSide, type CredentialCardContent } from '@/components/credentials/CredentialCard';
import { portraitOf } from '@/domain/portrait';
import { issuedLook, templateById } from '@/domain/templates';
import type { Credential, Member, TemplateId } from '@/domain/types';
import { useOrgData } from '@/store/AppStore';
import { ID1_MM, PRINT_SCALE, pdfFileName, printProblem } from './printing';
import { saveCardsPdf } from './pdf';

export interface NotIncluded { name: string; reason: string }

const NONE: NotIncluded[] = [];

interface Item { credential: Credential; member?: Member; templateId: TemplateId; content: CredentialCardContent; holder: string }

/** Loads each image once; resolves to the set of URLs that loaded, so a missing photo never prints as a broken image. */
function useLoadedImages(urls: string[]) {
  const key = [...new Set(urls)].sort().join('\n');
  const [state, setState] = useState<{ key: string; loaded: Set<string>; done: boolean }>({ key: '', loaded: new Set(), done: !key });
  useEffect(() => {
    const list = key ? key.split('\n') : [];
    if (!list.length) { setState({ key, loaded: new Set(), done: true }); return; }
    let cancelled = false;
    const loaded = new Set<string>();
    let settled = 0;
    setState({ key, loaded, done: false });
    for (const url of list) {
      const img = new Image();
      const finish = (ok: boolean) => {
        if (cancelled) return;
        if (ok) loaded.add(url);
        settled += 1;
        if (settled === list.length) setState({ key, loaded: new Set(loaded), done: true });
      };
      img.onload = () => finish(true);
      img.onerror = () => finish(false);
      img.src = url;
    }
    return () => { cancelled = true; };
  }, [key]);
  return state.key === key ? state : { key, loaded: new Set<string>(), done: !key };
}

/**
 * Print preparation shared by single and bulk printing. Shows the cards being prepared, prints them through
 * the browser's print dialog at ID-1 size (one page per card side), or saves the same pages as a PDF.
 * Printing only reads the issued credentials: nothing is issued, changed or recorded as a new credential.
 */
export function PrintCredentialsDialog({ open, onClose, credentialIds, notIncluded = NONE, startWith }: {
  open: boolean; onClose: () => void; credentialIds: string[]; notIncluded?: NotIncluded[]; startWith?: 'pdf';
}) {
  const { organization, credentialById, memberById, credentialTypeById, identifierConfigById, logoAssetById } = useOrgData();
  const toast = useToast();
  const [sides, setSides] = useState<'both' | 'front'>('both');
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const printRoot = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  // Only this organization's credentials that can be printed now; anything else is listed as not included.
  const { items, skipped } = useMemo(() => {
    const list: Item[] = [];
    const out: NotIncluded[] = [...notIncluded];
    for (const id of credentialIds) {
      const credential = credentialById.get(id);
      if (!credential) continue;
      const member = memberById.get(credential.memberId);
      const holder = member?.displayName ?? 'Unknown user';
      const problem = printProblem(credential);
      if (problem) { out.push({ name: holder, reason: problem }); continue; }
      const type = credentialTypeById.get(credential.credentialTypeId);
      const look = issuedLook(credential, type, type?.identifierConfigId ? identifierConfigById.get(type.identifierConfigId)?.name : undefined);
      list.push({
        credential, member, holder, templateId: look.templateId,
        content: {
          credentialName: look.credentialName, holderName: holder, identifierLabel: look.identifierLabel, identifierValue: credential.identifier,
          expiresAt: credential.expiresAt, issuedAt: credential.issuedAt, photoUrl: member ? portraitOf(member)?.url : undefined,
          logoUrl: logoAssetById.get(look.logoAssetId ?? '')?.dataUrl,
        },
      });
    }
    return { items: list, skipped: out };
  }, [credentialIds, notIncluded, credentialById, memberById, credentialTypeById, identifierConfigById, logoAssetById]);

  const images = useLoadedImages(items.flatMap((i) => [i.content.photoUrl, i.content.logoUrl].filter((u): u is string => !!u)));
  const withImages = (c: CredentialCardContent): CredentialCardContent => ({
    ...c, photoUrl: c.photoUrl && images.loaded.has(c.photoUrl) ? c.photoUrl : undefined, logoUrl: c.logoUrl && images.loaded.has(c.logoUrl) ? c.logoUrl : undefined,
  });
  const chosen = items.filter((i) => !excluded.has(i.credential.id));
  const sideList: CardSide[] = sides === 'both' ? ['front', 'back'] : ['front'];
  const pageCount = chosen.length * sideList.length;
  const ready = images.done && chosen.length > 0 && !busy;
  const bulk = items.length > 1;

  useEffect(() => { if (!open) { started.current = false; setExcluded(new Set()); setBusy(null); } }, [open]);

  const print = () => {
    // Browsers apply the first page's size to every page unless told otherwise, so the job's page size is set
    // here for the batch's orientation. Named pages in the stylesheet cover batches that mix orientations.
    const orientations = new Set(chosen.map((i) => templateById(i.templateId).orientation));
    const pageSize = orientations.size === 1 ? document.createElement('style') : null;
    if (pageSize) {
      pageSize.textContent = `@page { size: ${orientations.has('landscape') ? `${ID1_MM.long}mm ${ID1_MM.short}mm` : `${ID1_MM.short}mm ${ID1_MM.long}mm`}; margin: 0; }`;
      document.head.appendChild(pageSize);
    }
    document.body.classList.add('fixid-printing');
    const done = () => { document.body.classList.remove('fixid-printing'); pageSize?.remove(); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    try { window.print(); } finally { setTimeout(done, 0); }
  };

  const downloadPdf = async () => {
    const root = printRoot.current;
    if (!root || !chosen.length) return;
    const pages = [...root.querySelectorAll<HTMLElement>('[data-print-page]')].map((element) => ({ element, orientation: element.dataset.orientation as 'landscape' | 'portrait' }));
    setBusy('Preparing PDF…');
    try {
      const name = chosen.length === 1 ? pdfFileName([chosen[0].holder, chosen[0].content.credentialName]) : pdfFileName([organization.shortName, 'credentials', String(chosen.length)]);
      await saveCardsPdf(pages, name, chosen.length === 1 ? `${chosen[0].content.credentialName} — ${chosen[0].holder}` : `${organization.name} credentials`,
        (n, total) => setBusy(`Preparing PDF… ${n} of ${total}`));
      toast({ tone: 'success', title: 'PDF saved', description: `${chosen.length} ${chosen.length === 1 ? 'card' : 'cards'}, ${pageCount} ${pageCount === 1 ? 'page' : 'pages'}.` });
    } catch (e) {
      toast({ tone: 'error', title: 'PDF not saved', description: e instanceof Error ? e.message : 'Try again.' });
    } finally {
      setBusy(null);
    }
  };

  // "Download PDF" opened the dialog: start once the photos are ready.
  useEffect(() => {
    if (open && startWith === 'pdf' && ready && !started.current) { started.current = true; void downloadPdf(); }
  });

  const toggle = (id: string) => setExcluded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <>
      <Modal open={open} onClose={() => { if (!busy) onClose(); }} size="lg" title={bulk ? 'Print credentials' : 'Print credential'}
        description={chosen.length
          ? `${chosen.length} ${chosen.length === 1 ? 'card' : 'cards'} · ${pageCount} ${pageCount === 1 ? 'page' : 'pages'} at ID-1 card size (85.60 × 53.98 mm).`
          : 'No cards selected.'}
        footer={(
          <>
            <Button variant="secondary" onClick={onClose} disabled={!!busy}>Back</Button>
            <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => void downloadPdf()} disabled={!ready} loading={!!busy}>Download PDF</Button>
            <Button icon={<Printer className="h-4 w-4" />} onClick={print} disabled={!ready}>Print</Button>
          </>
        )}>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              Sides
              <Select value={sides} onChange={(e) => setSides(e.target.value as 'both' | 'front')} aria-label="Sides" className="w-40">
                <option value="both">Front and back</option>
                <option value="front">Front only</option>
              </Select>
            </label>
            {busy ? <p className="text-sm text-slate-600" role="status">{busy}</p> : !images.done && items.length > 0 ? <p className="text-sm text-slate-500" role="status">Loading photos…</p> : null}
          </div>

          {items.length === 0 ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">There are no active credentials to print.</p>
          ) : (
            <ul aria-label="Cards to print" className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
              {items.map((i) => {
                const on = !excluded.has(i.credential.id);
                return (
                  <li key={i.credential.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {bulk ? (
                        <label className="flex items-center gap-2 text-sm font-medium text-slate-900">
                          <input type="checkbox" checked={on} onChange={() => toggle(i.credential.id)} aria-label={`Include ${i.holder}, ${i.content.credentialName}`}
                            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                          {i.holder}
                        </label>
                      ) : <p className="text-sm font-medium text-slate-900">{i.holder}</p>}
                      <p className="text-xs text-slate-500">{i.content.credentialName} · <span className="font-mono">{i.credential.identifier}</span></p>
                    </div>
                    {on && (
                      <div className="mt-3 flex flex-wrap gap-3">
                        {sideList.map((side) => <CredentialCard key={side} templateId={i.templateId} side={side} organization={organization} content={withImages(i.content)} scale={0.55} />)}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {skipped.length > 0 && (
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm ring-1 ring-inset ring-slate-200">
              <p className="font-medium text-slate-900">Not included ({skipped.length})</p>
              <ul aria-label="Not included" className="mt-1 space-y-0.5 text-slate-600">
                {skipped.map((s, n) => <li key={`${s.name}-${n}`}>{s.name}: {s.reason}</li>)}
              </ul>
            </div>
          )}
          <p className="text-xs text-slate-500">Printing doesn’t change the credential or issue a new one. Use your printer’s actual-size (100%) setting.</p>
        </div>
      </Modal>

      {/* The print-ready pages: off screen, shown alone when printing and captured for the PDF. */}
      {open && createPortal(
        <div ref={printRoot} className="fixid-print-root" aria-hidden="true">
          {chosen.flatMap((i) => sideList.map((side) => {
            const orientation = templateById(i.templateId).orientation;
            return (
              <section key={`${i.credential.id}-${side}`} data-print-page data-orientation={orientation} className={`fixid-print-page fixid-print-page--${orientation}`}>
                <CredentialCard templateId={i.templateId} side={side} organization={organization} content={withImages(i.content)} scale={PRINT_SCALE} />
              </section>
            );
          }))}
        </div>,
        document.body,
      )}
    </>
  );
}
