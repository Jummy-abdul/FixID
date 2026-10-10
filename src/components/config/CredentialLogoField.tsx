import { useRef, useState, type ChangeEvent } from 'react';
import { Check, Upload } from 'lucide-react';
import { LOGO_TYPES, MAX_LOGO_BYTES, bytesToDataUrl, checkLogo } from '@/domain/logo';
import { newId } from '@/lib/identifiers';
import { cn } from '@/lib/cn';
import { useActions, useOrgData } from '@/store/AppStore';

function readBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(file);
  });
}

/**
 * Optional credential logo: keep the organization's initials, pick a saved logo, or upload one.
 * Uploads become reusable assets of this organization only.
 */
export function CredentialLogoField({ value, onChange, error }: { value: string; onChange: (logoAssetId: string) => void; error?: string }) {
  const { organization, logoAssets } = useOrgData();
  const { uploadLogo } = useActions();
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const initials = organization.shortName.slice(0, 3).toUpperCase();

  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setProblem(null);
    if (file.size > MAX_LOGO_BYTES) return setProblem(`The logo must be ${MAX_LOGO_BYTES / 1024} KB or smaller.`);
    setUploading(true);
    try {
      const bytes = await readBytes(file);
      const check = checkLogo(bytes, file.type || undefined);
      if (!check.ok) return setProblem(check.error);
      const r = uploadLogo({ organizationId: organization.id, at: new Date().toISOString(), id: newId('logo'), name: file.name, dataUrl: bytesToDataUrl(bytes, check.mimeType) });
      if (!r.ok) return setProblem(Object.values(r.errors)[0] ?? 'The logo couldn’t be saved.');
      onChange(r.logoAssetId);
    } catch {
      setProblem('The file couldn’t be read. Try again.');
    } finally {
      setUploading(false);
    }
  };

  const option = (selected: boolean) => cn('relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl border bg-white p-1.5 transition-colors',
    selected ? 'border-brand-500 ring-2 ring-brand-500' : 'border-slate-200 hover:border-slate-300');
  const tick = <span className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-brand-600 text-white"><Check className="h-3 w-3" aria-hidden="true" /></span>;

  return (
    <section>
      <p id="cred-logo" className="mb-2 text-sm font-medium text-slate-700">Credential logo <span className="font-normal text-slate-400">Optional</span></p>
      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-labelledby="cred-logo" className="flex flex-wrap gap-2">
          <button type="button" role="radio" aria-checked={!value} aria-label={`Organization initials (${initials})`} onClick={() => onChange('')} className={option(!value)}>
            <span className="text-sm font-bold text-slate-700">{initials}</span>{!value && tick}
          </button>
          {logoAssets.map((l) => (
            <button key={l.id} type="button" role="radio" aria-checked={value === l.id} aria-label={`Logo ${l.name}`} title={l.name} onClick={() => onChange(l.id)} className={option(value === l.id)}>
              <img src={l.dataUrl} alt="" className="h-full w-full object-contain" />{value === l.id && tick}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => input.current?.click()} disabled={uploading}
          className="inline-flex h-14 items-center gap-1.5 rounded-xl border border-dashed border-slate-300 px-3 text-sm font-medium text-slate-600 hover:border-slate-400 hover:text-slate-800 disabled:opacity-60">
          <Upload className="h-4 w-4" aria-hidden="true" />{uploading ? 'Uploading…' : 'Upload logo'}
        </button>
        <input ref={input} type="file" accept={LOGO_TYPES.join(',')} className="sr-only" tabIndex={-1} aria-label="Upload logo file" onChange={(e) => void upload(e)} />
      </div>
      <p className="mt-2 text-xs text-slate-500">PNG, JPEG or WebP, up to {MAX_LOGO_BYTES / 1024} KB. Shown in place of the initials and saved for your organization’s other credentials.</p>
      {(problem || error) && <p role="alert" className="mt-2 text-sm text-red-600">{problem ?? error}</p>}
    </section>
  );
}
