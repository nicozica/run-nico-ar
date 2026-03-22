import type { PacerCmsLatestSession, PacerCmsNextRun, PacerCmsWeeklySummary } from "./pacer-cms.ts";
import type {
  CanonicalSiteOutput,
  CoachFeedback,
  DerivedSessionInsight,
  ForecastDay,
  NextRun,
  RaceContext,
  WeeklySnapshot
} from "./types.ts";

function compactText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxLength: number, preferSentence = false): string {
  const compact = compactText(value);

  if (compact.length <= maxLength) {
    return compact;
  }

  const sentence = compact.split(/[.!?]/).map((part) => part.trim()).filter(Boolean)[0];

  if (preferSentence && sentence && sentence.length <= maxLength) {
    return sentence;
  }

  return `${compact.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function formatDurationRange(minValue: number, maxValue: number): string {
  if (minValue <= 0 && maxValue <= 0) {
    return "—";
  }

  if (minValue > 0 && maxValue > 0) {
    return minValue === maxValue ? `${minValue} min` : `${minValue}-${maxValue} min`;
  }

  return `${Math.max(minValue, maxValue)} min`;
}

function formatPaceLabel(value: number): string | null {
  if (value <= 0) {
    return null;
  }

  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatPaceRange(minValue: number, maxValue: number): string {
  const minLabel = formatPaceLabel(minValue);
  const maxLabel = formatPaceLabel(maxValue);

  if (!minLabel && !maxLabel) {
    return "—";
  }

  if (minLabel && maxLabel) {
    return minLabel === maxLabel ? `${minLabel} /km` : `${minLabel}-${maxLabel} /km`;
  }

  return `${minLabel ?? maxLabel} /km`;
}

function normalizeParagraphs(paragraphs: string[]): string[] {
  return paragraphs
    .map((paragraph) => compactText(paragraph))
    .filter(Boolean)
    .slice(0, 3);
}

function toNumericValue(...values: Array<number | null | undefined>): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return Math.round(value);
    }
  }

  return 0;
}

function buildFallbackSignalTitle(
  latestSnapshot: PacerCmsLatestSession,
  derivedInsight: DerivedSessionInsight | null
): string {
  if (!derivedInsight) {
    return latestSnapshot.title;
  }

  if (derivedInsight.sessionIntentDetected === "Tempo session") {
    return derivedInsight.executionQuality.includes("repeatable")
      ? "Controlled tempo day"
      : "Useful tempo signal";
  }

  if (derivedInsight.sessionIntentDetected === "Long run") {
    return derivedInsight.finishPattern === "Sharp finish"
      ? "Long run with a firmer finish"
      : "Steady long-run signal";
  }

  if (derivedInsight.sessionIntentDetected === "Easy run") {
    return derivedInsight.executionQuality.includes("drifted")
      ? "Easy day, a touch above easy"
      : "Easy day that stayed honest";
  }

  return "Useful aerobic signal";
}

function buildFallbackSignalParagraphs(input: {
  latestSnapshot: PacerCmsLatestSession;
  derivedInsight: DerivedSessionInsight | null;
  raceContext: RaceContext;
}): string[] {
  const { derivedInsight, raceContext } = input;

  if (!derivedInsight) {
    return [
      "The published session is ready to read. The main value now is keeping the week moving without forcing more than the day asked for."
    ];
  }

  const paragraphs: string[] = [];

  if (derivedInsight.sessionIntentDetected === "Tempo session") {
    paragraphs.push(
      derivedInsight.gpsConfidence.label === "Watch the pace trace"
        ? "The workout still reads as a useful quality day. The pace trace got messy in places, so the best read comes from the overall shape of the work rather than exact split precision."
        : "This session reads as a useful quality day. The work stayed clear enough to count, and it did not spill into a ragged all-out effort."
    );
  } else if (derivedInsight.sessionIntentDetected === "Long run") {
    paragraphs.push(
      derivedInsight.finishPattern === "Sharp finish"
        ? "The volume did its job, but the finish added a little more sting than a classic long run really needs."
        : "The session did the endurance job well enough, with the main value coming from time on feet and steady aerobic work."
    );
  } else if (derivedInsight.sessionIntentDetected === "Easy run") {
    paragraphs.push(
      derivedInsight.executionQuality.includes("drifted")
        ? "The run still helped the week, but it sat a little above the calm effort an easy day is supposed to protect."
        : "This looked like the right kind of easy day: useful, honest, and not more expensive than it needed to be."
    );
  } else {
    paragraphs.push("The session moved the week forward in a readable way without needing extra interpretation tricks.");
  }

  if (raceContext.nextRace) {
    const raceLead = `${raceContext.nextRace.daysToRace} days out from ${raceContext.nextRace.title}`;
    paragraphs.push(
      `${raceLead}, the main question is not whether the session looked impressive. It is whether it supports the next specific step, and this one does if the follow-up stays disciplined.`
    );
  } else {
    paragraphs.push(
      "The bigger win now is staying consistent enough for the next session to make sense inside the week, rather than squeezing extra meaning out of one workout."
    );
  }

  return paragraphs.slice(0, 3);
}

function buildFallbackWeekTitle(
  derivedInsight: DerivedSessionInsight | null,
  raceContext: RaceContext
): string {
  if (raceContext.nextRace && raceContext.daysToRace !== null && raceContext.daysToRace <= 35) {
    return "Specific work, calm support";
  }

  if (derivedInsight?.sessionIntentDetected === "Tempo session") {
    return "Quality is only useful if it stays absorbable";
  }

  if (derivedInsight?.sessionIntentDetected === "Long run") {
    return "Endurance first";
  }

  return "Keep the week readable";
}

function buildFallbackWeekSummary(
  derivedInsight: DerivedSessionInsight | null,
  raceContext: RaceContext
): string {
  if (raceContext.nextRace) {
    return `The week should now lean toward ${raceContext.currentPhase.toLowerCase()} for ${raceContext.nextRace.title}: enough quality to stay specific, but with recovery protected so the next big session still lands well.`;
  }

  if (derivedInsight?.sessionIntentDetected === "Tempo session") {
    return "The useful version of this week is the one where the quality lands once, then the easy volume stays easy enough to keep the rhythm intact.";
  }

  return "The week looks better when the next step stays calm enough to let the recent work sink in.";
}

export function buildCanonicalSiteOutput(input: {
  latestSnapshot: PacerCmsLatestSession;
  nextRunSnapshot: PacerCmsNextRun | null;
  weeklySummarySnapshot: PacerCmsWeeklySummary;
  derivedInsight: DerivedSessionInsight | null;
  raceContext: RaceContext;
}): CanonicalSiteOutput {
  const { latestSnapshot, nextRunSnapshot, weeklySummarySnapshot, derivedInsight, raceContext } = input;
  const ai = latestSnapshot.ai;
  const signalParagraphs = normalizeParagraphs(ai.signalParagraphs);
  const nextRunTitle = compactText(nextRunSnapshot?.title ?? ai.nextRunTitle)
    || derivedInsight?.nextRunSuggestion.title
    || "Next run";
  const nextRunSummary = compactText(nextRunSnapshot?.summary ?? ai.nextRunSummary)
    || derivedInsight?.nextRunSuggestion.summary
    || "Keep the next run quiet enough to support the week.";

  return {
    signalTitle: compactText(ai.signalTitle)
      || buildFallbackSignalTitle(latestSnapshot, derivedInsight),
    signalParagraphs: signalParagraphs.length > 0
      ? signalParagraphs
      : buildFallbackSignalParagraphs({
        latestSnapshot,
        derivedInsight,
        raceContext
      }),
    carryForward: compactText(ai.carryForward)
      || derivedInsight?.carryForward
      || nextRunSummary,
    nextRunTitle,
    nextRunSummary,
    nextRunDurationMin: toNumericValue(
      nextRunSnapshot?.durationMin,
      ai.nextRunDurationMin,
      derivedInsight?.nextRunSuggestion.durationMin
    ),
    nextRunDurationMax: toNumericValue(
      nextRunSnapshot?.durationMax,
      ai.nextRunDurationMax,
      derivedInsight?.nextRunSuggestion.durationMax
    ),
    nextRunPaceMinSecPerKm: toNumericValue(
      nextRunSnapshot?.paceMinSecPerKm,
      ai.nextRunPaceMinSecPerKm,
      derivedInsight?.nextRunSuggestion.paceMinSecPerKm
    ),
    nextRunPaceMaxSecPerKm: toNumericValue(
      nextRunSnapshot?.paceMaxSecPerKm,
      ai.nextRunPaceMaxSecPerKm,
      derivedInsight?.nextRunSuggestion.paceMaxSecPerKm
    ),
    weekTitle: compactText(weeklySummarySnapshot.title ?? ai.weekTitle)
      || buildFallbackWeekTitle(derivedInsight, raceContext),
    weekSummary: compactText(weeklySummarySnapshot.summary ?? ai.weekSummary)
      || buildFallbackWeekSummary(derivedInsight, raceContext)
  };
}

export function buildCoachFeedbackFromCanonical(input: {
  canonicalOutput: CanonicalSiteOutput;
  raceContext: RaceContext;
}): CoachFeedback {
  const { canonicalOutput, raceContext } = input;
  const mainParagraph = canonicalOutput.signalParagraphs[0] ?? canonicalOutput.carryForward;
  const extendedTakeaway = canonicalOutput.signalParagraphs.slice(0, 2).join(" ");

  return {
    headline: canonicalOutput.signalTitle,
    verdict: truncateText(raceContext.sessionRelevance || canonicalOutput.weekSummary, 144),
    summaryShort: truncateText(mainParagraph, 118, true),
    mainTakeaway: truncateText(extendedTakeaway || mainParagraph, 180),
    nextRecommendation: truncateText(
      compactText(`${canonicalOutput.carryForward} ${canonicalOutput.nextRunSummary}`),
      180
    )
  };
}

export function buildNextRunFromCanonical(input: {
  canonicalOutput: CanonicalSiteOutput;
  forecast?: ForecastDay[];
}): NextRun {
  const { canonicalOutput, forecast = [] } = input;

  return {
    name: canonicalOutput.nextRunTitle,
    estimatedDuration: formatDurationRange(
      canonicalOutput.nextRunDurationMin,
      canonicalOutput.nextRunDurationMax
    ),
    paceRange: formatPaceRange(
      canonicalOutput.nextRunPaceMinSecPerKm,
      canonicalOutput.nextRunPaceMaxSecPerKm
    ),
    goal: canonicalOutput.nextRunSummary,
    forecast
  };
}

export function applyCanonicalWeekSummary(input: {
  weeklySnapshot: WeeklySnapshot;
  canonicalOutput: CanonicalSiteOutput;
}): WeeklySnapshot {
  return {
    ...input.weeklySnapshot,
    trainingStatus: input.canonicalOutput.weekTitle,
    summary: input.canonicalOutput.weekSummary
  };
}
