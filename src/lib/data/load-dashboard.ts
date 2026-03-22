import path from "node:path";
import { buildEinkSummary } from "./normalize.ts";
import { readJsonFile } from "./json.ts";
import { currentDataDir, manualDataDir, mockDataDir } from "./paths.ts";
import type {
  CanonicalSiteOutput,
  CoachFeedback,
  DerivedInsights,
  EinkSummary,
  LatestSession,
  MotivationNote,
  NextRun,
  RaceContext,
  RunDashboardData,
  SiteCopy,
  UsefulRead,
  WeatherSnapshot,
  WeeklySnapshot
} from "./types.ts";

async function loadRequiredManualFile<T>(fileName: string): Promise<T> {
  const filePath = path.join(manualDataDir, fileName);
  const data = await readJsonFile<T>(filePath);

  if (!data) {
    throw new Error(`Missing required manual data file: ${filePath}`);
  }

  return data;
}

async function loadGeneratedOrMock<T>(fileName: string): Promise<T> {
  const generatedPath = path.join(currentDataDir, fileName);
  const generated = await readJsonFile<T>(generatedPath);

  if (generated) {
    return generated;
  }

  const mockPath = path.join(mockDataDir, fileName);
  const mock = await readJsonFile<T>(mockPath);

  if (!mock) {
    throw new Error(`Missing generated and mock data file: ${fileName}`);
  }

  return mock;
}

export async function loadDashboardData(): Promise<RunDashboardData> {
  const [
    site,
    coachFeedback,
    nextRun,
    motivation,
    latestSession,
    weeklySnapshot,
    weatherSnapshot,
    usefulReads,
    einkSummaryBase,
    derivedInsights,
    raceContext,
    canonicalOutput
  ] = await Promise.all([
    loadRequiredManualFile<SiteCopy>("site-copy.json"),
    loadGeneratedOrMock<CoachFeedback>("coach-feedback.json")
      .catch(() => loadRequiredManualFile<CoachFeedback>("coach-feedback.json")),
    loadGeneratedOrMock<NextRun>("next-run.json")
      .catch(() => loadRequiredManualFile<NextRun>("next-run.json")),
    loadRequiredManualFile<MotivationNote>("motivation.json"),
    loadGeneratedOrMock<LatestSession>("latest-session.json"),
    loadGeneratedOrMock<WeeklySnapshot>("weekly-summary.json"),
    loadGeneratedOrMock<WeatherSnapshot>("weather.json"),
    loadGeneratedOrMock<UsefulRead[]>("useful-reads.json"),
    loadGeneratedOrMock<EinkSummary>("eink-summary.json"),
    loadGeneratedOrMock<DerivedInsights>("derived-insights.json"),
    loadGeneratedOrMock<RaceContext>("race-context.json"),
    loadGeneratedOrMock<CanonicalSiteOutput>("site-output.json")
  ]);

  const nextRunWithForecast: NextRun = {
    ...nextRun,
    forecast: weatherSnapshot?.nextRunForecast ?? []
  };
  const latestSessionWithWeather: LatestSession = {
    ...latestSession,
    weatherLabel: weatherSnapshot?.latestRunLabel ?? latestSession.weatherLabel
  };
  const einkSummary = einkSummaryBase ?? buildEinkSummary({
    latestSession: latestSessionWithWeather,
    weeklySnapshot,
    coachFeedback,
    nextRun: nextRunWithForecast
  });

  return {
    site,
    latestSession: latestSessionWithWeather,
    weeklySnapshot,
    coachFeedback,
    nextRun: nextRunWithForecast,
    motivation,
    usefulReads,
    einkSummary,
    derivedInsights,
    raceContext,
    canonicalOutput
  };
}
