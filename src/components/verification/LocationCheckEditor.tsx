import { useState } from 'react';
import { ChevronDown, MapPin, Search } from 'lucide-react';
import { Button, Field, Input } from '@/components/ui';
import { MAX_RADIUS_M, MIN_RADIUS_M, formatCoordinate, formatRadius, validCoordinates } from '@/domain/location';
import { cn } from '@/lib/cn';
import { useServices } from '@/services/ServicesProvider';
import { MapSearchError, type Place } from '@/services/location';
import { LocationMap } from './LocationMap';

export interface LocationDraft { enabled: boolean; lat: number | null; lng: number | null; radiusM: number; label: string }

export const LOCATION_HELP = 'When enabled, the verifier’s device location is checked during verification and the result is included in the verification report. Location does not automatically block verification or entry.';

const RADII = [50, 100, 250, 500, 1000];

/**
 * Optional location check for an activity. Off by default; when it's off nothing else is shown or asked.
 * When on: search for a place, place or drag the pin on the map, choose a radius, or enter coordinates.
 */
export function LocationCheckEditor({ value, onChange, error, readOnly }: { value: LocationDraft; onChange: (v: LocationDraft) => void; error?: string | null; readOnly?: boolean }) {
  const { maps } = useServices();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Place[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [manual, setManual] = useState(!maps.available);
  // Typed coordinate text is kept as typed ("6." or "-") and only parsed into the value.
  const [text, setText] = useState({ lat: value.lat?.toString() ?? '', lng: value.lng?.toString() ?? '' });
  const parse = (raw: string) => (raw.trim() === '' ? null : Number(raw));
  // Show what was typed unless the pin moved (map click, drag or search result) since.
  const shown = (k: 'lat' | 'lng') => (Object.is(parse(text[k]), value[k]) ? text[k] : value[k]?.toString() ?? '');
  const typeCoord = (k: 'lat' | 'lng', raw: string) => {
    setText((t) => ({ ...t, [k]: raw }));
    set({ [k]: parse(raw), label: '' });
  };
  const center = value.lat !== null && value.lng !== null && validCoordinates(value.lat, value.lng) ? { lat: value.lat, lng: value.lng } : null;
  const set = (patch: Partial<LocationDraft>) => onChange({ ...value, ...patch });

  const search = async () => {
    if (q.trim().length < 3) { setSearchError('Enter at least 3 characters.'); return; }
    setSearching(true); setSearchError(null);
    try {
      setResults(await maps.searchPlaces(q));
    } catch (err) {
      setResults(null);
      setSearchError(err instanceof MapSearchError ? err.message : 'Location search failed. Try again, or enter coordinates.');
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="space-y-4">
      <label className="flex items-start gap-3">
        <input type="checkbox" role="switch" aria-checked={value.enabled} checked={value.enabled} disabled={readOnly} onChange={(e) => set({ enabled: e.target.checked })}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
        <span>
          <span className="block text-sm font-semibold text-slate-900">Enable Location Check</span>
          <span className="block text-sm text-slate-500">{LOCATION_HELP}</span>
        </span>
      </label>

      {value.enabled && (
        <section aria-label="Location settings" className="space-y-4 rounded-xl border border-slate-200 p-4">
          {maps.available ? (
            <>
              {/* Not a <form>: this sits inside the activity editor's form, and nested forms submit the outer one. */}
              <div className="flex gap-2" role="search">
                <div className="min-w-0 flex-1">
                  <label className="sr-only" htmlFor="loc-search">Search for a location or address</label>
                  <Input id="loc-search" value={q} disabled={readOnly} placeholder="Search for a location or select one on the map" onChange={(e) => { setQ(e.target.value); setSearchError(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void search(); } }} />
                </div>
                <Button type="button" onClick={() => void search()} variant="secondary" loading={searching} disabled={readOnly} icon={searching ? undefined : <Search className="h-4 w-4" />}>Search</Button>
              </div>
              {searchError && <p role="alert" className="text-sm text-red-600">{searchError}</p>}
              {results && (
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200" aria-label="Search results">
                  {results.map((r) => (
                    <li key={`${r.lat},${r.lng}`}>
                      <button type="button" className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                        onClick={() => { set({ lat: r.lat, lng: r.lng, label: r.label }); setResults(null); setQ(''); }}>
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />{r.label}
                      </button>
                    </li>
                  ))}
                  {results.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">No places found. Try another search, or place the pin on the map.</li>}
                </ul>
              )}
              <LocationMap maps={maps} center={center} radiusM={value.radiusM} onPick={readOnly ? undefined : (p) => set({ lat: p.lat, lng: p.lng })} />
              <p className="text-xs text-slate-500">Click the map to place the pin, or drag it to adjust. Map data from {maps.providerName}.</p>
            </>
          ) : (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
              Map and address search aren’t connected for this workspace, so enter the location’s coordinates below.
            </p>
          )}

          <div>
            <p className="text-sm font-medium text-slate-700">Radius</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2" role="group" aria-label="Radius presets">
              {RADII.map((r) => (
                <button key={r} type="button" disabled={readOnly} onClick={() => set({ radiusM: r })} aria-pressed={value.radiusM === r}
                  className={cn('rounded-full px-3 py-1 text-sm ring-1 ring-inset', value.radiusM === r ? 'bg-brand-50 text-brand-700 ring-brand-300' : 'text-slate-700 ring-slate-200 hover:bg-slate-50')}>{formatRadius(r)}</button>
              ))}
              <label className="flex items-center gap-1.5 text-sm text-slate-600">
                <span className="sr-only">Radius in metres</span>
                <Input type="number" min={MIN_RADIUS_M} max={MAX_RADIUS_M} step={5} className="w-24" value={value.radiusM} disabled={readOnly}
                  onChange={(e) => set({ radiusM: Number(e.target.value) })} aria-label="Radius in metres" />
                m
              </label>
            </div>
          </div>

          <div>
            <button type="button" onClick={() => setManual((m) => !m)} aria-expanded={manual} className="flex items-center gap-1 text-sm font-medium text-slate-700">
              <ChevronDown className={cn('h-4 w-4 transition-transform', manual && 'rotate-180')} aria-hidden="true" />Enter coordinates
            </button>
            {manual && (
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <Field label="Latitude" hint="e.g. 6.51740">
                  {(p) => <Input {...p} inputMode="decimal" disabled={readOnly} value={shown('lat')} onChange={(e) => typeCoord('lat', e.target.value)} />}
                </Field>
                <Field label="Longitude" hint="e.g. 3.38590">
                  {(p) => <Input {...p} inputMode="decimal" disabled={readOnly} value={shown('lng')} onChange={(e) => typeCoord('lng', e.target.value)} />}
                </Field>
              </div>
            )}
          </div>

          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 ring-1 ring-inset ring-slate-200" aria-live="polite" aria-label="Selected location">
            {center
              ? <>{value.label && <span className="block font-medium text-slate-900">{value.label}</span>}{formatCoordinate(center.lat)}, {formatCoordinate(center.lng)} · within {formatRadius(value.radiusM)}</>
              : 'No location selected yet.'}
          </p>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        </section>
      )}
    </div>
  );
}
