import type {
  CoachFeedback,
  ForecastDay,
  LapSummary,
  LatestSession,
  NextRun,
  PacerActivity,
  WeeklySnapshot,
  WeeklyTrendDay
} from "./types.ts";

export interface PacerCmsSessionManual {
  sessionType: string;
  legs: string;
  sleepScore: number | null;
  restedness: string;
  extraNotes: string;
}

export interface PacerCmsSessionFiles {
  tcxFilename: string;
  tcxAttached: boolean;
  briefFilename: string;
}

export interface PacerCmsSessionAi {
  signalTitle: string;
  signalParagraphs: string[];
  carryForward: string;
  nextRunTitle: string;
  nextRunSummary: string;
  nextRunDurationMin: number | null;
  nextRunDurationMax: number | null;
  nextRunDistanceKm: number | null;
  nextRunPaceMinSecPerKm: number | null;
  nextRunPaceMaxSecPerKm: number | null;
  weekTitle: string;
  weekSummary: string;
}

export interface PacerCmsLap {
  id: number | null;
  lapIndex: number;
  distanceM: number | null;
  durationS: number | null;
  paceSecPerKm: number | null;
  hrAvg: number | null;
}

export interface PacerCmsLatestSession {
  sessionId: number;
  sourceActivityId: number;
  sessionDate: string;
  startDateLocal: string | null;
  title: string;
  sport: string;
  distanceM: number | null;
  movingTimeS: number | null;
  elapsedTimeS: number | null;
  paceSecPerKm: number | null;
  hrAvg: number | null;
  hrMax: number | null;
  elevationM: number | null;
  weatherTempC: number | null;
  weatherCondition: string | null;
  weatherWindKmh: number | null;
  city: string | null;
  startLat: number | null;
  startLon: number | null;
  routeSvgPoints: string | null;
  manual: PacerCmsSessionManual;
  files: PacerCmsSessionFiles;
  ai: PacerCmsSessionAi;
  laps: PacerCmsLap[];
  updatedAt: string;
}

export interface PacerCmsNextRun {
  fromSessionId: number;
  sessionDate: string;
  title: string;
  summary: string;
  durationMin: number | null;
  durationMax: number | null;
  distanceKm: number | null;
  paceMinSecPerKm: number | null;
  paceMaxSecPerKm: number | null;
  workout?: {
    type: string;
    blocks: string[];
  } | null;
  updatedAt: string;
}

export interface PacerCmsWeeklyBar {
  date: string;
  label: string;
  distanceKm: number;
}

export interface PacerCmsWeeklySummary {
  id: number;
  snapshotDate: string;
  windowStart: string;
  windowEnd: string;
  totalKm: number;
  totalRuns: number;
  totalTimeS: number;
  title: string | null;
  summary: string | null;
  bars: PacerCmsWeeklyBar[];
}

export interface PacerCmsArchiveItem {
  sessionId: number;
  sessionDate: string;
  startDateLocal: string | null;
  title: string;
  sport: string;
  sessionType: string | null;
  distanceM: number | null;
  movingTimeS: number | null;
  paceSecPerKm: number | null;
  signalTitle: string | null;
  nextRunTitle: string | null;
  updatedAt: string;
}

export interface PacerCmsArchiveList {
  count: number;
  sessions: PacerCmsArchiveItem[];
}

function slugifySegment(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function roundOneDecimal(value: number): number {
  return Number(value.toFixed(1));
}

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) {
    return "—";
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
  }

  return `${minutes}m ${remainingSeconds.toString().padStart(2, "0")}s`;
}

function formatPaceLabel(value: number | null): string | null {
  if (!value || value <= 0) {
    return null;
  }

  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")} /km`;
}

function formatPaceRange(minValue: number | null, maxValue: number | null): string {
  const minLabel = formatPaceLabel(minValue)?.replace(" /km", "") ?? null;
  const maxLabel = formatPaceLabel(maxValue)?.replace(" /km", "") ?? null;

  if (minLabel && maxLabel) {
    return minLabel === maxLabel ? `${minLabel} /km` : `${minLabel}-${maxLabel} /km`;
  }

  return minLabel ?? maxLabel ?? "—";
}

function formatDurationRange(minValue: number | null, maxValue: number | null): string {
  if (typeof minValue === "number" && typeof maxValue === "number") {
    return minValue === maxValue ? `${minValue} min` : `${minValue}-${maxValue} min`;
  }

  if (typeof minValue === "number") {
    return `${minValue} min`;
  }

  if (typeof maxValue === "number") {
    return `${maxValue} min`;
  }

  return "—";
}

function formatWeatherLabel(snapshot: PacerCmsLatestSession): string | null {
  const parts: string[] = [];

  if (typeof snapshot.weatherTempC === "number") {
    parts.push(`${Math.round(snapshot.weatherTempC)}C`);
  }

  if (snapshot.weatherCondition) {
    parts.push(snapshot.weatherCondition);
  }

  return parts.length > 0 ? parts.join(", ") : null;
}

function normalizeSessionTypeTitle(sessionType: string | null | undefined): string | null {
  const normalized = (sessionType ?? "").trim();

  if (!normalized) {
    return null;
  }

  return normalized
    .replace(/\bSessions\b/gi, "Session")
    .replace(/\bRuns\b/gi, "Run")
    .replace(/\s+/g, " ")
    .trim();
}

function isGenericStravaTitle(title: string | null | undefined): boolean {
  const normalized = (title ?? "").trim();

  if (!normalized) {
    return true;
  }

  return /^(morning|evening|lunch|afternoon|night|midday)\s+run$/i.test(normalized)
    || /^run$/i.test(normalized);
}

export function selectEditorialSessionTitle(
  sourceTitle: string | null | undefined,
  sessionType: string | null | undefined
): string {
  const normalizedTitle = (sourceTitle ?? "").trim();
  const normalizedSessionType = normalizeSessionTypeTitle(sessionType);

  if (normalizedTitle && !isGenericStravaTitle(normalizedTitle)) {
    return normalizedTitle;
  }

  if (normalizedSessionType) {
    return normalizedSessionType;
  }

  return normalizedTitle || "Run";
}

export function buildSessionSlug(
  sessionDate: string,
  sourceTitle: string | null | undefined,
  sessionType: string | null | undefined
): string {
  const title = selectEditorialSessionTitle(sourceTitle, sessionType);
  const slug = slugifySegment(title) || "session";
  return `${sessionDate}-${slug}`;
}

function pickFirstText(values: Array<string | null | undefined>): string {
  for (const value of values) {
    const normalized = (value ?? "").trim();

    if (normalized) {
      return normalized;
    }
  }

  return "";
}

function toLapSummary(lap: PacerCmsLap): LapSummary {
  return {
    lapNumber: lap.lapIndex,
    title: `Lap ${lap.lapIndex}`,
    distanceKm: typeof lap.distanceM === "number" && lap.distanceM > 0 ? roundOneDecimal(lap.distanceM / 1000) : null,
    durationLabel: formatDuration(lap.durationS),
    paceLabel: formatPaceLabel(lap.paceSecPerKm),
    averageHeartRate: lap.hrAvg
  };
}

export function toLatestSession(snapshot: PacerCmsLatestSession): LatestSession {
  return {
    source: "pacer",
    title: selectEditorialSessionTitle(snapshot.title, snapshot.manual.sessionType),
    activityType: snapshot.sport,
    date: snapshot.sessionDate,
    startDateLocal: snapshot.startDateLocal,
    distanceKm: typeof snapshot.distanceM === "number" && snapshot.distanceM > 0
      ? roundOneDecimal(snapshot.distanceM / 1000)
      : null,
    durationSeconds: Math.round(snapshot.movingTimeS ?? 0),
    durationLabel: formatDuration(snapshot.movingTimeS),
    paceLabel: formatPaceLabel(snapshot.paceSecPerKm),
    averageHeartRate: snapshot.hrAvg,
    maxHeartRate: snapshot.hrMax,
    elevationMeters: typeof snapshot.elevationM === "number" ? Math.round(snapshot.elevationM) : null,
    weatherLabel: formatWeatherLabel(snapshot),
    statusLabel: snapshot.manual.sessionType || snapshot.ai.signalTitle || null,
    overallFeeling: null,
    personalNote: null,
    locationLabel: snapshot.city,
    laps: snapshot.laps.map((lap) => toLapSummary(lap)),
    routeSvgPoints: snapshot.routeSvgPoints
  };
}

export function toCoachFeedback(
  latestSession: PacerCmsLatestSession,
  nextRun: PacerCmsNextRun | null
): CoachFeedback {
  const firstParagraph = latestSession.ai.signalParagraphs[0] ?? "";
  const secondParagraph = latestSession.ai.signalParagraphs[1] ?? "";
  const carryForward = latestSession.ai.carryForward;
  const nextRecommendation = pickFirstText([
    nextRun?.summary,
    latestSession.ai.nextRunSummary,
    carryForward
  ]);
  const summaryShort = pickFirstText([
    firstParagraph,
    secondParagraph,
    carryForward
  ]);
  const verdict = pickFirstText([
    carryForward,
    secondParagraph,
    nextRecommendation,
    summaryShort
  ]);

  return {
    headline: pickFirstText([latestSession.ai.signalTitle, selectEditorialSessionTitle(latestSession.title, latestSession.manual.sessionType)]),
    verdict,
    summaryShort,
    mainTakeaway: pickFirstText([firstParagraph, secondParagraph, carryForward]),
    nextRecommendation
  };
}

export function buildFallbackNextRun(latestSession: PacerCmsLatestSession): PacerCmsNextRun | null {
  const title = latestSession.ai.nextRunTitle.trim();
  const summary = latestSession.ai.nextRunSummary.trim();

  if (!title && !summary) {
    return null;
  }

  return {
    fromSessionId: latestSession.sessionId,
    sessionDate: latestSession.sessionDate,
    title,
    summary,
    durationMin: latestSession.ai.nextRunDurationMin,
    durationMax: latestSession.ai.nextRunDurationMax,
    distanceKm: latestSession.ai.nextRunDistanceKm,
    paceMinSecPerKm: latestSession.ai.nextRunPaceMinSecPerKm,
    paceMaxSecPerKm: latestSession.ai.nextRunPaceMaxSecPerKm,
    updatedAt: latestSession.updatedAt
  };
}

export function toNextRun(snapshot: PacerCmsNextRun): NextRun {
  return {
    name: snapshot.title || "Next run",
    estimatedDuration: formatDurationRange(snapshot.durationMin, snapshot.durationMax),
    estimatedDistanceKm: typeof snapshot.distanceKm === "number" && snapshot.distanceKm > 0
      ? roundOneDecimal(snapshot.distanceKm)
      : null,
    paceRange: formatPaceRange(snapshot.paceMinSecPerKm, snapshot.paceMaxSecPerKm),
    goal: snapshot.summary || "Keep the next run simple and controlled.",
    workout: snapshot.workout && snapshot.workout.blocks.length > 0
      ? {
        type: snapshot.workout.type,
        blocks: snapshot.workout.blocks
      }
      : null
  };
}

export function toWeeklySnapshot(snapshot: PacerCmsWeeklySummary): WeeklySnapshot {
  const dailyDistanceKm: WeeklyTrendDay[] = snapshot.bars.map((bar) => ({
    date: bar.date,
    label: bar.label,
    distanceKm: bar.distanceKm
  }));

  return {
    source: "pacer",
    windowLabel: "Rolling 7 days",
    totalKm: snapshot.totalKm,
    runCount: snapshot.totalRuns,
    totalTimeMinutes: Math.round(snapshot.totalTimeS / 60),
    rideCount: 0,
    rideKm: 0,
    summary: snapshot.summary ?? "",
    trainingStatus: snapshot.title ?? "Rolling 7 days",
    dailyDistanceKm
  };
}

export function withForecast(nextRun: NextRun, forecast: ForecastDay[]): NextRun {
  return {
    ...nextRun,
    forecast
  };
}

export function toWeatherActivity(snapshot: PacerCmsLatestSession): PacerActivity | null {
  if (typeof snapshot.startLat !== "number" || typeof snapshot.startLon !== "number") {
    return null;
  }

  const sessionDate = snapshot.sessionDate;

  return {
    id: snapshot.sourceActivityId,
    name: selectEditorialSessionTitle(snapshot.title, snapshot.manual.sessionType),
    sport_type: snapshot.sport,
    type: snapshot.sport,
    start_date: `${sessionDate}T09:00:00Z`,
    start_date_local: snapshot.startDateLocal || `${sessionDate}T06:00:00`,
    timezone: "America/Argentina/Buenos_Aires",
    start_latlng: [snapshot.startLat, snapshot.startLon],
    distance: snapshot.distanceM ?? 0,
    moving_time: snapshot.movingTimeS ?? 0,
    total_elevation_gain: snapshot.elevationM ?? 0,
    average_heartrate: snapshot.hrAvg ?? undefined,
    max_heartrate: snapshot.hrMax ?? undefined,
    average_speed: snapshot.paceSecPerKm && snapshot.paceSecPerKm > 0 ? 1000 / snapshot.paceSecPerKm : 0
  };
}
