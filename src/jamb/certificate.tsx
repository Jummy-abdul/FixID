import { useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import qrcode from 'qrcode-generator';
import { CheckCircle2, Download, Printer, ShieldAlert } from 'lucide-react';
import { Button, Card, useToast } from '@/components/ui';
import { dateTime } from './format';
import { formatDate } from '@/lib/dates';
import { institutionByCode, type StudentRecord } from './data';
import { clearanceReference, getJambState, recordOf, resolvedDiscrepancy, useJambState } from './store';
import jambLogo from './assets/jamb-logo.png';

/** What the QR code carries, so the verification page can show it on any device (demo only). */
interface Payload { r: string; n: string; g: string; i: string; s: string; d: string; o: string }
const maskReg = (reg: string) => `${reg.slice(0, 6)}•••••${reg.slice(-2)}`;
const encode = (p: Payload) => btoa(unescape(encodeURIComponent(JSON.stringify(p)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function decode(s: string | null): Payload | null {
  if (!s) return null;
  try { return JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))))) as Payload; } catch { return null; }
}

/** The address the certificate's QR code opens: the prototype's own verification page. */
export function verificationUrl(r: StudentRecord, ref: string) {
  const inst = institutionByCode(r.institution)!;
  const payload: Payload = { r: ref, n: `${r.firstName} ${r.lastName}`, g: maskReg(r.reg), i: inst.name, s: r.session, d: r.clearedAt ?? '', o: r.clearedBy ?? '' };
  return `${window.location.origin}/verify-clearance/${encodeURIComponent(ref)}?d=${encode(payload)}`;
}

export function QrCode({ text, label, size = 132 }: { text: string; label: string; size?: number }) {
  const svg = useMemo(() => {
    const q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: 3, margin: 2, scalable: true });
  }, [text]);
  return <div role="img" aria-label={label} style={{ width: size, height: size }} className="[&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** Saves the certificate as a one-page PDF (the libraries load only when asked). */
export async function downloadPdf(el: HTMLElement, fileName: string, title = 'Clearance certificate') {
  const [{ jsPDF }, { toPng }] = await Promise.all([import('jspdf'), import('html-to-image')]);
  let png: string;
  try { png = await toPng(el, { pixelRatio: 2, backgroundColor: '#ffffff' }); } catch { png = await toPng(el, { pixelRatio: 2, backgroundColor: '#ffffff', skipFonts: true }); }
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'p' });
  doc.setProperties({ title, creator: 'JAMB Identity Verification Platform' });
  const w = 190; const h = (el.offsetHeight / el.offsetWidth) * w;
  doc.addImage(png, 'PNG', 10, 10, w, Math.min(h, 277));
  doc.save(fileName);
}

/**
 * Clearance certificate / verification receipt for a cleared student. A demonstration record: clearly
 * watermarked, never an official document.
 */
export function CertificatePage({ backTo }: { backTo: (reg: string) => string }) {
  const { reg = '' } = useParams();
  const state = useJambState();
  const r = recordOf(reg, state);
  const ref = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  if (!r || r.clearance !== 'cleared') {
    return (
      <Card className="px-6 py-10 text-center">
        <h1 className="text-lg font-semibold text-slate-900">No clearance certificate</h1>
        <p className="mt-1 text-slate-500">A certificate is available only after the student has been cleared.</p>
        <Link to={backTo(reg)} className="mt-5 inline-block text-sm font-semibold text-brand-600 hover:text-brand-700">Back to the student</Link>
      </Card>
    );
  }
  const inst = institutionByCode(r.institution)!;
  const reference = clearanceReference(r)!;
  const url = verificationUrl(r, reference);
  const save = async () => {
    if (!ref.current) return;
    setSaving(true);
    try { await downloadPdf(ref.current, `clearance-${r.reg}.pdf`); toast({ tone: 'success', title: 'Certificate saved', description: `clearance-${r.reg}.pdf` }); } catch { toast({ tone: 'error', title: 'Couldn’t create the PDF', description: 'Use Print and choose “Save as PDF” instead.' }); }
    setSaving(false);
  };
  const row = (k: string, v: React.ReactNode) => <div><dt className="text-[11px] uppercase tracking-wide text-slate-500">{k}</dt><dd className="mt-0.5 font-medium text-slate-900">{v}</dd></div>;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link to={backTo(r.reg)} className="text-sm font-medium text-brand-600 hover:text-brand-700">← Back to {r.firstName} {r.lastName}</Link>
        <div className="flex gap-2">
          <Button variant="secondary" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>Print</Button>
          <Button icon={<Download className="h-4 w-4" />} loading={saving} onClick={save}>Download PDF</Button>
        </div>
      </div>
      <div ref={ref} className="relative mx-auto max-w-3xl overflow-hidden rounded-2xl border-2 border-slate-200 bg-white p-8 shadow-card print:border-slate-400 print:shadow-none" aria-label="Clearance certificate">
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center text-5xl font-black uppercase tracking-widest text-slate-900/[0.04] [transform:rotate(-24deg)]">Demonstration record</span>
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
          <div className="flex items-center gap-3">
            <img src={jambLogo} alt="Joint Admissions and Matriculation Board logo" className="h-14 w-14 object-contain" />
            <span><span className="block text-base font-semibold text-slate-900">JAMB Identity Verification</span><span className="block text-xs text-slate-500">Joint Admissions and Matriculation Board</span></span>
          </div>
          <div className="text-right">
            <p className="font-semibold text-slate-900">{inst.name}</p>
            <p className="text-xs text-slate-500">Student Clearance Unit</p>
          </div>
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-slate-900">Identity Verification &amp; Clearance Certificate</h1>
        <p className="mt-1 text-sm text-slate-600">The student below completed identity verification against their JAMB registration record and was cleared by the institution.</p>
        <div className="mt-6 grid gap-6 sm:grid-cols-[1fr_auto]">
          <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
            {row('Student name', `${r.firstName} ${r.middleName} ${r.lastName}`)}
            {row('JAMB registration number', <span className="font-mono">{r.reg}</span>)}
            {row('University', inst.name)}
            {row('Admission session', r.session)}
            {row('Department', r.department)}
            {row('Course', r.course)}
            {row('Verification outcome', <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{resolvedDiscrepancy(r.reg) === 'exam' ? 'Identity verified (examination record discrepancy resolved by JAMB)' : r.nin === 'mismatch' ? 'Identity verified (NIN discrepancy resolved by JAMB)' : 'Identity verified (JAMB and NIN match)'}</span>)}
            {row('Verification date', r.verifiedAt ? dateTime(r.verifiedAt) : '—')}
            {row('Clearance date', r.clearedAt ? dateTime(r.clearedAt) : '—')}
            {row('Clearance officer', r.clearedBy ?? '—')}
            {row('Clearance reference', <span className="font-mono">{reference}</span>)}
          </dl>
          <div className="flex flex-col items-center gap-1">
            <QrCode text={url} label={`QR code linking to the verification page for reference ${reference}`} />
            <span className="max-w-[9rem] text-center text-[11px] text-slate-500">Scan to view the verification details</span>
          </div>
        </div>
        <p className="mt-6 border-t border-slate-200 pt-4 text-[11px] text-slate-500">Issued {formatDate(new Date().toISOString())}. Demo environment.</p>
      </div>
    </>
  );
}

/**
 * Where the certificate's QR code leads (no sign-in). The code itself carries the details shown, so it works on
 * any device; when this browser also holds the record, the two are compared. A real deployment would look the
 * reference up on JAMB's servers instead.
 */
export function PublicVerificationPage() {
  const { ref = '' } = useParams();
  const [params] = useSearchParams();
  const p = decode(params.get('d'));
  const local = Object.entries(getJambState().students).find(([, o]) => o.clearanceRef === ref);
  const localRecord = local ? recordOf(local[0]) : undefined;
  const valid = !!p && p.r === ref;
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-lg space-y-4">
        <div className="flex items-center gap-3">
          <img src={jambLogo} alt="Joint Admissions and Matriculation Board logo" className="h-12 w-12 object-contain" />
          <span><span className="block font-semibold text-slate-900">JAMB Identity Verification</span><span className="block text-xs text-slate-500">Clearance verification</span></span>
        </div>
        {valid ? (
          <Card className="px-5 py-5">
            <p className="flex items-center gap-2 font-semibold text-emerald-700"><CheckCircle2 className="h-5 w-5" aria-hidden="true" />Clearance record confirmed</p>
            <dl className="mt-4 space-y-3 text-sm" aria-label="Verification details">
              {([['Reference', <span className="font-mono">{p.r}</span>], ['Student', p.n], ['JAMB registration number', <span className="font-mono">{p.g}</span>], ['Institution', p.i], ['Admission session', p.s], ['Cleared', p.d ? dateTime(p.d) : '—'], ['Clearance officer', p.o], ['Verification outcome', 'Identity verified']] as const).map(([k, v]) => (
                <div key={k} className="grid grid-cols-[10rem_1fr] gap-2"><dt className="text-slate-500">{k}</dt><dd className="text-slate-900">{v}</dd></div>
              ))}
            </dl>
            {localRecord && <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">This browser also holds the record for this reference: {localRecord.clearance === 'cleared' ? 'it is cleared and matches.' : 'it is no longer cleared.'}</p>}
          </Card>
        ) : (
          <Card className="px-5 py-5">
            <p className="flex items-center gap-2 font-semibold text-red-700"><ShieldAlert className="h-5 w-5" aria-hidden="true" />This verification link isn’t valid</p>
            <p className="mt-2 text-sm text-slate-600">Scan the QR code on the certificate again, or ask the institution for the reference.</p>
          </Card>
        )}
        <p className="text-xs text-slate-400">Demo environment</p>
      </div>
    </div>
  );
}
