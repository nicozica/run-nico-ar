import path from "node:path";
import { buildEinkSummary, mergeLatestSessionWithNotes, mergeWeeklySnapshotWithNotes, normalizePacerExport } from "../src/lib/data/normalize.ts";
import { fileExists, readJsonFile, writeJsonFile } from "../src/lib/data/json.ts";
import { currentDataDir, manualDataDir, mockDataDir, resolvePacerExportPath } from "../src/lib/data/paths.ts";
import { readPacerExport } from "../src/lib/data/pacer.ts";
import { loadUsefulReadSources, refreshUsefulReads } from "../src/lib/data/useful-reads.ts";
import { fetchWeatherSnapshot } from "../src/lib/data/weather.ts";
import { isRunLike, sortActivitiesDesc } from "../src/lib/data/pacer.ts";
import type {
  CoachFeedback,
  EinkSummary,
  LatestSession,
  NextRun,
  SessionNotes,
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

async function writeCurrentFiles(input: {
  latestSession: LatestSession;
  weeklySnapshot: WeeklySnapshot;
  weatherSnapshot: WeatherSnapshot;
  usefulReads: UsefulRead[];
  einkSummary: EinkSummary;
}): Promise<void> {
  await Promise.all([
    writeJsonFile(path.join(currentDataDir, "latest-session.json"), input.latestSession),
    writeJsonFile(path.join(currentDataDir, "weekly-summary.json"), input.weeklySnapshot),
    writeJsonFile(path.join(currentDataDir, "weather.json"), input.weatherSnapshot),
    writeJsonFile(path.join(currentDataDir, "useful-reads.json"), input.usefulReads),
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
  const [latestSession, weeklySnapshot, weatherSnapshot, usefulReads, einkSummary] = await Promise.all([
    readJsonFile<LatestSession>(path.join(mockDataDir, "latest-session.json")),
    readJsonFile<WeeklySnapshot>(path.join(mockDataDir, "weekly-summary.json")),
    readJsonFile<WeatherSnapshot>(path.join(mockDataDir, "weather.json")),
    readJsonFile<UsefulRead[]>(path.join(mockDataDir, "useful-reads.json")),
    readJsonFile<EinkSummary>(path.join(mockDataDir, "eink-summary.json"))
  ]);

  if (!latestSession || !weeklySnapshot || !weatherSnapshot || !usefulReads || !einkSummary) {
    throw new Error("Mock data files are incomplete.");
  }

  await writeCurrentFiles({ latestSession, weeklySnapshot, weatherSnapshot, usefulReads, einkSummary });
  console.log("Prepared data/current from mocks.");
}

async function prepareFromPacer(): Promise<void> {
  const pacerExport = await readPacerExport();

  if (!pacerExport) {
    throw new Error(`Pacer export not found at ${resolvePacerExportPath()}`);
  }

  const [sessionNotes, coachFeedback, nextRun] = await Promise.all([
    loadManualFile<SessionNotes>("session-notes.json"),
    loadManualFile<CoachFeedback>("coach-feedback.json"),
    loadManualFile<NextRun>("next-run.json")
  ]);
  const activities = sortActivitiesDesc(pacerExport.activities ?? []);
  const latestRelevantActivity = activities.find(isRunLike) ?? activities[0];

  if (!latestRelevantActivity) {
    throw new Error("Pacer export does not contain activities for weather lookup.");
  }

  const normalized = normalizePacerExport(pacerExport, { sessionNotes });
  const latestSession = mergeLatestSessionWithNotes(normalized.latestSession, sessionNotes);
  const weeklySnapshot = mergeWeeklySnapshotWithNotes(normalized.weeklySnapshot, sessionNotes);
  let weatherSnapshot: WeatherSnapshot;

  try {
    weatherSnapshot = await fetchWeatherSnapshot(latestRelevantActivity, { forecastDays: 3 });
  } catch (error) {
    console.warn(`Weather fetch failed, using fallback data: ${(error as Error).message}`);
    weatherSnapshot = (await readJsonFile<WeatherSnapshot>(path.join(currentDataDir, "weather.json")))
      ?? (await readJsonFile<WeatherSnapshot>(path.join(mockDataDir, "weather.json")))
      ?? { latestRunLabel: latestSession.weatherLabel, nextRunForecast: [] };
  }

  const usefulReads = await prepareUsefulReadsFromFeeds();
  const einkSummary = buildEinkSummary({
    latestSession: {
      ...latestSession,
      weatherLabel: weatherSnapshot.latestRunLabel ?? latestSession.weatherLabel
    },
    weeklySnapshot,
    coachFeedback,
    nextRun: {
      ...nextRun,
      forecast: weatherSnapshot.nextRunForecast
    }
  });

  await writeCurrentFiles({ latestSession, weeklySnapshot, weatherSnapshot, usefulReads, einkSummary });
  console.log(`Prepared data/current from Pacer export at ${resolvePacerExportPath()}.`);
}

async function prepareAuto(): Promise<void> {
  const pacerExportPath = resolvePacerExportPath();

  if (await fileExists(pacerExportPath)) {
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
