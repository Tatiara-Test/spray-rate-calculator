import { normalizeForecast } from "./provider.mjs";

export class OpenMeteoDevelopmentProvider {
  constructor(fetchImpl = globalThis.fetch) {
    this.fetch = fetchImpl;
    this.id = "open-meteo-development";
    this.label = "Open-Meteo model forecast";
  }

  async searchLocations(query, signal) {
    const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
    url.searchParams.set("name", String(query).trim());
    url.searchParams.set("count", "8");
    url.searchParams.set("language", "en");
    url.searchParams.set("countryCode", "AU");
    const response = await this.fetch(url, { signal });
    if (!response.ok) throw new Error("Location search is unavailable.");
    const body = await response.json();
    return (body.results || []).map((item) => ({
      id: String(item.id),
      label: [item.name, item.admin1, item.country].filter(Boolean).join(", "),
      latitude: item.latitude,
      longitude: item.longitude,
      elevation: item.elevation,
      timezone: item.timezone || "Australia/Brisbane",
    }));
  }

  async fetchForecast(location, signal) {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", location.latitude);
    url.searchParams.set("longitude", location.longitude);
    url.searchParams.set("timezone", location.timezone || "auto");
    url.searchParams.set("forecast_days", "7");
    url.searchParams.set("current", "temperature_2m,relative_humidity_2m,dew_point_2m,wet_bulb_temperature_2m,precipitation,precipitation_probability,wind_speed_10m,wind_direction_10m,wind_gusts_10m");
    url.searchParams.set("hourly", "temperature_2m,relative_humidity_2m,dew_point_2m,wet_bulb_temperature_2m,precipitation,precipitation_probability,wind_speed_10m,wind_direction_10m,wind_gusts_10m");
    url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant");
    const response = await this.fetch(url, { signal });
    if (!response.ok) throw new Error("Forecast source is unavailable.");
    const body = await response.json();
    const hourly = body.hourly.time.map((time, index) => ({
      time,
      windSpeed: body.hourly.wind_speed_10m[index],
      windDirection: body.hourly.wind_direction_10m[index],
      windGust: body.hourly.wind_gusts_10m[index],
      temperature: body.hourly.temperature_2m[index],
      humidity: body.hourly.relative_humidity_2m[index],
      dewPoint: body.hourly.dew_point_2m[index],
      wetBulb: body.hourly.wet_bulb_temperature_2m[index],
      precipitation: body.hourly.precipitation[index],
      precipitationProbability: body.hourly.precipitation_probability[index],
    }));
    const daily = body.daily.time.map((date, index) => ({
      date,
      weatherCode: body.daily.weather_code[index],
      temperatureMax: body.daily.temperature_2m_max[index],
      temperatureMin: body.daily.temperature_2m_min[index],
      precipitation: body.daily.precipitation_sum[index],
      precipitationProbability: body.daily.precipitation_probability_max[index],
      windSpeedMax: body.daily.wind_speed_10m_max[index],
      windGustMax: body.daily.wind_gusts_10m_max[index],
      windDirection: body.daily.wind_direction_10m_dominant[index],
    }));
    const current = {
      time: body.current.time,
      windSpeed: body.current.wind_speed_10m,
      windDirection: body.current.wind_direction_10m,
      windGust: body.current.wind_gusts_10m,
      temperature: body.current.temperature_2m,
      humidity: body.current.relative_humidity_2m,
      dewPoint: body.current.dew_point_2m,
      wetBulb: body.current.wet_bulb_temperature_2m,
      precipitation: body.current.precipitation,
      precipitationProbability: body.current.precipitation_probability,
    };
    return normalizeForecast({
      providerId: this.id,
      providerName: this.label,
      attributionUrl: "https://open-meteo.com/",
      location,
      fetchedAt: new Date().toISOString(),
      current,
      hourly,
      daily,
    });
  }
}

