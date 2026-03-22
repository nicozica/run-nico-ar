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
import { currentDataDir, manualDataDir, mockDataDir, resolvePacerCmsSnapshotPath } from "../src/lib/data/paths.ts";
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
  RaceContext,
  RaceDefinition,
  UsefulRead,
  WeatherSnapshot,
  WeeklySnapshot
} from "../src/lib/data/types.ts";

type Mode = "auto" | "pacer" | "mocks";

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
    paceMinSecPerKm: null,
    paceMaxSecPerKm: null,
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
    writeJsonFile(path.join(currentDataDir, "eink-summary.json"), input.einkSummary)
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
    raceContext,
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
    raceContext,
    canonicalOutput,
    reviewOutput,
    einkSummary
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
  const [latestSnapshot, nextRunSnapshotRaw, weeklySummarySnapshot, archiveList, publishedSessionsSnapshot] = await Promise.all([
    loadPacerCmsFile<PacerCmsLatestSession>("latest-session.json"),
    loadPacerCmsFile<PacerCmsNextRun>("next-run.json"),
    loadPacerCmsFile<PacerCmsWeeklySummary>("weekly-summary.json"),
    loadPacerCmsFile<PacerCmsArchiveList>("archive-list.json"),
    loadPacerCmsFile<PacerCmsLatestSession[]>("published-sessions.json")
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

  const nextRunSnapshot = nextRunSnapshotRaw
    ?? buildFallbackNextRun(latestSnapshot)
    ?? buildPlaceholderNextRun(latestSnapshot);
  const latestSession = toLatestSession(latestSnapshot);
  const races = await loadManualFile<RaceDefinition[]>("races.json")
    .catch(() => []);
  const derivedInsights = await buildDerivedInsights(publishedSessionsSnapshot);
  const raceContext = buildRaceContext({
    latestSessionDate: latestSnapshot.sessionDate,
    derivedInsight: derivedInsights.latest,
    races
  });
  const canonicalOutput = buildCanonicalSiteOutput({
    latestSnapshot,
    nextRunSnapshot,
    weeklySummarySnapshot,
    derivedInsight: derivedInsights.latest,
    raceContext
  });
  const weatherSnapshot = await loadWeatherSnapshot(latestSnapshot, latestSession);
  const nextRun = buildNextRunFromCanonical({
    canonicalOutput,
    forecast: weatherSnapshot.nextRunForecast
  });
  const weeklySnapshot = applyCanonicalWeekSummary({
    weeklySnapshot: toWeeklySnapshot(weeklySummarySnapshot),
    canonicalOutput
  });
  const coachFeedback = buildCoachFeedbackFromCanonical({
    canonicalOutput,
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
    latestSnapshot,
    nextRunSnapshot,
    weeklySummarySnapshot,
    derivedInsight: derivedInsights.latest,
    raceContext,
    canonicalOutput
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
    canonicalOutput,
    reviewOutput,
    einkSummary
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
