import { WEATHER_CACHE_KEY } from "../storage.mjs";

export const WEATHER_FRESH_MS = 20 * 60 * 1000;

export function cacheState(entry, now = Date.now(), freshMs = WEATHER_FRESH_MS) {
  if (!entry?.savedAt || !entry?.forecast) return { available: false, fresh: false, stale: false, ageMs: null };
  const saved = Date.parse(entry.savedAt);
  if (!Number.isFinite(saved)) return { available: false, fresh: false, stale: false, ageMs: null };
  const ageMs = Math.max(0, now - saved);
  return { available: true, fresh: ageMs <= freshMs, stale: ageMs > freshMs, ageMs };
}

export function cacheMatchesLocation(entry, location) {
  const cached = entry?.forecast?.location;
  if (!cached || !location) return false;
  if (cached.id && location.id) return String(cached.id) === String(location.id);
  return Number(cached.latitude) === Number(location.latitude) &&
    Number(cached.longitude) === Number(location.longitude);
}

export function readWeatherCache(storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage.getItem(WEATHER_CACHE_KEY));
    return cacheState(value).available ? value : null;
  } catch {
    return null;
  }
}

export function writeWeatherCache(forecast, storage = globalThis.localStorage, now = new Date().toISOString()) {
  const entry = { savedAt: now, forecast };
  storage.setItem(WEATHER_CACHE_KEY, JSON.stringify(entry));
  return entry;
}
