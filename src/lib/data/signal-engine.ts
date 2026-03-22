import fs from "node:fs/promises";
import { readJsonFile } from "./json.ts";
import {
  buildSessionSlug,
  selectEditorialSessionTitle,
  type PacerCmsLatestSession,
  type PacerCmsNextRun
} from "./pacer-cms.ts";
import { resolvePacerExportPath, resolvePacerStoragePath } from "./paths.ts";
import type {
  CoachFeedback,
  DerivedInsights,
  DerivedNextRunSuggestion,
  DerivedSessionInsight,
  PacerActivity,
  PacerExport,
  RaceContext,
  SignalConfidenceLevel,
  SignalSourceName
} from "./types.ts";

interface LocalStreamPayload {
  [key: string]: { data?: unknown[] } | unknown[] | undefined;
}

interface SegmentSample {
  paceSecPerKm: number;
  heartRate: number | null;
  distanceM: number | null;
}

type SessionIntent = "easy" | "long" | "tempo" | "steady";

const GPS_NOTE_RE = /\bgps\b|pifia|pace.*(wrong|off|jump|weird)|trace/i;
const HEAT_NOTE_RE = /\bheat\b|calor|humid|hot|sud[eé]|sol/i;

function formatPaceLabel(value: number | null): string | null {
  if (!value || value <= 0) {
    return null;
  }

  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")} /km`;
}

function formatDurationLabel(minMinutes: number | null, maxMinutes: number | null): string | null {
  if (typeof minMinutes === "number" && typeof maxMinutes === "number") {
    return minMinutes === maxMinutes ? `${minMinutes} min` : `${minMinutes}-${maxMinutes} min`;
  }

  if (typeof minMinutes === "number") {
    return `${minMinutes} min`;
  }

  if (typeof maxMinutes === "number") {
    return `${maxMinutes} min`;
  }

  return null;
}

function formatPaceRangeLabel(basePace: number | null, slowerOffsetMin: number, slowerOffsetMax: number): string | null {
  if (basePace === null) {
    return null;
  }

  const slowerLabel = formatPaceLabel(basePace + slowerOffsetMin)?.replace(" /km", "") ?? null;
  const slowestLabel = formatPaceLabel(basePace + slowerOffsetMax)?.replace(" /km", "") ?? null;

  if (!slowerLabel || !slowestLabel) {
    return null;
  }

  return `${slowerLabel}-${slowestLabel} /km`;
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateSentence(value: string, maxLength = 118): string {
  const compact = compactText(value);

  if (compact.length <= maxLength) {
    return compact;
  }

  return `${compact.slice(0, maxLength - 1).trimEnd()}…`;
}

function toStreamSeries(payload: LocalStreamPayload | null, key: string): number[] {
  const source = payload?.[key];

  if (Array.isArray(source)) {
    return source.filter((entry): entry is number => typeof entry === "number");
  }

  if (source && typeof source === "object" && Array.isArray(source.data)) {
    return source.data.filter((entry): entry is number => typeof entry === "number");
  }

  return [];
}

function toBooleanStream(payload: LocalStreamPayload | null, key: string): boolean[] {
  const source = payload?.[key];

  if (Array.isArray(source)) {
    return source.filter((entry): entry is boolean => typeof entry === "boolean");
  }

  if (source && typeof source === "object" && Array.isArray(source.data)) {
    return source.data.filter((entry): entry is boolean => typeof entry === "boolean");
  }

  return [];
}

function compressSegments(samples: SegmentSample[], targetCount = 10): SegmentSample[] {
  if (samples.length <= targetCount) {
    return samples;
  }

  const compressed: SegmentSample[] = [];
  const windowSize = samples.length / targetCount;

  for (let index = 0; index < targetCount; index += 1) {
    const start = Math.floor(index * windowSize);
    const end = Math.floor((index + 1) * windowSize);
    const chunk = samples.slice(start, Math.max(start + 1, end));

    if (chunk.length === 0) {
      continue;
    }

    const hrValues = chunk
      .map((sample) => sample.heartRate)
      .filter((value): value is number => typeof value === "number");

    compressed.push({
      paceSecPerKm: Math.round(chunk.reduce((sum, sample) => sum + sample.paceSecPerKm, 0) / chunk.length),
      heartRate: hrValues.length > 0 ? Math.round(hrValues.reduce((sum, value) => sum + value, 0) / hrValues.length) : null,
      distanceM: chunk.reduce((sum, sample) => sum + (sample.distanceM ?? 0), 0)
    });
  }

  return compressed;
}

function buildSegmentsFromStreams(payload: LocalStreamPayload | null): SegmentSample[] {
  const speeds = toStreamSeries(payload, "velocity_smooth");
  const heartRates = toStreamSeries(payload, "heartrate");
  const distances = toStreamSeries(payload, "distance");
  const moving = toBooleanStream(payload, "moving");

  if (speeds.length < 24 || heartRates.length < 24) {
    return [];
  }

  const samples: SegmentSample[] = [];

  for (let index = 0; index < speeds.length; index += 1) {
    const speed = speeds[index];

    if (!speed || speed <= 0) {
      continue;
    }

    if (moving.length > index && moving[index] === false) {
      continue;
    }

    const distanceDelta = index === 0 || distances.length <= index
      ? null
      : Math.max(0, distances[index] - distances[index - 1]);

    samples.push({
      paceSecPerKm: Math.round(1000 / speed),
      heartRate: typeof heartRates[index] === "number" ? Math.round(heartRates[index]) : null,
      distanceM: distanceDelta
    });
  }

  return compressSegments(samples, 12);
}

function hasUsableStreamPayload(payload: LocalStreamPayload | null): boolean {
  return toStreamSeries(payload, "velocity_smooth").length >= 24
    && toStreamSeries(payload, "heartrate").length >= 24;
}

function parseTagValue(block: string, tagName: string): string | null {
  const match = block.match(new RegExp(`<${tagName}>([^<]+)</${tagName}>`, "i"));
  return match?.[1]?.trim() ?? null;
}

function parseHeartRate(block: string): number | null {
  const nested = block.match(/<HeartRateBpm>[\s\S]*?<Value>([^<]+)<\/Value>[\s\S]*?<\/HeartRateBpm>/i);
  if (!nested?.[1]) {
    return null;
  }

  const parsed = Number(nested[1]);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function buildSegmentsFromTcx(xml: string): SegmentSample[] {
  const matches = xml.match(/<Trackpoint>[\s\S]*?<\/Trackpoint>/gi) ?? [];

  if (matches.length < 20) {
    return [];
  }

  const trackpoints: Array<{
    timestamp: number;
    distanceM: number | null;
    heartRate: number | null;
  }> = [];

  for (const block of matches) {
    const timeValue = parseTagValue(block, "Time");
    const distanceValue = parseTagValue(block, "DistanceMeters");
    const timestamp = timeValue ? Date.parse(timeValue) : NaN;
    const distanceM = distanceValue ? Number(distanceValue) : null;

    if (Number.isNaN(timestamp) || !Number.isFinite(distanceM)) {
      continue;
    }

    trackpoints.push({
      timestamp,
      distanceM,
      heartRate: parseHeartRate(block)
    });
  }

  if (trackpoints.length < 12) {
    return [];
  }

  const samples: SegmentSample[] = [];
  let bucketStart = trackpoints[0];
  let bucketHeartRates: number[] = bucketStart.heartRate === null ? [] : [bucketStart.heartRate];

  for (let index = 1; index < trackpoints.length; index += 1) {
    const point = trackpoints[index];
    const distanceDelta = (point.distanceM ?? 0) - (bucketStart.distanceM ?? 0);
    const timeDelta = (point.timestamp - bucketStart.timestamp) / 1000;

    if (point.heartRate !== null) {
      bucketHeartRates.push(point.heartRate);
    }

    if (distanceDelta < 250 || timeDelta <= 0) {
      continue;
    }

    samples.push({
      paceSecPerKm: Math.round((timeDelta / distanceDelta) * 1000),
      heartRate: bucketHeartRates.length > 0
        ? Math.round(bucketHeartRates.reduce((sum, value) => sum + value, 0) / bucketHeartRates.length)
        : null,
      distanceM: distanceDelta
    });

    bucketStart = point;
    bucketHeartRates = point.heartRate === null ? [] : [point.heartRate];
  }

  return compressSegments(samples, 10);
}

async function loadOptionalTcxSamples(fileName: string | null): Promise<SegmentSample[]> {
  if (!fileName) {
    return [];
  }

  const candidates = [
    resolvePacerStoragePath("files", "tcx", fileName),
    resolvePacerStoragePath("uploads", "tcx", fileName),
    resolvePacerStoragePath("tcx", fileName),
    resolvePacerStoragePath("files", fileName),
    resolvePacerStoragePath("uploads", fileName)
  ];

  for (const candidate of candidates) {
    try {
      const xml = await fs.readFile(candidate, "utf8");
      const samples = buildSegmentsFromTcx(xml);

      if (samples.length > 0) {
        return samples;
      }
    } catch {
      // Optional support only: ignore missing or unreadable files.
    }
  }

  return [];
}

async function loadOptionalStreamPayload(sourceActivityId: number): Promise<LocalStreamPayload | null> {
  const directPath = resolvePacerStoragePath("json", "streams", `${sourceActivityId}.json`);

  try {
    return await readJsonFile<LocalStreamPayload>(directPath);
  } catch {
    return null;
  }
}

async function loadActivityBundle(): Promise<PacerExport | null> {
  return readJsonFile<PacerExport>(resolvePacerExportPath());
}

function buildSegmentsFromLaps(snapshot: PacerCmsLatestSession): SegmentSample[] {
  return snapshot.laps
    .filter((lap) => typeof lap.paceSecPerKm === "number" && lap.paceSecPerKm > 0)
    .filter((lap) => typeof lap.distanceM === "number" && lap.distanceM >= 350)
    .map((lap) => ({
      paceSecPerKm: Math.round(lap.paceSecPerKm!),
      heartRate: typeof lap.hrAvg === "number" ? Math.round(lap.hrAvg) : null,
      distanceM: lap.distanceM
    }));
}

function getSignalSamples(
  snapshot: PacerCmsLatestSession,
  streamPayload: LocalStreamPayload | null,
  tcxSamples: SegmentSample[]
): SegmentSample[] {
  const streamSamples = buildSegmentsFromStreams(streamPayload);

  if (streamSamples.length >= 6) {
    return streamSamples;
  }

  if (tcxSamples.length >= 6) {
    return tcxSamples;
  }

  return buildSegmentsFromLaps(snapshot);
}

function detectSessionIntent(snapshot: PacerCmsLatestSession, activity: PacerActivity | null): SessionIntent {
  const manualValue = `${snapshot.manual.sessionType} ${snapshot.title}`.toLowerCase();

  if (manualValue.includes("easy") || manualValue.includes("recovery") || manualValue.includes("reset")) {
    return "easy";
  }

  if (manualValue.includes("long")) {
    return "long";
  }

  if (manualValue.includes("tempo") || manualValue.includes("threshold") || manualValue.includes("interval")) {
    return "tempo";
  }

  if (activity?.workout_type === 3) {
    return "tempo";
  }

  if ((snapshot.distanceM ?? 0) >= 12000) {
    return "long";
  }

  return "steady";
}

function intentLabel(intent: SessionIntent): string {
  switch (intent) {
    case "easy":
      return "Easy run";
    case "long":
      return "Long run";
    case "tempo":
      return "Tempo session";
    default:
      return "Steady run";
  }
}

function splitHalves(samples: SegmentSample[]): { first: SegmentSample[]; second: SegmentSample[] } {
  const midpoint = Math.floor(samples.length / 2);

  return {
    first: samples.slice(0, midpoint),
    second: samples.slice(midpoint)
  };
}

function averagePace(samples: SegmentSample[]): number | null {
  if (samples.length === 0) {
    return null;
  }

  return Math.round(samples.reduce((sum, sample) => sum + sample.paceSecPerKm, 0) / samples.length);
}

function averageHeartRate(samples: SegmentSample[]): number | null {
  const heartRates = samples
    .map((sample) => sample.heartRate)
    .filter((value): value is number => typeof value === "number");

  if (heartRates.length === 0) {
    return null;
  }

  return Math.round(heartRates.reduce((sum, value) => sum + value, 0) / heartRates.length);
}

function buildCardiacDrift(samples: SegmentSample[]) {
  if (samples.length < 4) {
    return {
      label: "Not enough samples",
      note: "Lap and stream data are too thin to estimate drift with confidence.",
      heartRateDelta: null,
      paceDeltaSecPerKm: null
    };
  }

  const { first, second } = splitHalves(samples);
  const firstPace = averagePace(first);
  const secondPace = averagePace(second);
  const firstHeartRate = averageHeartRate(first);
  const secondHeartRate = averageHeartRate(second);
  const paceDelta = firstPace !== null && secondPace !== null ? secondPace - firstPace : null;
  const heartRateDelta = firstHeartRate !== null && secondHeartRate !== null ? secondHeartRate - firstHeartRate : null;

  if (heartRateDelta === null || paceDelta === null) {
    return {
      label: "Partial estimate",
      note: "Drift read is incomplete because heart-rate coverage is patchy.",
      heartRateDelta,
      paceDeltaSecPerKm: paceDelta
    };
  }

  if (heartRateDelta >= 8 && paceDelta >= 4) {
    return {
      label: "High drift",
      note: `Heart rate climbed ${heartRateDelta} bpm while pace slowed ${paceDelta}s/km.`,
      heartRateDelta,
      paceDeltaSecPerKm: paceDelta
    };
  }

  if (heartRateDelta >= 5 && paceDelta >= -3) {
    return {
      label: "Moderate drift",
      note: `Heart rate rose ${heartRateDelta} bpm through the second half without a cheaper pace profile.`,
      heartRateDelta,
      paceDeltaSecPerKm: paceDelta
    };
  }

  if (heartRateDelta >= 3 && paceDelta <= -8) {
    return {
      label: "Progressive close",
      note: `Heart rate rose ${heartRateDelta} bpm while pace improved ${Math.abs(paceDelta)}s/km.`,
      heartRateDelta,
      paceDeltaSecPerKm: paceDelta
    };
  }

  return {
    label: "Low drift",
    note: "The pace/heart-rate relationship stayed mostly stable across the session.",
    heartRateDelta,
    paceDeltaSecPerKm: paceDelta
  };
}

function buildHeatImpact(snapshot: PacerCmsLatestSession): { label: string; note: string } {
  const noteText = snapshot.manual.extraNotes.toLowerCase();
  const temperature = snapshot.weatherTempC;
  const condition = (snapshot.weatherCondition ?? "").toLowerCase();

  if ((typeof temperature === "number" && temperature >= 24) || HEAT_NOTE_RE.test(noteText)) {
    return {
      label: "Heat mattered",
      note: `Warm conditions (${typeof temperature === "number" ? `${Math.round(temperature)}C` : "unknown temp"}) likely raised the internal cost.`
    };
  }

  if (typeof temperature === "number" && temperature >= 19) {
    return {
      label: "Warm but manageable",
      note: `Conditions stayed workable, even if ${condition || "the air"} added a little load.`
    };
  }

  return {
    label: "Neutral conditions",
    note: "Weather was not the main limiter on this session."
  };
}

function buildGpsConfidence(snapshot: PacerCmsLatestSession): { label: string; note: string } {
  const noteText = snapshot.manual.extraNotes.toLowerCase();
  const shortLapCount = snapshot.laps.filter((lap) => typeof lap.distanceM === "number" && lap.distanceM < 400).length;

  if (GPS_NOTE_RE.test(noteText)) {
    return {
      label: "Watch the pace trace",
      note: "The notes already flag GPS noise, so exact pace targets should be treated as approximate."
    };
  }

  if (shortLapCount >= 5) {
    return {
      label: "Fragmented laps",
      note: "There are several short lap fragments, so block boundaries are approximate even if the broad read still holds."
    };
  }

  if (snapshot.routeSvgPoints) {
    return {
      label: "Mostly clean",
      note: "Route and lap data look stable enough for a confident broad read."
    };
  }

  return {
    label: "Usable, but limited",
    note: "The session can be read from pace and heart-rate summaries even without a route trace."
  };
}

function buildConfidenceMetadata(
  snapshot: PacerCmsLatestSession,
  activity: PacerActivity | null,
  streamPayload: LocalStreamPayload | null,
  tcxSamples: SegmentSample[]
): {
  signalConfidence: SignalConfidenceLevel;
  dataSourcesUsed: SignalSourceName[];
  missingSignals: SignalSourceName[];
} {
  const hasSessionSummary = Boolean(
    activity
    || snapshot.distanceM !== null
    || snapshot.movingTimeS !== null
    || snapshot.paceSecPerKm !== null
  );
  const hasLaps = snapshot.laps.length > 0;
  const hasStreams = hasUsableStreamPayload(streamPayload);
  const hasTcx = tcxSamples.length >= 6;
  const hasWeather = typeof snapshot.weatherTempC === "number" || Boolean(snapshot.weatherCondition);
  const hasManualNotes = Boolean(
    snapshot.manual.sessionType
    || snapshot.manual.extraNotes
    || snapshot.manual.legs
    || snapshot.manual.restedness
    || typeof snapshot.manual.sleepScore === "number"
  );

  const availability: Array<[SignalSourceName, boolean]> = [
    ["session_summary", hasSessionSummary],
    ["laps", hasLaps],
    ["streams", hasStreams],
    ["tcx", hasTcx],
    ["weather", hasWeather],
    ["manual_notes", hasManualNotes]
  ];

  const dataSourcesUsed = availability.filter((entry) => entry[1]).map((entry) => entry[0]);
  const missingSignals = availability.filter((entry) => !entry[1]).map((entry) => entry[0]);

  let signalConfidence: SignalConfidenceLevel = "low";

  if (hasSessionSummary && hasLaps && (hasStreams || hasTcx) && hasWeather && hasManualNotes) {
    signalConfidence = "high";
  } else if (hasSessionSummary && hasLaps && (hasWeather || hasManualNotes || hasStreams || hasTcx)) {
    signalConfidence = "medium";
  }

  return {
    signalConfidence,
    dataSourcesUsed,
    missingSignals
  };
}

function buildFinishPattern(intent: SessionIntent, samples: SegmentSample[]): string {
  if (samples.length < 4) {
    return "Not enough structure";
  }

  const third = Math.max(1, Math.floor(samples.length / 3));
  const early = averagePace(samples.slice(0, third));
  const late = averagePace(samples.slice(-third));

  if (early === null || late === null) {
    return "Not enough structure";
  }

  const delta = late - early;

  if (delta <= -18) {
    return intent === "long" ? "Sharp finish" : "Strong finish";
  }

  if (delta <= -8) {
    return "Progressive close";
  }

  if (delta >= 15) {
    return "Faded late";
  }

  return "Even finish";
}

function buildBlockStructure(intent: SessionIntent, snapshot: PacerCmsLatestSession, samples: SegmentSample[]): string {
  const anchorLaps = snapshot.laps.filter((lap) => typeof lap.distanceM === "number" && lap.distanceM >= 800);
  const shortLapCount = snapshot.laps.filter((lap) => typeof lap.distanceM === "number" && lap.distanceM < 400).length;
  const samplePace = averagePace(samples) ?? snapshot.paceSecPerKm ?? null;

  if (intent === "tempo") {
    if (shortLapCount >= 5) {
      return "Structured work showed up, but the lap trace is fragmented and better read as broad tempo load than exact reps.";
    }

    const fasterSamples = samples.filter((sample) => samplePace !== null && sample.paceSecPerKm <= samplePace - 12);

    if (fasterSamples.length >= 3) {
      return "Warm-up, controlled work, and a short settle-down were all visible in the shape of the session.";
    }

    return "The session still reads as quality work, even if the block boundaries are imperfect.";
  }

  if (intent === "long") {
    return buildFinishPattern(intent, samples) === "Sharp finish"
      ? "Mostly continuous endurance work, with the last kilometers turning into a firmer close."
      : "Continuous endurance running with a mostly even aerobic shape.";
  }

  if (intent === "easy") {
    return shortLapCount >= 2
      ? "Mostly easy running, with a few uneven patches that broke the rhythm."
      : "Continuous easy aerobic running without a lot of structural noise.";
  }

  if (anchorLaps.length >= 4) {
    return "A steady continuous run, readable more by the trend than by distinct blocks.";
  }

  return "Broad aerobic work, with just enough structure to read the day without overfitting it.";
}

function buildEffortCost(
  intent: SessionIntent,
  snapshot: PacerCmsLatestSession,
  cardiacDriftLabel: string,
  heatLabel: string,
  finishPattern: string
): string {
  let score = 0;

  if (intent === "easy" && (snapshot.hrAvg ?? 0) >= 155) {
    score += 2;
  }

  if ((snapshot.hrMax ?? 0) >= 182) {
    score += 1;
  }

  if (cardiacDriftLabel === "High drift") {
    score += 1;
  }

  if (heatLabel === "Heat mattered") {
    score += 1;
  }

  if (finishPattern === "Sharp finish") {
    score += 1;
  }

  if ((snapshot.manual.sleepScore ?? 100) < 75) {
    score += 1;
  }

  if (score >= 4) {
    return "High cost";
  }

  if (score >= 2) {
    return "Manageable cost";
  }

  return "Low cost";
}

function buildExecutionQuality(
  intent: SessionIntent,
  effortCost: string,
  finishPattern: string,
  gpsLabel: string
): string {
  if (intent === "easy") {
    return effortCost === "High cost"
      ? "Easy day drifted above easy"
      : "Easy effort stayed mostly honest";
  }

  if (intent === "long") {
    return finishPattern === "Sharp finish"
      ? "Long run ended harder than it needed to"
      : "Long run stayed mostly controlled";
  }

  if (intent === "tempo") {
    if (gpsLabel === "Watch the pace trace" || gpsLabel === "Fragmented laps") {
      return "Tempo work landed, but the trace is noisy";
    }

    return effortCost === "High cost"
      ? "Tempo work landed, but at a noticeable cost"
      : "Tempo work looked controlled and repeatable";
  }

  return effortCost === "High cost"
    ? "Useful work, but costlier than ideal"
    : "Steady work landed cleanly";
}

function buildCarryForward(
  intent: SessionIntent,
  executionQuality: string,
  finishPattern: string,
  effortCost: string
): string {
  if (intent === "easy" && executionQuality.includes("drifted")) {
    return "Bring the next aerobic run back under control and let the heart rate sit lower.";
  }

  if (intent === "long" && finishPattern === "Sharp finish") {
    return "Let the next run absorb the long-run cost instead of turning it into another quality day.";
  }

  if (intent === "tempo") {
    return effortCost === "High cost"
      ? "Bank the quality, then come back with an easy reset instead of stacking intensity."
      : "Keep the next run quiet so the quality stays useful instead of expensive.";
  }

  return effortCost === "High cost"
    ? "Protect the next session and keep it genuinely light."
    : "Carry the rhythm forward without chasing more work than the week needs.";
}

function buildNextRunSuggestion(intent: SessionIntent, snapshot: PacerCmsLatestSession, carryForward: string): DerivedNextRunSuggestion {
  const basePace = snapshot.paceSecPerKm ?? null;

  if (intent === "tempo" || intent === "long") {
    const durationMin = 35;
    const durationMax = 45;
    const paceMinSecPerKm = basePace === null ? null : basePace + 25;
    const paceMaxSecPerKm = basePace === null ? null : basePace + 45;

    return {
      title: "Easy reset run",
      summary: carryForward,
      durationMin,
      durationMax,
      paceMinSecPerKm,
      paceMaxSecPerKm,
      durationLabel: formatDurationLabel(durationMin, durationMax),
      paceRangeLabel: formatPaceRangeLabel(basePace, 25, 45)
    };
  }

  if (intent === "easy") {
    const durationMin = 30;
    const durationMax = 40;
    const paceMinSecPerKm = basePace === null ? null : basePace + 20;
    const paceMaxSecPerKm = basePace === null ? null : basePace + 35;

    return {
      title: "Quiet aerobic run",
      summary: "Keep the effort below this session's cost and use it to restore rhythm.",
      durationMin,
      durationMax,
      paceMinSecPerKm,
      paceMaxSecPerKm,
      durationLabel: formatDurationLabel(durationMin, durationMax),
      paceRangeLabel: formatPaceRangeLabel(basePace, 20, 35)
    };
  }

  const durationMin = 40;
  const durationMax = 50;
  const paceMinSecPerKm = basePace === null ? null : basePace + 15;
  const paceMaxSecPerKm = basePace === null ? null : basePace + 30;

  return {
    title: "Steady aerobic run",
    summary: "Keep the next run smooth enough to preserve the rhythm without adding hidden cost.",
    durationMin,
    durationMax,
    paceMinSecPerKm,
    paceMaxSecPerKm,
    durationLabel: formatDurationLabel(durationMin, durationMax),
    paceRangeLabel: formatPaceRangeLabel(basePace, 15, 30)
  };
}

function buildSignalHeadline(intent: SessionIntent, executionQuality: string, finishPattern: string, gpsLabel: string): string {
  if (intent === "easy" && executionQuality.includes("drifted")) {
    return "Easy on paper, costlier in practice";
  }

  if (intent === "long" && finishPattern === "Sharp finish") {
    return "Long run with a sharper finish";
  }

  if (intent === "tempo" && gpsLabel === "Watch the pace trace") {
    return "Tempo work with noisy pacing";
  }

  if (intent === "tempo") {
    return "Tempo signal, mostly on target";
  }

  if (intent === "long") {
    return "Long run, mostly controlled";
  }

  return "Steady aerobic signal";
}

function buildSignalSummary(
  intent: SessionIntent,
  executionQuality: string,
  effortCost: string,
  finishPattern: string
): string {
  if (intent === "easy") {
    return executionQuality.includes("drifted")
      ? "The day still counts as useful aerobic work, but it asked for more than a true easy slot should."
      : "This looked like a genuine easy day and did not ask for more than it needed.";
  }

  if (intent === "long") {
    return finishPattern === "Sharp finish"
      ? "The volume was solid, but the close turned the long run a little more competitive than necessary."
      : "The run did the endurance job without getting pulled too far away from its aerobic purpose.";
  }

  if (intent === "tempo") {
    return effortCost === "High cost"
      ? "The work landed, but the session drifted toward a more expensive quality day than ideal."
      : "The work looked purposeful enough to count as quality without turning the whole day ragged.";
  }

  return "The session pushed the week forward in a readable, mostly controlled way.";
}

function buildDerivedInsight(
  snapshot: PacerCmsLatestSession,
  activity: PacerActivity | null,
  streamPayload: LocalStreamPayload | null,
  tcxSamples: SegmentSample[]
): DerivedSessionInsight {
  const title = selectEditorialSessionTitle(snapshot.title, snapshot.manual.sessionType);
  const slug = buildSessionSlug(snapshot.sessionDate, snapshot.title, snapshot.manual.sessionType);
  const intent = detectSessionIntent(snapshot, activity);
  const samples = getSignalSamples(snapshot, streamPayload, tcxSamples);
  const cardiacDrift = buildCardiacDrift(samples);
  const heatImpact = buildHeatImpact(snapshot);
  const gpsConfidence = buildGpsConfidence(snapshot);
  const confidence = buildConfidenceMetadata(snapshot, activity, streamPayload, tcxSamples);
  const finishPattern = buildFinishPattern(intent, samples);
  const effortCost = buildEffortCost(intent, snapshot, cardiacDrift.label, heatImpact.label, finishPattern);
  const executionQuality = buildExecutionQuality(intent, effortCost, finishPattern, gpsConfidence.label);
  const carryForward = buildCarryForward(intent, executionQuality, finishPattern, effortCost);
  const nextRunSuggestion = buildNextRunSuggestion(intent, snapshot, carryForward);
  const signalHeadline = buildSignalHeadline(intent, executionQuality, finishPattern, gpsConfidence.label);
  const signalSummary = buildSignalSummary(intent, executionQuality, effortCost, finishPattern);

  return {
    sessionId: snapshot.sessionId,
    sourceActivityId: snapshot.sourceActivityId,
    slug,
    sessionDate: snapshot.sessionDate,
    title,
    signalHeadline,
    signalSummary,
    sessionIntentDetected: intentLabel(intent),
    blockStructure: buildBlockStructure(intent, snapshot, samples),
    executionQuality,
    finishPattern,
    effortCost,
    cardiacDrift,
    heatImpact,
    gpsConfidence,
    signalConfidence: confidence.signalConfidence,
    dataSourcesUsed: confidence.dataSourcesUsed,
    missingSignals: confidence.missingSignals,
    carryForward,
    nextRunSuggestion
  };
}

export async function buildDerivedInsights(snapshots: PacerCmsLatestSession[]): Promise<DerivedInsights> {
  const generatedAt = new Date().toISOString();
  const bundle = await loadActivityBundle();
  const activitiesById = new Map<number, PacerActivity>();

  for (const activity of bundle?.activities ?? []) {
    if (typeof activity.id === "number") {
      activitiesById.set(activity.id, activity);
    }
  }

  const sessions = await Promise.all(snapshots.map(async (snapshot) => {
    const [streamPayload, tcxSamples] = await Promise.all([
      loadOptionalStreamPayload(snapshot.sourceActivityId),
      loadOptionalTcxSamples(snapshot.files.tcxAttached ? snapshot.files.tcxFilename : null)
    ]);

    return buildDerivedInsight(
      snapshot,
      activitiesById.get(snapshot.sourceActivityId) ?? null,
      streamPayload,
      tcxSamples
    );
  }));

  return {
    generatedAt,
    latest: sessions[0] ?? null,
    sessions
  };
}

export function buildCoachFeedbackFromDerived(input: {
  latestSnapshot: PacerCmsLatestSession;
  derivedInsight: DerivedSessionInsight | null;
  raceContext: RaceContext;
  nextRunSnapshot: PacerCmsNextRun | null;
}): CoachFeedback {
  const { latestSnapshot, derivedInsight, raceContext, nextRunSnapshot } = input;

  if (!derivedInsight) {
    return {
      headline: selectEditorialSessionTitle(latestSnapshot.title, latestSnapshot.manual.sessionType),
      verdict: latestSnapshot.ai.signalTitle || "Useful session",
      summaryShort: truncateSentence(latestSnapshot.ai.signalParagraphs[0] ?? latestSnapshot.ai.carryForward ?? "Published and ready to read."),
      mainTakeaway: latestSnapshot.ai.signalParagraphs[0] ?? latestSnapshot.ai.carryForward ?? "Published and ready to read.",
      nextRecommendation: nextRunSnapshot?.summary ?? latestSnapshot.ai.nextRunSummary ?? ""
    };
  }

  const verdict = raceContext.sessionRelevance || derivedInsight.executionQuality;
  const mainTakeaway = `${derivedInsight.blockStructure} ${derivedInsight.cardiacDrift.note}`;

  return {
    headline: derivedInsight.signalHeadline,
    verdict: truncateSentence(verdict, 128),
    summaryShort: truncateSentence(derivedInsight.signalSummary, 118),
    mainTakeaway: truncateSentence(mainTakeaway, 180),
    nextRecommendation: truncateSentence(
      compactText([
        derivedInsight.carryForward,
        nextRunSnapshot?.summary ?? ""
      ].filter(Boolean).join(" ")),
      180
    )
  };
}
