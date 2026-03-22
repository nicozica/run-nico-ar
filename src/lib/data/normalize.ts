import { getActivityType, isRideLike, isRunLike, sortActivitiesDesc } from "./pacer.ts";
import type {
  CoachFeedback,
  EinkSummary,
  LapSummary,
  LatestSession,
  NextRun,
  PacerActivity,
  PacerExport,
  PacerLap,
  SessionNotes,
  WeeklySnapshot,
  WeeklyTrendDay
} from "./types.ts";

interface NormalizedPacerData {
  latestSession: LatestSession;
  weeklySnapshot: WeeklySnapshot;
}

interface NormalizeOptions {
  sessionNotes?: SessionNotes | null;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatDate(value: string): string {
  return value.slice(0, 10);
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
  }

  return `${minutes}m ${remainingSeconds.toString().padStart(2, "0")}s`;
}

function formatPace(speedMetersPerSecond: number): string | null {
  if (speedMetersPerSecond <= 0) {
    return null;
  }

  const secondsPerKilometer = 1000 / speedMetersPerSecond;
  const paceMinutes = Math.floor(secondsPerKilometer / 60);
  const paceSeconds = Math.round(secondsPerKilometer % 60);
  return `${paceMinutes}:${paceSeconds.toString().padStart(2, "0")} /km`;
}

function roundOneDecimal(value: number): number {
  return Number(value.toFixed(1));
}

function averageTemperature(values: number[] | null | undefined): number | null {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  const sum = values.reduce((accumulator, value) => accumulator + value, 0);
  return roundOneDecimal(sum / values.length);
}

/**
 * Decode a Google-encoded polyline string into [lat, lng] pairs.
 * Standard algorithm: each coordinate is a variable-length zigzag-encoded integer.
 */
function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let b: number;
    let shift = 0;
    let result = 0;

    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);

    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;

    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);

    lng += result & 1 ? ~(result >> 1) : result >> 1;
    points.push([lat / 1e5, lng / 1e5]);
  }

  return points;
}

/**
 * Convert decoded route points into a normalized SVG polyline points string.
 * Returns null if the input is too sparse to be useful.
 *
 * Output format: "x1,y1 x2,y2 ..." suitable for <polyline points="...">
 * Coordinate space matches viewBox="0 0 {width} {height}".
 */
function buildRouteSvgPoints(
  points: [number, number][],
  width = 160,
  height = 90,
  step = 4
): string | null {
  if (points.length < 4) {
    return null;
  }

  // Downsample by step, always include the last point to close the route
  const sampled: [number, number][] = [];

  for (let i = 0; i < points.length; i++) {
    if (i % step === 0 || i === points.length - 1) {
      sampled.push(points[i]);
    }
  }

  const lats = sampled.map((p) => p[0]);
  const lngs = sampled.map((p) => p[1]);
  const latMin = Math.min(...lats);
  const latMax = Math.max(...lats);
  const lngMin = Math.min(...lngs);
  const lngMax = Math.max(...lngs);
  const latRange = latMax - latMin || 1;
  const lngRange = lngMax - lngMin || 1;

  // Fit within the viewBox with uniform padding
  const pad = 6;
  const drawW = width - pad * 2;
  const drawH = height - pad * 2;

  // Preserve aspect ratio: scale both axes by the same factor
  const scaleX = drawW / lngRange;
  const scaleY = drawH / latRange;
  const scale = Math.min(scaleX, scaleY);
  const offsetX = pad + (drawW - lngRange * scale) / 2;
  const offsetY = pad + (drawH - latRange * scale) / 2;

  return sampled
    .map(([lat, lng]) => {
      const x = (offsetX + (lng - lngMin) * scale).toFixed(1);
      const y = (offsetY + (latMax - lat) * scale).toFixed(1); // invert Y: SVG y grows down, lat grows up
      return `${x},${y}`;
    })
    .join(" ");
}

function formatTemperatureLabel(value: number | null): string | null {
  if (value === null) {
    return null;
  }

  return `${Math.round(value)}C`;
}

function deriveStatusLabel(activity: PacerActivity): string {
  if (isRideLike(activity)) {
    return "Support";
  }

  if (!isRunLike(activity)) {
    return "Steady";
  }

  const averageHeartRate = activity.average_heartrate ?? 0;
  const distanceKm = activity.distance / 1000;

  if (averageHeartRate >= 168 || distanceKm >= 12) {
    return "Strong";
  }

  if (averageHeartRate >= 156 || distanceKm >= 8) {
    return "Solid";
  }

  if (averageHeartRate <= 145) {
    return "Easy";
  }

  return "Steady";
}

function toLapSummary(lap: PacerLap, index: number): LapSummary {
  const distanceKm = typeof lap.distance === "number" && lap.distance > 0
    ? roundOneDecimal(lap.distance / 1000)
    : null;
  const movingTime = typeof lap.moving_time === "number" ? Math.round(lap.moving_time) : 0;
  const averageHeartRate = typeof lap.average_heartrate === "number"
    ? Math.round(lap.average_heartrate)
    : null;

  return {
    lapNumber: typeof lap.lap_index === "number" ? lap.lap_index : index + 1,
    title: typeof lap.name === "string" && lap.name.trim() ? lap.name : `Lap ${index + 1}`,
    distanceKm,
    durationLabel: formatDuration(movingTime),
    paceLabel: typeof lap.average_speed === "number" ? formatPace(lap.average_speed) : null,
    averageHeartRate
  };
}

function createLatestSession(
  source: "pacer" | "mock",
  activity: PacerActivity,
  weatherLabel: string | null,
  laps: PacerLap[],
  sessionNotes?: SessionNotes | null
): LatestSession {
  // Decode and normalize the route polyline if present
  const polyline = activity.map?.summary_polyline;
  const routeSvgPoints = polyline && polyline.length > 0
    ? buildRouteSvgPoints(decodePolyline(polyline))
    : null;

  return {
    source,
    title: activity.name,
    activityType: getActivityType(activity),
    date: formatDate(activity.start_date_local || activity.start_date),
    startDateLocal: activity.start_date_local || activity.start_date || null,
    distanceKm: activity.distance > 0 ? roundOneDecimal(activity.distance / 1000) : null,
    durationSeconds: Math.round(activity.moving_time),
    durationLabel: formatDuration(Math.round(activity.moving_time)),
    paceLabel: isRunLike(activity) ? formatPace(activity.average_speed) : null,
    averageHeartRate: typeof activity.average_heartrate === "number" ? Math.round(activity.average_heartrate) : null,
    maxHeartRate: typeof activity.max_heartrate === "number" ? Math.round(activity.max_heartrate) : null,
    elevationMeters: activity.total_elevation_gain > 0 ? Math.round(activity.total_elevation_gain) : null,
    weatherLabel,
    statusLabel: sessionNotes?.statusLabel ?? deriveStatusLabel(activity),
    overallFeeling: sessionNotes?.overallFeeling ?? null,
    personalNote: sessionNotes?.personalNote ?? null,
    locationLabel: sessionNotes?.locationLabel ?? null,
    laps: laps.map((lap, index) => toLapSummary(lap, index)),
    routeSvgPoints
  };
}

function shiftDate(referenceDate: Date, deltaDays: number): Date {
  const nextDate = new Date(referenceDate);
  nextDate.setUTCDate(referenceDate.getUTCDate() + deltaDays);
  return nextDate;
}

function formatDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildTrendDays(referenceDate: Date): WeeklyTrendDay[] {
  return Array.from({ length: 7 }, (_, index) => {
    const date = shiftDate(referenceDate, index - 6);

    return {
      date: formatDateKey(date),
      label: DAY_LABELS[date.getUTCDay()],
      distanceKm: 0
    };
  });
}

function deriveTrainingStatus(totalKm: number, runCount: number): string {
  if (totalKm >= 35 || runCount >= 5) {
    return "Building well";
  }

  if (totalKm >= 20 || runCount >= 3) {
    return "Steady base";
  }

  return "Light but consistent";
}

function deriveWeeklySummaryText(totalKm: number, runCount: number, rideKm: number): string {
  const base = `${totalKm.toFixed(1)} km across ${runCount} run${runCount === 1 ? "" : "s"}`;

  if (rideKm > 0) {
    return `${base}, plus ${rideKm.toFixed(1)} km of ride support. Enough work to build momentum without overexplaining the week.`;
  }

  return `${base}. Enough work to build momentum without overexplaining the week.`;
}

function buildWeeklySnapshot(
  source: "pacer" | "mock",
  activities: PacerActivity[],
  referenceDate: Date,
  sessionNotes?: SessionNotes | null
): WeeklySnapshot {
  const startDate = shiftDate(referenceDate, -6);
  const startTimestamp = startDate.getTime();
  const endTimestamp = referenceDate.getTime();
  const recentActivities = activities.filter((activity) => {
    const timestamp = Date.parse(activity.start_date);
    return timestamp >= startTimestamp && timestamp <= endTimestamp;
  });
  const runActivities = recentActivities.filter(isRunLike);
  const rideActivities = recentActivities.filter(isRideLike);
  const totalKm = roundOneDecimal(runActivities.reduce((accumulator, activity) => {
    return accumulator + activity.distance / 1000;
  }, 0));
  const rideKm = roundOneDecimal(rideActivities.reduce((accumulator, activity) => {
    return accumulator + activity.distance / 1000;
  }, 0));
  const totalTimeMinutes = Math.round(recentActivities.reduce((accumulator, activity) => {
    return accumulator + activity.moving_time;
  }, 0) / 60);
  const dailyDistanceKm = buildTrendDays(referenceDate);

  for (const activity of runActivities) {
    const key = formatDate((activity.start_date_local || activity.start_date));
    const day = dailyDistanceKm.find((entry) => entry.date === key);

    if (day) {
      day.distanceKm = roundOneDecimal(day.distanceKm + activity.distance / 1000);
    }
  }

  const trainingStatus = sessionNotes?.trainingStatus ?? deriveTrainingStatus(totalKm, runActivities.length);
  const summary = sessionNotes?.weeklySummary ?? deriveWeeklySummaryText(totalKm, runActivities.length, rideKm);

  return {
    source,
    windowLabel: "Rolling 7 days",
    totalKm,
    runCount: runActivities.length,
    totalTimeMinutes,
    rideCount: rideActivities.length,
    rideKm,
    summary,
    trainingStatus,
    dailyDistanceKm
  };
}

export function normalizePacerExport(
  bundle: PacerExport,
  options: NormalizeOptions = {}
): NormalizedPacerData {
  const sessionNotes = options.sessionNotes ?? null;
  const activities = sortActivitiesDesc(bundle.activities ?? []);

  if (activities.length === 0) {
    throw new Error("Pacer export does not contain any activities.");
  }

  const latestActivity = activities[0];
  const latestRun = activities.find(isRunLike) ?? latestActivity;
  const isLatestRunAlsoLatestActivity = latestActivity.id !== undefined && latestRun.id === latestActivity.id;
  const weatherLabel = isLatestRunAlsoLatestActivity
    ? formatTemperatureLabel(averageTemperature(bundle.latest_activity_temp_stream))
    : null;
  const laps = isLatestRunAlsoLatestActivity ? bundle.latest_activity_laps ?? [] : [];
  const referenceDate = new Date(latestActivity.start_date);

  return {
    latestSession: createLatestSession("pacer", latestRun, weatherLabel, laps, sessionNotes),
    weeklySnapshot: buildWeeklySnapshot("pacer", activities, referenceDate, sessionNotes)
  };
}

export function mergeLatestSessionWithNotes(
  latestSession: LatestSession,
  sessionNotes?: SessionNotes | null
): LatestSession {
  if (!sessionNotes) {
    return latestSession;
  }

  return {
    ...latestSession,
    statusLabel: sessionNotes.statusLabel ?? latestSession.statusLabel,
    overallFeeling: sessionNotes.overallFeeling ?? latestSession.overallFeeling,
    personalNote: sessionNotes.personalNote ?? latestSession.personalNote,
    weatherLabel: latestSession.weatherLabel ?? sessionNotes.weatherLabel ?? null,
    locationLabel: sessionNotes.locationLabel ?? latestSession.locationLabel
  };
}

export function mergeWeeklySnapshotWithNotes(
  weeklySnapshot: WeeklySnapshot,
  sessionNotes?: SessionNotes | null
): WeeklySnapshot {
  if (!sessionNotes) {
    return weeklySnapshot;
  }

  return {
    ...weeklySnapshot,
    trainingStatus: sessionNotes.trainingStatus ?? weeklySnapshot.trainingStatus,
    summary: sessionNotes.weeklySummary ?? weeklySnapshot.summary
  };
}

export function buildEinkSummary(input: {
  latestSession: LatestSession;
  weeklySnapshot: WeeklySnapshot;
  coachFeedback: CoachFeedback;
  nextRun: NextRun;
}): EinkSummary {
  const { latestSession, weeklySnapshot, coachFeedback, nextRun } = input;

  return {
    date: latestSession.date,
    latest_run_title: latestSession.title,
    latest_run_distance: latestSession.distanceKm === null ? "n/a" : `${latestSession.distanceKm.toFixed(1)} km`,
    weekly_km: `${weeklySnapshot.totalKm.toFixed(1)} km`,
    short_feedback: coachFeedback.summaryShort,
    next_run: nextRun.name
  };
}
