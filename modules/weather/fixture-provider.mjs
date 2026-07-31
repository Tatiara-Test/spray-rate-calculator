import { normalizeForecast } from "./provider.mjs";

export class FixtureWeatherProvider {
  constructor({ now = "2026-07-31T20:00:00+10:00" } = {}) {
    this.now = now;
    this.id = "fixture";
    this.label = "Deterministic QA fixture";
  }

  async searchLocations(query) {
    if (!String(query).trim()) return [];
    return [{ id: "pallathorpe-fixture", label: "Pallathorpe Farm, Darling Downs QLD", latitude: -27.2, longitude: 151.3, timezone: "Australia/Brisbane" }];
  }

  async fetchForecast(location) {
    const start = new Date(this.now);
    const hourly = Array.from({ length: 120 }, (_, index) => {
      const time = new Date(start.getTime() + index * 3_600_000);
      const cycle = Math.sin(index / 7);
      return {
        time: time.toISOString(),
        windSpeed: 12 + cycle * 5 + index / 50,
        windDirection: (65 + index * 7) % 360,
        windGust: 17 + cycle * 6,
        temperature: 18 + Math.sin(index / 5) * 7,
        humidity: 48 - Math.sin(index / 5) * 16,
        dewPoint: 7,
        wetBulb: 12,
        precipitation: index % 19 === 0 ? 0.4 : 0,
        precipitationProbability: index % 19 === 0 ? 35 : 5,
      };
    });
    const daily = Array.from({ length: 7 }, (_, index) => ({
      date: new Date(start.getTime() + index * 86_400_000).toISOString().slice(0, 10),
      weatherCode: index % 3,
      temperatureMax: 25 + index % 3,
      temperatureMin: 8 + index % 2,
      precipitation: index === 2 ? 3.2 : 0,
      precipitationProbability: index === 2 ? 55 : 10,
      windSpeedMax: 22 + index,
      windGustMax: 31 + index,
      windDirection: (70 + index * 12) % 360,
    }));
    return normalizeForecast({
      providerId: this.id,
      providerName: this.label,
      attributionUrl: "",
      location,
      fetchedAt: new Date(start).toISOString(),
      current: hourly[0],
      hourly,
      daily,
    });
  }
}

