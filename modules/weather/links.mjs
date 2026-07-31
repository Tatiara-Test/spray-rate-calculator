export const DEFAULT_WILLY_LINK = Object.freeze({
  id: "willyweather",
  label: "WillyWeather",
  url: "https://www.willyweather.com.au/",
  builtIn: true,
});

export function normalizeWeatherUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || "").trim());
  } catch {
    throw new TypeError("Enter a complete http:// or https:// address.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new TypeError("Only http:// and https:// links are allowed.");
  }
  if (parsed.username || parsed.password) throw new TypeError("Links cannot contain sign-in details.");
  return parsed.href;
}

export function normalizeWeatherLinks(items) {
  const input = Array.isArray(items) ? items : [];
  const result = [];
  const seen = new Set();
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const label = String(item.label || "").trim().replace(/\s+/g, " ").slice(0, 80);
    if (!label) continue;
    let url;
    try {
      url = normalizeWeatherUrl(item.url);
    } catch {
      continue;
    }
    const id = String(item.id || globalThis.crypto?.randomUUID?.() || `link-${result.length + 1}`);
    if (seen.has(id)) continue;
    seen.add(id);
    result.push({ id, label, url, builtIn: item.builtIn === true });
  }
  const builtIn = result.find((item) => item.id === DEFAULT_WILLY_LINK.id);
  return builtIn ? result : [DEFAULT_WILLY_LINK, ...result];
}

export function moveWeatherLink(items, id, direction) {
  const links = items.map((item) => ({ ...item }));
  const index = links.findIndex((item) => item.id === id);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= links.length) return links;
  [links[index], links[next]] = [links[next], links[index]];
  return links;
}

