export interface LapSummary {
  lapNumber: number;
  title: string;
  distanceKm: number | null;
  durationLabel: string;
  paceLabel: string | null;
  averageHeartRate: number | null;
}

export interface LatestSession {
  source: "pacer" | "mock";
  title: string;
  activityType: string;
  date: string;
  startDateLocal: string | null;
  distanceKm: number | null;
  durationSeconds: number;
  durationLabel: string;
  paceLabel: string | null;
  averageHeartRate: number | null;
  maxHeartRate: number | null;
  elevationMeters: number | null;
  weatherLabel: string | null;
  statusLabel: string | null;
  overallFeeling: string | null;
  personalNote: string | null;
  locationLabel: string | null;
  laps: LapSummary[];
  // Pre-normalized SVG polyline points string ("x,y x,y ...") built at prepare time.
  // Absent or null when no route data is available (mock data, no polyline in export).
  routeSvgPoints?: string | null;
}

export interface WeeklyTrendDay {
  date: string;
  label: string;
  distanceKm: number;
}

export interface WeeklySnapshot {
  source: "pacer" | "mock";
  windowLabel: string;
  totalKm: number;
  runCount: number;
  totalTimeMinutes: number;
  rideCount: number;
  rideKm: number;
  summary: string;
  trainingStatus: string;
  dailyDistanceKm: WeeklyTrendDay[];
}

export interface CoachFeedback {
  headline: string;
  verdict: string;
  summaryShort: string;
  mainTakeaway: string;
  nextRecommendation: string;
}

export interface ForecastDay {
  date: string;
  label: string;
  summary: string;
  temperatureMaxC: number | null;
  temperatureMinC: number | null;
}

export interface NextRun {
  name: string;
  estimatedDuration: string;
  paceRange: string;
  goal: string;
  workout?: NextRunWorkout | null;
  forecast?: ForecastDay[];
}

export interface NextRunWorkout {
  type: string;
  blocks: string[];
}

export interface UsefulRead {
  title: string;
  url: string;
  source: string;
  topic?: string;
  published?: string;
  publishedLabel?: string;
}

export interface UsefulReadFeedSource {
  name: string;
  url: string;
  topic: string;
}

export interface UsefulReadFeedConfig {
  feeds: UsefulReadFeedSource[];
}

export interface MotivationNote {
  quote: string;
  note: string;
  sourceLabel: string;
}

export interface SiteCopy {
  brand: string;
  tagline: string;
  heroKicker: string;
  heroTitle: string;
  heroBody: string;
  conceptTitle: string;
  conceptBody: string;
  conceptPoints: string[];
  builtOn: string;
}

export interface EinkSummary {
  date: string;
  latest_run_title: string;
  latest_run_distance: string;
  weekly_km: string;
  short_feedback: string;
  next_run: string;
}

export interface EinkSummaryV2Meta {
  version: 2;
  generated_at: string;
  updated_label: string;
  rotate_seconds: number;
}

export interface EinkSummaryV2LatestScreen {
  id: "latest";
  title: string;
  date: string;
  distance: string;
  weekly_km: string;
  feedback: string;
}

export interface EinkSummaryV2NextScreen {
  id: "next";
  title: string;
  name: string;
  duration: string;
  pace_range: string;
  goal: string;
}

export interface EinkSummaryV2WeekScreen {
  id: "week";
  title: string;
  weekly_km: string;
  runs: number;
  total_time: string;
  weather_label: string | null;
  weather_temp: string | null;
  weather_note: string | null;
}

export type EinkSummaryV2Screen =
  | EinkSummaryV2LatestScreen
  | EinkSummaryV2NextScreen
  | EinkSummaryV2WeekScreen;

export interface EinkSummaryV2 {
  meta: EinkSummaryV2Meta;
  screens: EinkSummaryV2Screen[];
}

export interface SessionNotes {
  statusLabel?: string | null;
  overallFeeling?: string | null;
  personalNote?: string | null;
  weatherLabel?: string | null;
  trainingStatus?: string | null;
  weeklySummary?: string | null;
  locationLabel?: string | null;
}

export interface WeatherSnapshot {
  latestRunLabel: string | null;
  nextRunForecast: ForecastDay[];
}

export type SignalConfidenceLevel = "high" | "medium" | "low";

export type SignalSourceName =
  | "session_summary"
  | "laps"
  | "streams"
  | "tcx"
  | "weather"
  | "manual_notes";

export interface SignalConfidenceMetadata {
  signalConfidence: SignalConfidenceLevel;
  dataSourcesUsed: SignalSourceName[];
  missingSignals: SignalSourceName[];
}

export interface DerivedSignalNote {
  label: string;
  note: string;
}

export interface DerivedCardiacDrift {
  label: string;
  note: string;
  heartRateDelta: number | null;
  paceDeltaSecPerKm: number | null;
}

export interface DerivedNextRunSuggestion {
  title: string;
  summary: string;
  durationMin: number | null;
  durationMax: number | null;
  paceMinSecPerKm: number | null;
  paceMaxSecPerKm: number | null;
  durationLabel: string | null;
  paceRangeLabel: string | null;
}

export interface DerivedSessionInsight {
  sessionId: number;
  sourceActivityId: number;
  slug: string;
  sessionDate: string;
  title: string;
  signalHeadline: string;
  signalSummary: string;
  sessionIntentDetected: string;
  blockStructure: string;
  executionQuality: string;
  finishPattern: string;
  effortCost: string;
  cardiacDrift: DerivedCardiacDrift;
  heatImpact: DerivedSignalNote;
  gpsConfidence: DerivedSignalNote;
  signalConfidence: SignalConfidenceLevel;
  dataSourcesUsed: SignalSourceName[];
  missingSignals: SignalSourceName[];
  carryForward: string;
  nextRunSuggestion: DerivedNextRunSuggestion;
}

export interface DerivedInsights {
  generatedAt: string;
  latest: DerivedSessionInsight | null;
  sessions: DerivedSessionInsight[];
}

export interface RaceDefinition {
  slug: string;
  title: string;
  date: string;
  distanceKm: number;
  goalTimeMin?: number | null;
  priority: "A" | "B" | "C";
}

export interface RaceContextNextRace extends RaceDefinition {
  daysToRace: number;
  targetPaceSecPerKm: number | null;
  targetPaceLabel: string | null;
}

export interface RaceContextActivityMetric {
  label: string;
  value: string;
}

export interface RaceContextRecentActivity {
  title: string;
  date: string;
  metrics: RaceContextActivityMetric[];
}

export interface PacerCmsActivityContextMetric {
  label: "duration" | "avgHr" | "calories" | "distance" | "movingTime";
  value: number | null;
}

export interface PacerCmsActivityContextItem {
  sourceActivityId: number | null;
  title: string;
  sport: string;
  startDateLocal: string;
  metrics: PacerCmsActivityContextMetric[];
}

export interface PacerCmsActivityContext {
  generatedAt: string;
  latestTraining: PacerCmsActivityContextItem | null;
  latestRide: PacerCmsActivityContextItem | null;
}

export interface RaceContext {
  generatedAt: string;
  nextRace: RaceContextNextRace | null;
  mainGoal: RaceContextNextRace | null;
  daysToRace: number | null;
  targetPaceSecPerKm: number | null;
  targetPaceLabel: string | null;
  currentPhase: string;
  focusLabel: string;
  sessionRelevance: string;
  latestTraining: RaceContextRecentActivity | null;
  latestRide: RaceContextRecentActivity | null;
}

export interface CanonicalSiteOutput {
  signalTitle: string;
  signalParagraphs: string[];
  carryForward: string;
  nextRunTitle: string;
  nextRunSummary: string;
  nextRunDurationMin: number;
  nextRunDurationMax: number;
  nextRunPaceMinSecPerKm: number;
  nextRunPaceMaxSecPerKm: number;
  weekTitle: string;
  weekSummary: string;
}

export interface RunDashboardData {
  site: SiteCopy;
  latestSession: LatestSession;
  weeklySnapshot: WeeklySnapshot;
  coachFeedback: CoachFeedback;
  nextRun: NextRun;
  motivation: MotivationNote;
  usefulReads: UsefulRead[];
  einkSummary: EinkSummary;
  derivedInsights: DerivedInsights;
  raceContext: RaceContext;
  canonicalOutput: CanonicalSiteOutput;
}

export interface PacerActivity {
  id?: number;
  name: string;
  sport_type?: string;
  type?: string;
  workout_type?: number | null;
  start_date: string;
  start_date_local: string;
  timezone?: string;
  start_latlng?: number[];
  distance: number;
  moving_time: number;
  total_elevation_gain: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_speed: number;
  calories?: number;
  kilojoules?: number;
  // Strava route map — present on full activity objects
  map?: {
    summary_polyline?: string;
  };
}

export interface PacerLap {
  lap_index?: number;
  name?: string;
  distance?: number;
  moving_time?: number;
  average_speed?: number;
  average_heartrate?: number;
}

export interface PacerExport {
  fetched_at: string;
  source: string;
  count: number;
  activities: PacerActivity[];
  latest_activity_laps?: PacerLap[];
  latest_activity_temp_stream?: number[] | null;
}
