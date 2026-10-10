import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { MapsService } from '@/services/location';

const PIN = L.divIcon({
  className: '',
  html: '<span style="display:block;width:22px;height:22px;border-radius:9999px 9999px 9999px 0;transform:rotate(-45deg);background:#2563eb;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 22],
});

/**
 * Map for choosing (or showing) an activity's location: click to drop the pin, drag to adjust it.
 * The circle shows the radius. With no point chosen the map shows the world; nothing is preselected.
 */
export function LocationMap({ maps, center, radiusM, onPick, label = 'Activity location map' }: {
  maps: MapsService; center: { lat: number; lng: number } | null; radiusM: number; onPick?: (p: { lat: number; lng: number }) => void; label?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const circle = useRef<L.Circle | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { center: center ? [center.lat, center.lng] : [20, 0], zoom: center ? 15 : 2, scrollWheelZoom: false });
    L.tileLayer(maps.tileUrl, { attribution: maps.attribution, maxZoom: 19 }).addTo(m);
    if (pick.current) m.on('click', (e: L.LeafletMouseEvent) => pick.current?.({ lat: e.latlng.lat, lng: e.latlng.lng }));
    map.current = m;
    return () => { m.remove(); map.current = null; marker.current = null; circle.current = null; };
  }, [maps]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!center) {
      marker.current?.remove(); circle.current?.remove(); marker.current = null; circle.current = null;
      return;
    }
    const ll = L.latLng(center.lat, center.lng);
    if (!marker.current) {
      marker.current = L.marker(ll, { icon: PIN, draggable: !!pick.current, keyboard: false }).addTo(m);
      marker.current.on('dragend', () => { const p = marker.current!.getLatLng(); pick.current?.({ lat: p.lat, lng: p.lng }); });
    } else marker.current.setLatLng(ll);
    if (!circle.current) circle.current = L.circle(ll, { radius: radiusM, color: '#2563eb', weight: 2, fillOpacity: 0.12 }).addTo(m);
    else { circle.current.setLatLng(ll); circle.current.setRadius(radiusM); }
    try { m.fitBounds(circle.current.getBounds(), { padding: [24, 24], maxZoom: 17 }); } catch { /* no layout yet (e.g. hidden) */ }
  }, [center?.lat, center?.lng, radiusM]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={el} role="application" aria-label={label} className="h-72 w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100" />;
}
