import path from "node:path";
import {
  buildCanonicalSiteOutput
} from "../src/lib/data/editorial-output.ts";
import { readJsonFile, writeJsonFile } from "../src/lib/data/json.ts";
import { currentDataDir, dataDir, manualDataDir, resolvePacerCmsSnapshotPath } from "../src/lib/data/paths.ts";
import { buildRaceContext } from "../src/lib/data/race-context.ts";
import { buildFixtureNextRunSnapshot, buildFixtureWeeklySummarySnapshot, buildReviewOutput } from "../src/lib/data/review-output.ts";
import { buildDerivedInsights } from "../src/lib/data/signal-engine.ts";
import type {
  PacerCmsLatestSession
} from "../src/lib/data/pacer-cms.ts";
import type {
  RaceDefinition,
  SignalConfidenceLevel
} from "../src/lib/data/types.ts";

interface FixtureCaseDefinition {
  slug: string;
  title: string;
  sessionId: number;
  snapshotFile?: string;
  expectedIntent: string;
  expectedMinConfidence: SignalConfidenceLevel;
  reviewFocus: string;
}

interface FixtureCheckResult {
  label: string;
  passed: boolean;
  expected: string;
  actual: string;
}

const CONFIDENCE_ORDER: Record<SignalConfidenceLevel, number> = {
  low: 0,
  medium: 1,
  high: 2
};

async function loadFixtureCases(): Promise<FixtureCaseDefinition[]> {
  const casesPath = path.join(dataDir, "fixtures", "cases.json");
  const cases = await readJsonFile<FixtureCaseDefinition[]>(casesPath);

  if (!cases || cases.length === 0) {
    throw new Error(`Fixture cases not found at ${casesPath}`);
  }

  return cases;
}

async function loadPublishedSessions(): Promise<PacerCmsLatestSession[]> {
  const sessions = await readJsonFile<PacerCmsLatestSession[]>(resolvePacerCmsSnapshotPath("published-sessions.json"));

  if (!sessions) {
    throw new Error("Published sessions snapshot is missing.");
  }

  return sessions;
}

async function loadFixtureSnapshot(fileName: string): Promise<PacerCmsLatestSession> {
  const filePath = path.join(dataDir, "fixtures", "snapshots", fileName);
  const snapshot = await readJsonFile<PacerCmsLatestSession>(filePath);

  if (!snapshot) {
    throw new Error(`Fixture snapshot not found at ${filePath}`);
  }

  return snapshot;
}

function compareConfidence(actual: SignalConfidenceLevel, expected: SignalConfidenceLevel): boolean {
  return CONFIDENCE_ORDER[actual] >= CONFIDENCE_ORDER[expected];
}

async function resolveCaseSnapshot(
  fixtureCase: FixtureCaseDefinition,
  publishedSessions: PacerCmsLatestSession[]
): Promise<PacerCmsLatestSession> {
  const publishedMatch = publishedSessions.find((session) => session.sessionId === fixtureCase.sessionId);

  if (publishedMatch) {
    return publishedMatch;
  }

  if (!fixtureCase.snapshotFile) {
    throw new Error(`Fixture ${fixtureCase.slug} does not resolve to a published session and has no snapshotFile.`);
  }

  return loadFixtureSnapshot(fixtureCase.snapshotFile);
}

async function main(): Promise<void> {
  const [fixtureCases, publishedSessions, races] = await Promise.all([
    loadFixtureCases(),
    loadPublishedSessions(),
    readJsonFile<RaceDefinition[]>(path.join(manualDataDir, "races.json"))
  ]);

  const raceDefinitions = races ?? [];
  const cases = await Promise.all(fixtureCases.map(async (fixtureCase) => {
    const snapshot = await resolveCaseSnapshot(fixtureCase, publishedSessions);
    const derivedInsights = await buildDerivedInsights([snapshot]);
    const derivedInsight = derivedInsights.latest;
    const nextRunSnapshot = buildFixtureNextRunSnapshot(snapshot);
    const weeklySummarySnapshot = buildFixtureWeeklySummarySnapshot(snapshot);
    const raceContext = buildRaceContext({
      latestSessionDate: snapshot.sessionDate,
      derivedInsight,
      races: raceDefinitions
    });
    const canonicalOutput = buildCanonicalSiteOutput({
      latestSnapshot: snapshot,
      nextRunSnapshot,
      weeklySummarySnapshot,
      derivedInsight,
      raceContext
    });
    const reviewOutput = buildReviewOutput({
      latestSnapshot: snapshot,
      nextRunSnapshot,
      weeklySummarySnapshot,
      derivedInsight,
      raceContext,
      canonicalOutput
    });

    const actualIntent = derivedInsight?.sessionIntentDetected ?? "Missing insight";
    const actualConfidence = derivedInsight?.signalConfidence ?? "low";
    const checks: FixtureCheckResult[] = [
      {
        label: "Intent",
        passed: actualIntent === fixtureCase.expectedIntent,
        expected: fixtureCase.expectedIntent,
        actual: actualIntent
      },
      {
        label: "Confidence floor",
        passed: compareConfidence(actualConfidence, fixtureCase.expectedMinConfidence),
        expected: fixtureCase.expectedMinConfidence,
        actual: actualConfidence
      }
    ];

    return {
      slug: fixtureCase.slug,
      title: fixtureCase.title,
      sessionId: fixtureCase.sessionId,
      sessionDate: snapshot.sessionDate,
      reviewFocus: fixtureCase.reviewFocus,
      passed: checks.every((check) => check.passed),
      checks,
      confidenceMetadata: reviewOutput.confidenceMetadata,
      reviewOutput
    };
  }));

  const payload = {
    generatedAt: new Date().toISOString(),
    caseCount: cases.length,
    cases
  };

  await writeJsonFile(path.join(currentDataDir, "fixture-review.json"), payload);

  const passedCount = cases.filter((entry) => entry.passed).length;
  console.log(`Fixture review written to ${path.join(currentDataDir, "fixture-review.json")}`);
  console.log(`Passed ${passedCount}/${cases.length} fixture cases.`);
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
