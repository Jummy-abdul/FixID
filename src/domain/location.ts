/**
 * Location check for an activity: the verifier device's reported position compared with a circle
 * around the activity's location. The result is reported alongside the verification; it never changes
 * the identity or eligibility result and never decides entry on its own.
 */

export interface LocationCheckConfig {
  enabled: boolean;
  lat: number;
  lng: number;
  /** Radius of the circular area, in metres. */
  radiusM: number;
  /** Place name or address chosen by the administrator, for display. */
  label?: string;
}

export type LocationResult = 'within' | 'outside' | 'unavailable' | 'inconclusive' | 'not-required';

export interface ReportedLocation { lat: number; lng: number; accuracyM: number; capturedAt: string }

export interface LocationCheckRecord {
  result: LocationResult;
  /** What the device reported, as reported. Not a confirmed physical location. */
  reported?: ReportedLocation;
  /** Why no usable location was available. */
  reason?: string;
  /** The area the check used, kept with the record so later edits don't change it. */
  configured?: { lat: number; lng: number; radiusM: number; label?: string };
  /** Distance from the centre to the reported position, in metres. */
  distanceM?: number;
}

export const LOCATION_LABEL: Record<LocationResult, string> = {
  within: 'Within configured area', outside: 'Outside configured area', unavailable: 'Location unavailable',
  inconclusive: 'Location inconclusive', 'not-required': 'Not required',
};

export const MIN_RADIUS_M = 25;
export const MAX_RADIUS_M = 5000;

/** Great-circle distance in metres. */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const validCoordinates = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/** What's missing or wrong in a location check configuration, or null. */
export function locationConfigProblem(c?: LocationCheckConfig): string | null {
  if (!c?.enabled) return null;
  if (!validCoordinates(c.lat, c.lng)) return 'Choose the activity’s location: search for it, place a pin on the map, or enter its coordinates.';
  if (!(c.radiusM >= MIN_RADIUS_M && c.radiusM <= MAX_RADIUS_M)) return `Choose a radius between ${MIN_RADIUS_M} m and ${MAX_RADIUS_M.toLocaleString()} m.`;
  return null;
}

/**
 * Compares a reported device position with the configured circle, allowing for the reported accuracy:
 * within only when the whole accuracy circle is inside; outside only when it's entirely outside;
 * otherwise inconclusive. No position (permission denied, timeout) is unavailable, never within.
 */
export function evaluateLocation(
  config: LocationCheckConfig | undefined,
  device: { status: 'captured'; lat: number; lng: number; accuracyM: number; capturedAt: string } | { status: 'unavailable'; reason: string } | undefined,
): LocationCheckRecord {
  if (!config?.enabled) return { result: 'not-required' };
  const configured = { lat: config.lat, lng: config.lng, radiusM: config.radiusM, ...(config.label ? { label: config.label } : {}) };
  if (!device) return { result: 'unavailable', reason: 'No location was reported by the verifier’s device.', configured };
  if (device.status === 'unavailable') return { result: 'unavailable', reason: device.reason, configured };
  if (!validCoordinates(device.lat, device.lng) || !(device.accuracyM >= 0)) {
    return { result: 'unavailable', reason: 'The device reported an invalid location.', configured };
  }
  const reported = { lat: device.lat, lng: device.lng, accuracyM: Math.round(device.accuracyM), capturedAt: device.capturedAt };
  const distanceM = Math.round(distanceMeters(config, device));
  const result: LocationResult = distanceM + device.accuracyM <= config.radiusM ? 'within' : distanceM - device.accuracyM > config.radiusM ? 'outside' : 'inconclusive';
  return { result, reported, configured, distanceM };
}

export const formatCoordinate = (v: number) => v.toFixed(5);
export const formatRadius = (m: number) => (m >= 1000 ? `${(m / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} km` : `${m} m`);
