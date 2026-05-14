import path from "node:path";
import { buildEinkSummary } from "../src/lib/data/normalize.ts";
import {
  applyCanonicalWeekSummary,
  buildCanonicalSiteOutput,
  buildCoachFeedbackFromCanonical,
  buildNextRunFromCanonical
} from "../src/lib/data/editorial-output.ts";
import {
  buildFallbackNextRun,
  toNextRun,
  toLatestSession,
  toWeatherActivity,
  toWeeklySnapshot,
  type PacerCmsArchiveList,
  type PacerCmsLatestSession,
  type PacerCmsNextRun,
  type PacerCmsWeeklySummary
} from "../src/lib/data/pacer-cms.ts";
import { buildRaceContext } from "../src/lib/data/race-context.ts";
import { buildFixtureWeeklySummarySnapshot, buildReviewOutput } from "../src/lib/data/review-output.ts";
import { fileExists, readJsonFile, writeJsonFile } from "../src/lib/data/json.ts";
import { currentDataDir, manualDataDir, mockDataDir, resolvePacerCmsSnapshotPath, resolvePacerExportPath } from "../src/lib/data/paths.ts";
import { buildDerivedInsights } from "../src/lib/data/signal-engine.ts";
import { loadUsefulReadSources, refreshUsefulReads } from "../src/lib/data/useful-reads.ts";
import { fetchWeatherSnapshot } from "../src/lib/data/weather.ts";
import type {
  CanonicalSiteOutput,
  CoachFeedback,
  DerivedInsights,
  EinkSummary,
  LatestSession,
  NextRun,
  PacerActivity,
  PacerCmsActivityContext,
  PacerCmsActivityContextItem,
  PacerExport,
  RaceContext,
  RaceContextRecentActivity,
  RaceDefinition,
  ActivityLogExport,
  UsefulRead,
  WeatherSnapshot,
  WeeklySnapshot
} from "../src/lib/data/types.ts";

type Mode = "auto" | "pacer" | "mocks";
const SITE_TIMEZONE = "America/Argentina/Buenos_Aires";
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function currentSiteDate(): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: SITE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const parts = formatter.formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    return new Date().toISOString().slice(0, 10);
  }

  return `${year}-${month}-${day}`;
}

function parseDateString(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function shiftDateString(value: string, deltaDays: number): string {
  const date = parseDateString(value);
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

function roundOneDecimal(value: number): number {
  return Number(value.toFixed(1));
}

function formatCompactDuration(seconds: number | null | undefined): string {
  const safeSeconds = Math.max(0, Math.round(seconds ?? 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.round((safeSeconds % 3600) / 60);

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  return `${minutes} min`;
}

function formatDistanceKm(distanceMeters: number | null | undefined): string {
  return `${((distanceMeters ?? 0) / 1000).toFixed(1)} km`;
}

function formatHeartRate(value: number | null | undefined): string {
  if (!value || !Number.isFinite(value)) {
    return "—";
  }

  return `${Math.round(value)} bpm`;
}

function extractDateKey(value: string | null | undefined): string {
  return value?.slice(0, 10) ?? currentSiteDate();
}

function activitySport(activity: PacerActivity): string {
  return activity.sport_type || activity.type || "";
}

function isRideActivity(activity: PacerActivity): boolean {
  return ["Ride", "VirtualRide", "EBikeRide", "GravelRide"].includes(activitySport(activity));
}

function isRunLikeActivity(activity: PacerActivity): boolean {
  return ["Run", "TrailRun"].includes(activitySport(activity));
}

function isTrainingActivity(activity: PacerActivity): boolean {
  const sport = activitySport(activity);

  if (!sport || isRunLikeActivity(activity) || isRideActivity(activity)) {
    return false;
  }

  return !["Walk", "Hike"].includes(sport);
}

function toRecentTrainingActivity(activity: PacerActivity | undefined): RaceContextRecentActivity | null {
  if (!activity) {
    return null;
  }

  return {
    title: activity.name,
    date: extractDateKey(activity.start_date_local || activity.start_date),
    metrics: [
      { label: "Duration", value: formatCompactDuration(activity.moving_time) },
      { label: "Avg HR", value: formatHeartRate(activity.average_heartrate) },
      { label: "Max HR", value: formatHeartRate(activity.max_heartrate) }
    ]
  };
}

function toRecentRideActivity(activity: PacerActivity | undefined): RaceContextRecentActivity | null {
  if (!activity) {
    return null;
  }

  return {
    title: activity.name,
    date: extractDateKey(activity.start_date_local || activity.start_date),
    metrics: [
      { label: "Distance", value: formatDistanceKm(activity.distance) },
      { label: "Moving time", value: formatCompactDuration(activity.moving_time) },
      { label: "Avg HR", value: formatHeartRate(activity.average_heartrate) }
    ]
  };
}

async function loadSupplementalRaceActivities(): Promise<{
  latestTraining: RaceContextRecentActivity | null;
  latestRide: RaceContextRecentActivity | null;
}> {
  const activityContextSnapshot = await loadPacerCmsFile<PacerCmsActivityContext>("activity-context.json");

  if (activityContextSnapshot) {
    const mapItem = (item: PacerCmsActivityContextItem | null): RaceContextRecentActivity | null => {
      if (!item) {
        return null;
      }

      return {
        title: item.title,
        date: extractDateKey(item.startDateLocal),
        metrics: item.metrics.map((metric) => {
          switch (metric.label) {
            case "duration":
              return { label: "Duration", value: formatCompactDuration(metric.value) };
            case "avgHr":
              return { label: "Avg HR", value: formatHeartRate(metric.value) };
            case "maxHr":
              return { label: "Max HR", value: formatHeartRate(metric.value) };
            case "distance":
              return { label: "Distance", value: formatDistanceKm(metric.value) };
            case "movingTime":
              return { label: "Moving time", value: formatCompactDuration(metric.value) };
            default:
              return null;
          }
        }).filter((metric): metric is { label: string; value: string } => metric !== null)
      };
    };

    return {
      latestTraining: mapItem(activityContextSnapshot.latestTraining),
      latestRide: mapItem(activityContextSnapshot.latestRide)
    };
  }

  const exportData = await readJsonFile<PacerExport>(resolvePacerExportPath());
  const activities = exportData?.activities ?? [];
  const latestTraining = activities.find(isTrainingActivity);
  const latestRide = activities.find(isRideActivity);

  return {
    latestTraining: toRecentTrainingActivity(latestTraining),
    latestRide: toRecentRideActivity(latestRide)
  };
}

function deriveRollingTrainingStatus(totalKm: number, runCount: number): string {
  if (totalKm >= 35 || runCount >= 5) {
    return "Building well";
  }

  if (totalKm >= 20 || runCount >= 3) {
    return "Steady base";
  }

  return "Light but consistent";
}

function deriveRollingWeeklySummary(totalKm: number, runCount: number): string {
  return `${totalKm.toFixed(1)} km across ${runCount} run${runCount === 1 ? "" : "s"}. Enough work to keep the week readable while the next session comes into focus.`;
}

function rebaseWeeklySummarySnapshot(
  snapshot: PacerCmsWeeklySummary,
  publishedSessions: PacerCmsLatestSession[]
): PacerCmsWeeklySummary {
  const windowEnd = currentSiteDate();
  const windowStart = shiftDateString(windowEnd, -6);
  const startTime = parseDateString(windowStart).getTime();
  const endTime = parseDateString(windowEnd).getTime();

  const runsInWindow = publishedSessions.filter((session) => {
    const sessionTime = parseDateString(session.sessionDate).getTime();
    return sessionTime >= startTime && sessionTime <= endTime;
  });

  const bars = Array.from({ length: 7 }, (_, index) => {
    const date = shiftDateString(windowStart, index);
    const dateObject = parseDateString(date);
    const totalDistanceKm = runsInWindow
      .filter((session) => session.sessionDate === date)
      .reduce((sum, session) => sum + ((session.distanceM ?? 0) / 1000), 0);

    return {
      date,
      label: DAY_LABELS[dateObject.getUTCDay()],
      distanceKm: roundOneDecimal(totalDistanceKm)
    };
  });

  const totalKm = roundOneDecimal(runsInWindow.reduce((sum, session) => {
    return sum + ((session.distanceM ?? 0) / 1000);
  }, 0));
  const totalRuns = runsInWindow.length;
  const totalTimeS = runsInWindow.reduce((sum, session) => {
    return sum + (session.movingTimeS ?? 0);
  }, 0);

  return {
    ...snapshot,
    snapshotDate: windowEnd,
    windowStart,
    windowEnd,
    totalKm,
    totalRuns,
    totalTimeS,
    title: snapshot.snapshotDate === windowEnd
      ? snapshot.title
      : deriveRollingTrainingStatus(totalKm, totalRuns),
    summary: snapshot.snapshotDate === windowEnd
      ? snapshot.summary
      : deriveRollingWeeklySummary(totalKm, totalRuns),
    bars
  };
}

function buildAuthoritativeCanonicalOutput(input: {
  canonicalOutput: CanonicalSiteOutput;
  nextRunSnapshot: PacerCmsNextRun;
  weeklySummarySnapshot: PacerCmsWeeklySummary;
}): CanonicalSiteOutput {
  const { canonicalOutput, nextRunSnapshot, weeklySummarySnapshot } = input;

  return {
    ...canonicalOutput,
    nextRunTitle: nextRunSnapshot.title || canonicalOutput.nextRunTitle,
    nextRunSummary: nextRunSnapshot.summary || canonicalOutput.nextRunSummary,
    nextRunDurationMin: nextRunSnapshot.durationMin ?? canonicalOutput.nextRunDurationMin,
    nextRunDurationMax: nextRunSnapshot.durationMax ?? canonicalOutput.nextRunDurationMax,
    nextRunDistanceKm: nextRunSnapshot.distanceKm ?? canonicalOutput.nextRunDistanceKm,
    nextRunPaceMinSecPerKm: nextRunSnapshot.paceMinSecPerKm ?? canonicalOutput.nextRunPaceMinSecPerKm,
    nextRunPaceMaxSecPerKm: nextRunSnapshot.paceMaxSecPerKm ?? canonicalOutput.nextRunPaceMaxSecPerKm,
    weekTitle: weeklySummarySnapshot.title ?? canonicalOutput.weekTitle,
    weekSummary: weeklySummarySnapshot.summary ?? canonicalOutput.weekSummary
  };
}

function isMode(value: string | undefined): value is Mode {
  return value === "auto" || value === "pacer" || value === "mocks";
}

async function loadManualFile<T>(fileName: string): Promise<T> {
  const filePath = path.join(manualDataDir, fileName);
  const data = await readJsonFile<T>(filePath);

  if (!data) {
    throw new Error(`Missing manual data file: ${filePath}`);
  }

  return data;
}

async function loadPacerCmsFile<T>(fileName: string): Promise<T | null> {
  return readJsonFile<T>(resolvePacerCmsSnapshotPath(fileName));
}

function buildWeatherFallback(latestSession: LatestSession): WeatherSnapshot {
  return {
    latestRunLabel: latestSession.weatherLabel,
    nextRunForecast: []
  };
}

function buildPlaceholderNextRun(latestSnapshot: PacerCmsLatestSession): PacerCmsNextRun {
  return {
    fromSessionId: latestSnapshot.sessionId,
    sessionDate: latestSnapshot.sessionDate,
    title: "Next run",
    summary: latestSnapshot.ai.carryForward || "No next-run guidance saved in Pacer yet.",
    durationMin: null,
    durationMax: null,
    distanceKm: null,
    paceMinSecPerKm: null,
    paceMaxSecPerKm: null,
    workout: null,
    updatedAt: latestSnapshot.updatedAt
  };
}

function buildMockArchiveList(): PacerCmsArchiveList {
  return {
    count: 0,
    sessions: []
  };
}

function buildMockPublishedSessions(): PacerCmsLatestSession[] {
  return [];
}

function reconcileLatestSnapshot(
  latestSnapshot: PacerCmsLatestSession,
  publishedSessions: PacerCmsLatestSession[]
): PacerCmsLatestSession {
  if (latestSnapshot.startDateLocal) {
    return latestSnapshot;
  }

  const matchingPublishedSession = publishedSessions.find((session) => {
    if (session.sessionId === latestSnapshot.sessionId) {
      return true;
    }

    if (session.sourceActivityId === latestSnapshot.sourceActivityId) {
      return true;
    }

    return session.sessionDate === latestSnapshot.sessionDate
      && session.title === latestSnapshot.title
      && session.sport === latestSnapshot.sport;
  });

  if (!matchingPublishedSession?.startDateLocal) {
    return latestSnapshot;
  }

  return {
    ...latestSnapshot,
    startDateLocal: matchingPublishedSession.startDateLocal
  };
}

async function writeCurrentFiles(input: {
  latestSession: LatestSession;
  coachFeedback: CoachFeedback;
  nextRun: NextRun;
  weeklySnapshot: WeeklySnapshot;
  weatherSnapshot: WeatherSnapshot;
  usefulReads: UsefulRead[];
  archiveList: PacerCmsArchiveList;
  publishedSessions: PacerCmsLatestSession[];
  derivedInsights: DerivedInsights;
  raceContext: RaceContext;
  canonicalOutput: CanonicalSiteOutput;
  reviewOutput: unknown;
  einkSummary: EinkSummary;
  activityLog: ActivityLogExport;
}): Promise<void> {
  await Promise.all([
    writeJsonFile(path.join(currentDataDir, "latest-session.json"), input.latestSession),
    writeJsonFile(path.join(currentDataDir, "coach-feedback.json"), input.coachFeedback),
    writeJsonFile(path.join(currentDataDir, "next-run.json"), input.nextRun),
    writeJsonFile(path.join(currentDataDir, "weekly-summary.json"), input.weeklySnapshot),
    writeJsonFile(path.join(currentDataDir, "weather.json"), input.weatherSnapshot),
    writeJsonFile(path.join(currentDataDir, "useful-reads.json"), input.usefulReads),
    writeJsonFile(path.join(currentDataDir, "archive-list.json"), input.archiveList),
    writeJsonFile(path.join(currentDataDir, "published-sessions.json"), input.publishedSessions),
    writeJsonFile(path.join(currentDataDir, "derived-insights.json"), input.derivedInsights),
    writeJsonFile(path.join(currentDataDir, "race-context.json"), input.raceContext),
    writeJsonFile(path.join(currentDataDir, "site-output.json"), input.canonicalOutput),
    writeJsonFile(path.join(currentDataDir, "review-output.json"), input.reviewOutput),
    writeJsonFile(path.join(currentDataDir, "eink-summary.json"), input.einkSummary),
    writeJsonFile(path.join(currentDataDir, "activity-log.json"), input.activityLog)
  ]);
}

async function loadUsefulReadsFallback(): Promise<UsefulRead[]> {
  const [currentReads, mockReads] = await Promise.all([
    readJsonFile<UsefulRead[]>(path.join(currentDataDir, "useful-reads.json")),
    readJsonFile<UsefulRead[]>(path.join(mockDataDir, "useful-reads.json"))
  ]);
  return mergeUsefulReadsWithFallback(currentReads ?? [], mockReads ?? [], 7);
}

function mergeUsefulReadsWithFallback(primary: UsefulRead[], fallback: UsefulRead[], limit = 5): UsefulRead[] {
  const merged: UsefulRead[] = [];
  const seenUrls = new Set<string>();

  for (const item of [...primary, ...fallback]) {
    if (!item.url || seenUrls.has(item.url)) {
      continue;
    }

    merged.push(item);
    seenUrls.add(item.url);

    if (merged.length >= limit) {
      return merged;
    }
  }

  return merged;
}

async function prepareUsefulReadsFromFeeds(): Promise<UsefulRead[]> {
  const fallbackReads = await loadUsefulReadsFallback();

  try {
    const sources = await loadUsefulReadSources(path.join(manualDataDir, "useful-reads-sources.json"));
    const usefulReads = await refreshUsefulReads(sources, { limit: 7 });

    if (usefulReads.length > 0) {
      return mergeUsefulReadsWithFallback(usefulReads, fallbackReads, 7);
    }
  } catch (error) {
    console.warn(`Useful reads refresh failed, using fallback data: ${(error as Error).message}`);
  }

  return fallbackReads;
}

async function prepareFromMocks(): Promise<void> {
  const [latestSession, weeklySnapshotBase, weatherSnapshot, usefulReads, canonicalOutput, derivedInsights, raceContext] = await Promise.all([
    readJsonFile<LatestSession>(path.join(mockDataDir, "latest-session.json")),
    readJsonFile<WeeklySnapshot>(path.join(mockDataDir, "weekly-summary.json")),
    readJsonFile<WeatherSnapshot>(path.join(mockDataDir, "weather.json")),
    readJsonFile<UsefulRead[]>(path.join(mockDataDir, "useful-reads.json")),
    readJsonFile<CanonicalSiteOutput>(path.join(mockDataDir, "site-output.json")),
    readJsonFile<DerivedInsights>(path.join(mockDataDir, "derived-insights.json")),
    readJsonFile<RaceContext>(path.join(mockDataDir, "race-context.json"))
  ]);

  if (!latestSession || !weeklySnapshotBase || !weatherSnapshot || !usefulReads || !canonicalOutput || !derivedInsights || !raceContext) {
    throw new Error("Mock data files are incomplete.");
  }

  const weeklySnapshot = applyCanonicalWeekSummary({
    weeklySnapshot: weeklySnapshotBase,
    canonicalOutput
  });
  const nextRun = buildNextRunFromCanonical({
    canonicalOutput,
    forecast: weatherSnapshot.nextRunForecast
  });
  const coachFeedback = buildCoachFeedbackFromCanonical({
    canonicalOutput,
    raceContext
  });
  const raceContextWithActivities: RaceContext = {
    ...raceContext,
    latestTraining: raceContext.latestTraining ?? null,
    latestRide: raceContext.latestRide ?? null
  };
  const einkSummary = buildEinkSummary({
    latestSession,
    weeklySnapshot,
    coachFeedback,
    nextRun
  });
  const reviewOutput = {
    generatedAt: new Date().toISOString(),
    rawSummary: {
      latestSession,
      nextRunSnapshot: null,
      weeklySummarySnapshot: buildFixtureWeeklySummarySnapshot({
        sessionId: 0,
        sourceActivityId: 0,
        sessionDate: latestSession.date,
        startDateLocal: latestSession.startDateLocal,
        title: latestSession.title,
        sport: latestSession.activityType,
        distanceM: latestSession.distanceKm === null ? null : latestSession.distanceKm * 1000,
        movingTimeS: latestSession.durationSeconds,
        elapsedTimeS: latestSession.durationSeconds,
        paceSecPerKm: null,
        hrAvg: latestSession.averageHeartRate,
        hrMax: latestSession.maxHeartRate,
        elevationM: latestSession.elevationMeters,
        weatherTempC: null,
        weatherCondition: latestSession.weatherLabel,
        weatherWindKmh: null,
        city: latestSession.locationLabel,
        startLat: null,
        startLon: null,
        routeSvgPoints: latestSession.routeSvgPoints ?? null,
        manual: {
          sessionType: latestSession.statusLabel ?? "",
          legs: "",
          sleepScore: null,
          restedness: "",
          extraNotes: latestSession.personalNote ?? ""
        },
        files: {
          tcxFilename: "",
          tcxAttached: false,
          briefFilename: ""
        },
        ai: {
          signalTitle: canonicalOutput.signalTitle,
          signalParagraphs: canonicalOutput.signalParagraphs,
          carryForward: canonicalOutput.carryForward,
          nextRunTitle: canonicalOutput.nextRunTitle,
          nextRunSummary: canonicalOutput.nextRunSummary,
          nextRunDurationMin: canonicalOutput.nextRunDurationMin,
          nextRunDurationMax: canonicalOutput.nextRunDurationMax,
          nextRunDistanceKm: canonicalOutput.nextRunDistanceKm > 0 ? canonicalOutput.nextRunDistanceKm : null,
          nextRunPaceMinSecPerKm: canonicalOutput.nextRunPaceMinSecPerKm,
          nextRunPaceMaxSecPerKm: canonicalOutput.nextRunPaceMaxSecPerKm,
          weekTitle: canonicalOutput.weekTitle,
          weekSummary: canonicalOutput.weekSummary
        },
        laps: [],
        updatedAt: new Date().toISOString()
      })
    },
    derivedInsight: derivedInsights.latest,
    raceContext: raceContextWithActivities,
    canonicalSiteOutput: canonicalOutput,
    confidenceMetadata: derivedInsights.latest
      ? {
        signalConfidence: derivedInsights.latest.signalConfidence,
        dataSourcesUsed: derivedInsights.latest.dataSourcesUsed,
        missingSignals: derivedInsights.latest.missingSignals
      }
      : null
  };

  await writeCurrentFiles({
    latestSession,
    coachFeedback,
    nextRun,
    weeklySnapshot,
    weatherSnapshot,
    usefulReads,
    archiveList: buildMockArchiveList(),
    publishedSessions: buildMockPublishedSessions(),
    derivedInsights,
    raceContext: raceContextWithActivities,
    canonicalOutput,
    reviewOutput,
    einkSummary,
    activityLog: { generatedAt: new Date().toISOString(), count: 0, activities: [] }
  });
  console.log("Prepared data/current from mocks.");
}

async function loadWeatherSnapshot(latestSnapshot: PacerCmsLatestSession, latestSession: LatestSession): Promise<WeatherSnapshot> {
  const weatherActivity = toWeatherActivity(latestSnapshot);

  if (weatherActivity) {
    try {
      return await fetchWeatherSnapshot(weatherActivity, { forecastDays: 3 });
    } catch (error) {
      console.warn(`Weather fetch failed, using fallback data: ${(error as Error).message}`);
    }
  }

  return (await readJsonFile<WeatherSnapshot>(path.join(currentDataDir, "weather.json")))
    ?? (await readJsonFile<WeatherSnapshot>(path.join(mockDataDir, "weather.json")))
    ?? buildWeatherFallback(latestSession);
}

async function prepareFromPacer(): Promise<void> {
  const [latestSnapshot, nextRunSnapshotRaw, weeklySummarySnapshot, archiveList, publishedSessionsSnapshot, activityLogSnapshot] = await Promise.all([
    loadPacerCmsFile<PacerCmsLatestSession>("latest-session.json"),
    loadPacerCmsFile<PacerCmsNextRun>("next-run.json"),
    loadPacerCmsFile<PacerCmsWeeklySummary>("weekly-summary.json"),
    loadPacerCmsFile<PacerCmsArchiveList>("archive-list.json"),
    loadPacerCmsFile<PacerCmsLatestSession[]>("published-sessions.json"),
    loadPacerCmsFile<ActivityLogExport>("activity-log.json")
  ]);

  if (!latestSnapshot) {
    throw new Error(`Pacer CMS snapshot not found at ${resolvePacerCmsSnapshotPath("latest-session.json")}`);
  }

  if (!weeklySummarySnapshot) {
    throw new Error(`Pacer CMS snapshot not found at ${resolvePacerCmsSnapshotPath("weekly-summary.json")}`);
  }

  if (!archiveList) {
    throw new Error(`Pacer CMS snapshot not found at ${resolvePacerCmsSnapshotPath("archive-list.json")}`);
  }

  if (!publishedSessionsSnapshot) {
    throw new Error(`Pacer CMS snapshot not found at ${resolvePacerCmsSnapshotPath("published-sessions.json")}`);
  }

  const latestSnapshotResolved = reconcileLatestSnapshot(latestSnapshot, publishedSessionsSnapshot);
  const weeklySummarySnapshotRebased = rebaseWeeklySummarySnapshot(
    weeklySummarySnapshot,
    publishedSessionsSnapshot
  );
  const nextRunSnapshot = nextRunSnapshotRaw
    ?? buildFallbackNextRun(latestSnapshotResolved)
    ?? buildPlaceholderNextRun(latestSnapshotResolved);
  const latestSession = toLatestSession(latestSnapshotResolved);
  const races = await loadManualFile<RaceDefinition[]>("races.json")
    .catch(() => []);
  const derivedInsights = await buildDerivedInsights(publishedSessionsSnapshot);
  const raceContextBase = buildRaceContext({
    latestSessionDate: latestSnapshotResolved.sessionDate,
    derivedInsight: derivedInsights.latest,
    races
  });
  const supplementalActivities = await loadSupplementalRaceActivities();
  const raceContext: RaceContext = {
    ...raceContextBase,
    latestTraining: supplementalActivities.latestTraining,
    latestRide: supplementalActivities.latestRide
  };
  const canonicalOutput = buildCanonicalSiteOutput({
    latestSnapshot: latestSnapshotResolved,
    nextRunSnapshot,
    weeklySummarySnapshot: weeklySummarySnapshotRebased,
    derivedInsight: derivedInsights.latest,
    raceContext
  });
  const authoritativeCanonicalOutput = buildAuthoritativeCanonicalOutput({
    canonicalOutput,
    nextRunSnapshot,
    weeklySummarySnapshot: weeklySummarySnapshotRebased
  });
  const weatherSnapshot = await loadWeatherSnapshot(latestSnapshotResolved, latestSession);
  const nextRun = {
    ...toNextRun(nextRunSnapshot),
    forecast: weatherSnapshot.nextRunForecast
  };
  const weeklySnapshot = toWeeklySnapshot(weeklySummarySnapshotRebased);
  const coachFeedback = buildCoachFeedbackFromCanonical({
    canonicalOutput: authoritativeCanonicalOutput,
    raceContext
  });
  const usefulReads = await prepareUsefulReadsFromFeeds();
  const einkSummary = buildEinkSummary({
    latestSession: {
      ...latestSession,
      weatherLabel: weatherSnapshot.latestRunLabel ?? latestSession.weatherLabel
    },
    weeklySnapshot,
    coachFeedback,
    nextRun
  });
  const reviewOutput = buildReviewOutput({
    latestSnapshot: latestSnapshotResolved,
    nextRunSnapshot,
    weeklySummarySnapshot: weeklySummarySnapshotRebased,
    derivedInsight: derivedInsights.latest,
    raceContext,
    canonicalOutput: authoritativeCanonicalOutput
  });

  await writeCurrentFiles({
    latestSession,
    coachFeedback,
    nextRun,
    weeklySnapshot,
    weatherSnapshot,
    usefulReads,
    archiveList,
    publishedSessions: publishedSessionsSnapshot,
    derivedInsights,
    raceContext,
    canonicalOutput: authoritativeCanonicalOutput,
    reviewOutput,
    einkSummary,
    activityLog: activityLogSnapshot ?? { generatedAt: new Date().toISOString(), count: 0, activities: [] }
  });
  console.log(`Prepared data/current from Pacer CMS snapshots at ${resolvePacerCmsSnapshotPath("latest-session.json")}.`);
}

async function prepareAuto(): Promise<void> {
  const pacerSnapshotPath = resolvePacerCmsSnapshotPath("latest-session.json");

  if (await fileExists(pacerSnapshotPath)) {
    try {
      await prepareFromPacer();
      return;
    } catch (error) {
      console.warn(`Pacer import failed, falling back to mocks: ${(error as Error).message}`);
    }
  }

  await prepareFromMocks();
}

async function main(): Promise<void> {
  const modeArgument = process.argv[2];
  const envMode = process.env.RUN_DATA_SOURCE;
  const mode: Mode = isMode(modeArgument)
    ? modeArgument
    : isMode(envMode)
      ? envMode
      : "auto";

  if (mode === "pacer") {
    await prepareFromPacer();
    return;
  }

  if (mode === "mocks") {
    await prepareFromMocks();
    return;
  }

  await prepareAuto();
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
