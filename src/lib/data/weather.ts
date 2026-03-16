import type { ForecastDay, PacerActivity, WeatherSnapshot } from "./types.ts";

interface HourlyWeatherResponse {
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
    relative_humidity_2m?: number[];
    weather_code?: number[];
    cloud_cover?: number[];
    is_day?: number[];
  };
}

interface DailyWeatherResponse {
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
  };
}

interface WeatherFetchOptions {
  forecastDays?: number;
}

const ARCHIVE_ENDPOINT = "https://archive-api.open-meteo.com/v1/archive";
const FORECAST_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const FORECAST_DAY_COUNT = 3;

function roundTemperature(value: number | null | undefined): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }

  return Math.round(value);
}

function parseTimezoneName(value: string | undefined): string {
  if (!value) {
    return "auto";
  }

  const match = value.match(/([A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)*)$/);
  return match?.[1] ?? "auto";
}

function toActivityLocalHour(activity: PacerActivity): string | null {
  const source = activity.start_date_local || activity.start_date;

  if (!source || source.length < 13) {
    return null;
  }

  return `${source.slice(0, 13)}:00`;
}

function toDateLabel(date: string, timezone: string): string {
  const value = new Date(`${date}T12:00:00`);

  return value.toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: timezone === "auto" ? "UTC" : timezone
  });
}

function toDayPeriod(dateTime: string): string {
  const hour = Number.parseInt(dateTime.slice(11, 13), 10);

  if (hour < 6) {
    return "pre-dawn";
  }

  if (hour < 9) {
    return "morning";
  }

  if (hour < 13) {
    return "late morning";
  }

  if (hour < 18) {
    return "afternoon";
  }

  if (hour < 22) {
    return "evening";
  }

  return "night";
}

function describeWeatherCode(code: number | null | undefined): string {
  if (code === 0) {
    return "clear";
  }

  if (code === 1) {
    return "mostly clear";
  }

  if (code === 2) {
    return "partly cloudy";
  }

  if (code === 3) {
    return "overcast";
  }

  if ([45, 48].includes(code ?? -1)) {
    return "foggy";
  }

  if ([51, 53, 55, 56, 57].includes(code ?? -1)) {
    return "drizzly";
  }

  if ([61, 63, 65, 80, 81, 82].includes(code ?? -1)) {
    return "light rain";
  }

  if ([66, 67].includes(code ?? -1)) {
    return "freezing rain";
  }

  if ([71, 73, 75, 77, 85, 86].includes(code ?? -1)) {
    return "snow";
  }

  if ([95, 96, 99].includes(code ?? -1)) {
    return "stormy";
  }

  return "mixed";
}

function describeLatestRunConditions(input: {
  temperatureC: number | null;
  humidity: number | null;
  weatherCode: number | null;
  cloudCover: number | null;
  dateTime: string;
}): string {
  const { temperatureC, humidity, weatherCode, cloudCover, dateTime } = input;
  const dayPeriod = toDayPeriod(dateTime);

  if ([61, 63, 65, 80, 81, 82].includes(weatherCode ?? -1)) {
    return `light rain ${dayPeriod}`;
  }

  if ([95, 96, 99].includes(weatherCode ?? -1)) {
    return `stormy ${dayPeriod}`;
  }

  if (weatherCode === 0 || ((weatherCode === 1 || weatherCode === 2) && (cloudCover ?? 0) <= 22)) {
    return `clear ${dayPeriod}`;
  }

  if ((humidity ?? 0) >= 82 && (temperatureC ?? 0) >= 17) {
    return `humid ${dayPeriod}`;
  }

  if ((cloudCover ?? 0) >= 78 || weatherCode === 3) {
    return `overcast ${dayPeriod}`;
  }

  if ((cloudCover ?? 0) >= 38 || weatherCode === 2) {
    return `cloudy ${dayPeriod}`;
  }

  if ((temperatureC ?? 0) <= 13) {
    return `cool ${dayPeriod}`;
  }

  if ((temperatureC ?? 0) >= 28) {
    return `warm ${dayPeriod}`;
  }

  return `clear ${dayPeriod}`;
}

function describeForecastSummary(weatherCode: number | null | undefined, temperatureMaxC: number | null): string {
  if ([61, 63, 65, 80, 81, 82].includes(weatherCode ?? -1)) {
    return "light rain";
  }

  if ([95, 96, 99].includes(weatherCode ?? -1)) {
    return "storm risk";
  }

  if (weatherCode === 3) {
    return "overcast";
  }

  if (weatherCode === 2) {
    return "cloudy";
  }

  if ((temperatureMaxC ?? 0) >= 28) {
    return "warm";
  }

  if ((temperatureMaxC ?? 0) <= 14) {
    return "cool";
  }

  return describeWeatherCode(weatherCode);
}

async function fetchJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "user-agent": "run.nico.ar/1.0 (+https://run.nico.ar)"
    },
    signal: AbortSignal.timeout(7000)
  });

  if (!response.ok) {
    throw new Error(`Weather request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function getCoordinates(activity: PacerActivity): { latitude: number; longitude: number } | null {
  const [latitude, longitude] = activity.start_latlng ?? [];

  if (typeof latitude !== "number" || typeof longitude !== "number") {
    return null;
  }

  return { latitude, longitude };
}

function findNearestHourlyIndex(times: string[], target: string): number {
  const exactIndex = times.indexOf(target);

  if (exactIndex >= 0) {
    return exactIndex;
  }

  const targetTimestamp = Date.parse(target);

  if (Number.isNaN(targetTimestamp)) {
    return 0;
  }

  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const [index, value] of times.entries()) {
    const timestamp = Date.parse(value);

    if (Number.isNaN(timestamp)) {
      continue;
    }

    const distance = Math.abs(timestamp - targetTimestamp);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return bestIndex;
}

async function fetchLatestRunLabel(activity: PacerActivity, timezone: string): Promise<string | null> {
  const coordinates = getCoordinates(activity);
  const targetHour = toActivityLocalHour(activity);

  if (!coordinates || !targetHour) {
    return null;
  }

  const date = targetHour.slice(0, 10);
  const url = new URL(ARCHIVE_ENDPOINT);
  url.searchParams.set("latitude", coordinates.latitude.toString());
  url.searchParams.set("longitude", coordinates.longitude.toString());
  url.searchParams.set("start_date", date);
  url.searchParams.set("end_date", date);
  url.searchParams.set("hourly", "temperature_2m,relative_humidity_2m,weather_code,cloud_cover,is_day");
  url.searchParams.set("timezone", timezone);

  const payload = await fetchJson<HourlyWeatherResponse>(url);
  const times = payload.hourly?.time ?? [];

  if (times.length === 0) {
    return null;
  }

  const index = findNearestHourlyIndex(times, targetHour);
  const temperatureC = roundTemperature(payload.hourly?.temperature_2m?.[index]);
  const humidity = roundTemperature(payload.hourly?.relative_humidity_2m?.[index]);
  const weatherCode = payload.hourly?.weather_code?.[index] ?? null;
  const cloudCover = roundTemperature(payload.hourly?.cloud_cover?.[index]);

  if (temperatureC === null) {
    return null;
  }

  return `${temperatureC}C, ${describeLatestRunConditions({
    temperatureC,
    humidity,
    weatherCode,
    cloudCover,
    dateTime: times[index] ?? targetHour
  })}`;
}

async function fetchForecast(activity: PacerActivity, timezone: string, forecastDays: number): Promise<ForecastDay[]> {
  const coordinates = getCoordinates(activity);
  const activityDate = (activity.start_date_local || activity.start_date || "").slice(0, 10);

  if (!coordinates) {
    return [];
  }

  const url = new URL(FORECAST_ENDPOINT);
  url.searchParams.set("latitude", coordinates.latitude.toString());
  url.searchParams.set("longitude", coordinates.longitude.toString());
  url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min");
  url.searchParams.set("timezone", timezone);
  url.searchParams.set("forecast_days", Math.max(2, forecastDays + 1).toString());

  const payload = await fetchJson<DailyWeatherResponse>(url);
  const dates = payload.daily?.time ?? [];
  const weatherCodes = payload.daily?.weather_code ?? [];
  const maxValues = payload.daily?.temperature_2m_max ?? [];
  const minValues = payload.daily?.temperature_2m_min ?? [];

  return dates
    .map((date, index) => ({
      date,
      weatherCode: weatherCodes[index] ?? null,
      temperatureMaxC: roundTemperature(maxValues[index]),
      temperatureMinC: roundTemperature(minValues[index])
    }))
    .filter((entry) => entry.date > activityDate)
    .slice(0, forecastDays)
    .map((entry) => {
      const { date, weatherCode, temperatureMaxC, temperatureMinC } = entry;

      return {
        date,
        label: toDateLabel(date, timezone),
        summary: describeForecastSummary(weatherCode, temperatureMaxC),
        temperatureMaxC,
        temperatureMinC
      };
    });
}

export async function fetchWeatherSnapshot(
  activity: PacerActivity,
  options: WeatherFetchOptions = {}
): Promise<WeatherSnapshot> {
  const timezone = parseTimezoneName(activity.timezone);
  const forecastDays = options.forecastDays ?? FORECAST_DAY_COUNT;

  const [latestRunLabel, nextRunForecast] = await Promise.all([
    fetchLatestRunLabel(activity, timezone),
    fetchForecast(activity, timezone, forecastDays)
  ]);

  return {
    latestRunLabel,
    nextRunForecast
  };
}
