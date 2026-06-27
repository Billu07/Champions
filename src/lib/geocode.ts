import { env } from "@/lib/config";
import { logError } from "@/lib/logger";

const GEOCODE_TIMEOUT_MS = 4000;

// Small in-memory cache keyed by rounded coords. Within a warm serverless
// instance this avoids duplicate lookups and respects Nominatim's rate limit.
// An empty-string value is cached too, to avoid re-hitting a failing lookup.
const cache = new Map<string, string>();

function cacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function reverseGeocodeGoogle(lat: number, lng: number): Promise<string | null> {
  if (!env.GOOGLE_MAPS_API_KEY) return null;
  const url =
    `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}` +
    `&language=en&key=${env.GOOGLE_MAPS_API_KEY}`;
  const res = await fetchWithTimeout(url);
  const json = (await res.json().catch(() => null)) as
    | { status?: string; results?: Array<{ formatted_address?: string }> }
    | null;
  if (json?.status === "OK") {
    return json.results?.[0]?.formatted_address?.trim() || null;
  }
  return null;
}

async function reverseGeocodeNominatim(lat: number, lng: number): Promise<string | null> {
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=0` +
    `&accept-language=en&lat=${lat}&lon=${lng}`;
  // Nominatim's usage policy requires an identifying User-Agent.
  const res = await fetchWithTimeout(url, {
    headers: { "User-Agent": "ChampionFamilyOps/1.0 (ops@championfamily.com.bd)" },
  });
  const json = (await res.json().catch(() => null)) as { display_name?: string } | null;
  return json?.display_name?.trim() || null;
}

// Resolves a lat/lng pin to a human-readable place name. Tries Google (if a key
// is configured) then free OpenStreetMap; returns null if both fail, so callers
// can fall back to showing raw coordinates.
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const key = cacheKey(lat, lng);
  const cached = cache.get(key);
  if (cached !== undefined) return cached || null;

  try {
    const result = (await reverseGeocodeGoogle(lat, lng)) ?? (await reverseGeocodeNominatim(lat, lng));
    cache.set(key, result ?? "");
    return result;
  } catch (error) {
    logError("Reverse geocoding failed", { lat, lng, error: (error as Error).message });
    return null;
  }
}
