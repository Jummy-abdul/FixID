/**
 * Location integration boundaries.
 *
 * Maps: address search and map tiles for choosing an activity's location. The default adapter uses
 * OpenStreetMap (tiles) and Nominatim (search), which are public services with usage limits suitable
 * for a prototype only; production needs a contracted provider. Set VITE_MAP_PROVIDER=none to turn
 * maps off: location can then still be set by entering coordinates.
 *
 * Device location: the verifier's device position at verification time, from the browser's
 * Geolocation API. It is the device's reported position, not proof of where the participant is.
 */

export interface Place { label: string; lat: number; lng: number }

export interface MapsService {
  /** False when no map provider is connected: search and the map are unavailable. */
  available: boolean;
  providerName: string;
  tileUrl: string;
  attribution: string;
  searchPlaces(query: string): Promise<Place[]>;
}

export type DeviceLocation =
  | { status: 'captured'; lat: number; lng: number; accuracyM: number; capturedAt: string }
  | { status: 'unavailable'; reason: string };

export interface GeolocationService {
  /** Asks the device for its current position. Only call it when an activity requires a location check. */
  getCurrentPosition(): Promise<DeviceLocation>;
}

export class MapSearchError extends Error {}

export function createOsmMaps(fetcher: typeof fetch = (...a) => fetch(...a)): MapsService {
  return {
    available: true,
    providerName: 'OpenStreetMap',
    tileUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    async searchPlaces(query) {
      const q = query.trim();
      if (q.length < 3) return [];
      let res: Response;
      try {
        res = await fetcher(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json' } });
      } catch {
        throw new MapSearchError('Location search isn’t reachable right now. Try again, or enter coordinates.');
      }
      if (!res.ok) throw new MapSearchError('Location search isn’t available right now. Try again, or enter coordinates.');
      const rows = (await res.json()) as { display_name: string; lat: string; lon: string }[];
      return rows.map((r) => ({ label: r.display_name, lat: Number(r.lat), lng: Number(r.lon) })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    },
  };
}

/** No map provider connected. */
export const NO_MAPS: MapsService = {
  available: false, providerName: 'None', tileUrl: '', attribution: '',
  async searchPlaces() { return []; },
};

export function createDefaultMaps(): MapsService {
  return import.meta.env.VITE_MAP_PROVIDER === 'none' ? NO_MAPS : createOsmMaps();
}

const GEO_ERRORS: Record<number, string> = {
  1: 'Location permission was denied on the verifier’s device.',
  2: 'The device couldn’t determine its location.',
  3: 'The device took too long to report its location.',
};

export function createBrowserGeolocation(timeoutMs = 15_000): GeolocationService {
  return {
    getCurrentPosition() {
      return new Promise((resolve) => {
        if (typeof navigator === 'undefined' || !navigator.geolocation) {
          resolve({ status: 'unavailable', reason: 'This device or browser doesn’t provide location.' });
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (p) => resolve({ status: 'captured', lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: Math.round(p.coords.accuracy), capturedAt: new Date(p.timestamp || Date.now()).toISOString() }),
          (e) => resolve({ status: 'unavailable', reason: GEO_ERRORS[e.code] ?? 'The device’s location couldn’t be read.' }),
          { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
        );
      });
    },
  };
}
