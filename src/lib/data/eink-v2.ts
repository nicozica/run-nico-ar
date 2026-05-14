import type {
  CoachFeedback,
  EinkSummaryV3,
  EinkSummaryV2,
  ForecastDay,
  LatestSession,
  NextRun,
  WeeklySnapshot
} from "./types.ts";

const EINK_V2_TIMEZONE = "America/Argentina/Buenos_Aires";
const EINK_V2_ROTATE_SECONDS = 45;

function formatUpdatedLabel(date: Date): string {
  const time = formatUpdatedTime(date);

  return `Updated ${time}`;
}

function formatUpdatedTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: EINK_V2_TIMEZONE
  }).format(date);
}

function formatDateLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}

function formatDateLabelV3(date: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  }).formatToParts(new Date(`${date}T12:00:00Z`));
  const getPart = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;

  return `${getPart("weekday")} ${getPart("month")} ${getPart("day")}`;
}

function compactText(value: string | null | undefined, maxLength: number): string {
  const source = (value ?? "").replace(/\s+/g, " ").trim();

  if (!source) {
    return "—";
  }

  if (source.length <= maxLength) {
    return source;
  }

  const sentenceParts = source.split(/[.!?]/).map((part) => part.trim()).filter(Boolean);

  if (sentenceParts.length > 0 && sentenceParts[0].length <= maxLength) {
    return sentenceParts[0];
  }

  const commaParts = source.split(",").map((part) => part.trim()).filter(Boolean);
  let composed = "";

  for (const part of commaParts) {
    const candidate = composed ? `${composed}, ${part}` : part;

    if (candidate.length > maxLength) {
      break;
    }

    composed = candidate;
  }

  if (composed) {
    return composed;
  }

  return `${source.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function formatDistance(distanceKm: number | null): string {
  return distanceKm === null ? "—" : `${distanceKm.toFixed(1)} km`;
}

function formatWeekKm(totalKm: number): string {
  return `${totalKm.toFixed(1)} km`;
}

function formatTotalTime(totalTimeMinutes: number): string {
  return `${totalTimeMinutes} min`;
}

function formatTotalTimeV3(totalTimeMinutes: number): string {
  const hours = Math.floor(totalTimeMinutes / 60);
  const minutes = totalTimeMinutes % 60;

  return `${hours}h ${minutes.toString().padStart(2, "0")}min`;
}

function formatTemperatureRange(day: ForecastDay | undefined): string | null {
  if (!day) {
    return null;
  }

  const min = day.temperatureMinC;
  const max = day.temperatureMaxC;

  if (min === null && max === null) {
    return null;
  }

  if (min !== null && max !== null) {
    return `${min}-${max}C`;
  }

  return `${min ?? max}C`;
}

function formatTemperatureRangeV3(day: ForecastDay | undefined): string {
  if (!day) {
    return "—°C";
  }

  const min = day.temperatureMinC;
  const max = day.temperatureMaxC;

  if (min !== null && max !== null) {
    return `${min}-${max}°C`;
  }

  return `${min ?? max ?? "—"}°C`;
}

function buildWeekWeather(input: {
  latestSession: LatestSession;
  nextRun: NextRun;
}): {
  weather_label: string | null;
  weather_temp: string | null;
  weather_note: string | null;
} {
  const nextWeather = input.nextRun.forecast?.[0];

  if (nextWeather) {
    return {
      weather_label: nextWeather.label,
      weather_temp: formatTemperatureRange(nextWeather),
      weather_note: compactText(nextWeather.summary, 22)
    };
  }

  const latestWeather = input.latestSession.weatherLabel;

  if (!latestWeather) {
    return {
      weather_label: null,
      weather_temp: null,
      weather_note: null
    };
  }

  const [temp, note] = latestWeather.split(",").map((part) => part.trim());

  return {
    weather_label: "Latest",
    weather_temp: temp || null,
    weather_note: note ? compactText(note, 22) : null
  };
}

function buildLatestFeedback(coachFeedback: CoachFeedback): string {
  if (coachFeedback.summaryShort) {
    return compactText(coachFeedback.summaryShort, 52);
  }

  return compactText(coachFeedback.mainTakeaway, 52);
}

function buildNextGoal(nextRun: NextRun): string {
  return compactText(nextRun.goal, 44);
}

function buildNextGoalV3(nextRun: NextRun): string {
  const source = (nextRun.goal || "—").replace(/\s+/g, " ").trim();
  const withoutFinalPunctuation = source.replace(/[.!?…]+$/u, "");
  const sentence = withoutFinalPunctuation.split(/[.!?]/).map((part) => part.trim()).find(Boolean);

  if (sentence && sentence.length <= 59) {
    return `${sentence}.`;
  }

  const sliced = withoutFinalPunctuation.slice(0, 59).trimEnd().replace(/[.!?…,:;-]+$/u, "");
  const lastSpaceIndex = sliced.lastIndexOf(" ");
  const trimmed = lastSpaceIndex > 0 ? sliced.slice(0, lastSpaceIndex) : sliced;

  return `${trimmed || "—"}.`;
}

function formatNextDetail(nextRun: NextRun): string {
  const pace = nextRun.paceRange.replace(/\s*\/km\b/, "/km");

  return `${nextRun.estimatedDuration} · ${pace}`;
}

export function buildEinkSummaryV2(input: {
  latestSession: LatestSession;
  weeklySnapshot: WeeklySnapshot;
  coachFeedback: CoachFeedback;
  nextRun: NextRun;
  now?: Date;
}): EinkSummaryV2 {
  const { latestSession, weeklySnapshot, coachFeedback, nextRun } = input;
  const now = input.now ?? new Date();
  const weekWeather = buildWeekWeather({ latestSession, nextRun });

  return {
    meta: {
      version: 2,
      generated_at: now.toISOString(),
      updated_label: formatUpdatedLabel(now),
      rotate_seconds: EINK_V2_ROTATE_SECONDS
    },
    screens: [
      {
        id: "latest",
        title: compactText(latestSession.title, 22),
        date: formatDateLabel(latestSession.date),
        distance: formatDistance(latestSession.distanceKm),
        weekly_km: formatWeekKm(weeklySnapshot.totalKm),
        feedback: buildLatestFeedback(coachFeedback)
      },
      {
        id: "next",
        title: "Next run",
        name: compactText(nextRun.name, 22),
        duration: nextRun.estimatedDuration,
        pace_range: nextRun.paceRange,
        goal: buildNextGoal(nextRun)
      },
      {
        id: "week",
        title: "This week",
        weekly_km: formatWeekKm(weeklySnapshot.totalKm),
        runs: weeklySnapshot.runCount,
        total_time: formatTotalTime(weeklySnapshot.totalTimeMinutes),
        weather_label: weekWeather.weather_label,
        weather_temp: weekWeather.weather_temp,
        weather_note: weekWeather.weather_note
      }
    ]
  };
}

export function buildEinkSummaryV3(input: {
  latestSession: LatestSession;
  weeklySnapshot: WeeklySnapshot;
  nextRun: NextRun;
  now?: Date;
}): EinkSummaryV3 {
  const { latestSession, weeklySnapshot, nextRun } = input;
  const now = input.now ?? new Date();
  const nextWeather = nextRun.forecast?.[0];

  return {
    meta: {
      version: 3,
      updated: formatUpdatedTime(now)
    },
    last_run: {
      type: latestSession.activityType,
      km: formatDistance(latestSession.distanceKm),
      date: formatDateLabelV3(latestSession.date)
    },
    next: {
      name: compactText(nextRun.name, 24),
      detail: formatNextDetail(nextRun),
      goal: buildNextGoalV3(nextRun)
    },
    week: {
      km: formatWeekKm(weeklySnapshot.totalKm),
      runs: `${weeklySnapshot.runCount} runs`,
      time: formatTotalTimeV3(weeklySnapshot.totalTimeMinutes)
    },
    weather: {
      day: nextWeather?.label ?? "—",
      temp: formatTemperatureRangeV3(nextWeather),
      note: compactText(nextWeather?.summary, 22)
    }
  };
}
