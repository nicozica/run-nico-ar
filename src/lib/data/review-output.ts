import type { PacerCmsLatestSession, PacerCmsNextRun, PacerCmsWeeklySummary } from "./pacer-cms.ts";
import type {
  CanonicalSiteOutput,
  DerivedSessionInsight,
  RaceContext,
  SignalConfidenceMetadata
} from "./types.ts";

export interface ReviewOutput {
  generatedAt: string;
  rawSummary: {
    latestSession: PacerCmsLatestSession;
    nextRunSnapshot: PacerCmsNextRun | null;
    weeklySummarySnapshot: PacerCmsWeeklySummary;
  };
  derivedInsight: DerivedSessionInsight | null;
  raceContext: RaceContext;
  canonicalSiteOutput: CanonicalSiteOutput;
  confidenceMetadata: SignalConfidenceMetadata | null;
}

function toConfidenceMetadata(derivedInsight: DerivedSessionInsight | null): SignalConfidenceMetadata | null {
  if (!derivedInsight) {
    return null;
  }

  return {
    signalConfidence: derivedInsight.signalConfidence,
    dataSourcesUsed: derivedInsight.dataSourcesUsed,
    missingSignals: derivedInsight.missingSignals
  };
}

export function buildReviewOutput(input: {
  latestSnapshot: PacerCmsLatestSession;
  nextRunSnapshot: PacerCmsNextRun | null;
  weeklySummarySnapshot: PacerCmsWeeklySummary;
  derivedInsight: DerivedSessionInsight | null;
  raceContext: RaceContext;
  canonicalOutput: CanonicalSiteOutput;
}): ReviewOutput {
  return {
    generatedAt: new Date().toISOString(),
    rawSummary: {
      latestSession: input.latestSnapshot,
      nextRunSnapshot: input.nextRunSnapshot,
      weeklySummarySnapshot: input.weeklySummarySnapshot
    },
    derivedInsight: input.derivedInsight,
    raceContext: input.raceContext,
    canonicalSiteOutput: input.canonicalOutput,
    confidenceMetadata: toConfidenceMetadata(input.derivedInsight)
  };
}

export function buildFixtureNextRunSnapshot(session: PacerCmsLatestSession): PacerCmsNextRun | null {
  if (!session.ai.nextRunTitle && !session.ai.nextRunSummary) {
    return null;
  }

  return {
    fromSessionId: session.sessionId,
    sessionDate: session.sessionDate,
    title: session.ai.nextRunTitle,
    summary: session.ai.nextRunSummary,
    durationMin: session.ai.nextRunDurationMin,
    durationMax: session.ai.nextRunDurationMax,
    distanceKm: session.ai.nextRunDistanceKm,
    paceMinSecPerKm: session.ai.nextRunPaceMinSecPerKm,
    paceMaxSecPerKm: session.ai.nextRunPaceMaxSecPerKm,
    updatedAt: session.updatedAt
  };
}

export function buildFixtureWeeklySummarySnapshot(session: PacerCmsLatestSession): PacerCmsWeeklySummary {
  return {
    id: session.sessionId,
    snapshotDate: session.sessionDate,
    windowStart: session.sessionDate,
    windowEnd: session.sessionDate,
    totalKm: typeof session.distanceM === "number" ? Number((session.distanceM / 1000).toFixed(1)) : 0,
    totalRuns: session.sport === "Run" ? 1 : 0,
    totalTimeS: session.movingTimeS ?? 0,
    title: session.ai.weekTitle || null,
    summary: session.ai.weekSummary || null,
    bars: []
  };
}
