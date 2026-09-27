const numberOrNull = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

export function compassDirection(degrees) {
  if (!Number.isFinite(Number(degrees))) return "—";
  const labels = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return labels[Math.round(((Number(degrees) % 360) + 360) % 360 / 22.5) % 16];
}

export function deltaT(temperature, wetBulb) {
  const dry = numberOrNull(temperature);
  const wet = numberOrNull(wetBulb);
  return dry === null || wet === null ? null : Math.max(0, dry - wet);
}

export function normalizeForecast(input) {
  if (!input || typeof input !== "object" || !Array.isArray(input.hourly) || !Array.isArray(input.daily)) {
    throw new TypeError("Weather provider returned an incomplete forecast.");
  }
  const hourly = input.hourly
    .filter((item) => item && typeof item.time === "string")
    .map((item) => ({
      time: item.time,
      windSpeed: numberOrNull(item.windSpeed),
      windDirection: numberOrNull(item.windDirection),
      windGust: numberOrNull(item.windGust),
      temperature: numberOrNull(item.temperature),
      humidity: numberOrNull(item.humidity),
      dewPoint: numberOrNull(item.dewPoint),
      wetBulb: numberOrNull(item.wetBulb),
      precipitation: numberOrNull(item.precipitation),
      precipitationProbability: numberOrNull(item.precipitationProbability),
    }));
  const daily = input.daily
    .filter((item) => item && typeof item.date === "string")
    .map((item) => ({
      date: item.date,
      weatherCode: numberOrNull(item.weatherCode),
      temperatureMax: numberOrNull(item.temperatureMax),
      temperatureMin: numberOrNull(item.temperatureMin),
      precipitation: numberOrNull(item.precipitation),
      precipitationProbability: numberOrNull(item.precipitationProbability),
      windSpeedMax: numberOrNull(item.windSpeedMax),
      windGustMax: numberOrNull(item.windGustMax),
      windDirection: numberOrNull(item.windDirection),
    }));
  if (!hourly.length || !daily.length) throw new TypeError("Weather provider returned no forecast points.");
  const currentSource = input.current || hourly[0];
  return {
    providerId: String(input.providerId || "unknown"),
    providerName: String(input.providerName || "Weather provider"),
    attributionUrl: String(input.attributionUrl || ""),
    dataKind: "forecast-model",
    location: input.location || null,
    fetchedAt: String(input.fetchedAt || new Date().toISOString()),
    current: {
      ...currentSource,
      windSpeed: numberOrNull(currentSource.windSpeed),
      windDirection: numberOrNull(currentSource.windDirection),
      windGust: numberOrNull(currentSource.windGust),
      temperature: numberOrNull(currentSource.temperature),
      humidity: numberOrNull(currentSource.humidity),
      dewPoint: numberOrNull(currentSource.dewPoint),
      wetBulb: numberOrNull(currentSource.wetBulb),
      precipitation: numberOrNull(currentSource.precipitation),
      precipitationProbability: numberOrNull(currentSource.precipitationProbability),
    },
    hourly,
    daily,
  };
}

