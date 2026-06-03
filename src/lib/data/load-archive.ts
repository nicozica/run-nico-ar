import path from "node:path";
import { readJsonFile } from "./json.ts";
import { currentDataDir, manualDataDir, mockDataDir } from "./paths.ts";
import {
  buildUniqueSessionSlugMap,
  selectEditorialSessionTitle,
  type PacerCmsLatestSession
} from "./pacer-cms.ts";
import { formatSessionDateLabel, formatSessionTimeLabel } from "./session-display.ts";
import type { ActivityLogExport, ActivityLogItem, SiteCopy } from "./types.ts";

export interface ArchiveSessionCard {
  kind: "session";
  slug: string;
  sessionId: number;
  sourceActivityId: number;
  sessionDate: string;
  startDateLocal: string | null;
  dateLabel: string;
  dateTimeLabel: string;
  title: string;
  sport: string;
  sessionType: string | null;
  distanceKm: number | null;
  durationLabel: string;
  paceLabel: string | null;
  signalTitle: string | null;
  nextRunTitle: string | null;
  routeSvgPoints: string | null;
}

export type ActivityLogFilter = "runs" | "all" | "gym" | "rides" | "other";

export interface ArchiveRawActivityCard {
  kind: "raw";
  id: number | null;
  title: string;
  type: string;
  sportType: string | null;
  category: Exclude<ActivityLogFilter, "all">;
  date: string;
  startDate: string;
  startDateLocal: string | null;
  dateTimeLabel: string;
  distanceKm: number | null;
  durationLabel: string;
  elapsedDurationLabel: string | null;
  paceLabel: string | null;
  averageHeartRate: number | null;
  maxHeartRate: number | null;
  calories: number | null;
  elevationGainM: number | null;
  averageSpeedKmh: number | null;
  routeSvgPoints: string | null;
}

export type ArchiveActivityCard = ArchiveSessionCard | ArchiveRawActivityCard;

export interface ArchivePagination {
  currentPage: number;
  pageSize: number;
  totalPages: number;
  totalSessions: number;
  previousPath: string | null;
  nextPath: string | null;
  pages: Array<{
    page: number;
    path: string;
    isCurrent: boolean;
  }>;
}

export interface ArchivePageData {
  site: SiteCopy;
  count: number;
  sessions: ArchiveSessionCard[];
  activityLog: {
    generatedAt: string | null;
    all: ArchiveActivityCard[];
    gym: ArchiveRawActivityCard[];
    rides: ArchiveRawActivityCard[];
    other: ArchiveRawActivityCard[];
  };
  pagination: ArchivePagination;
}

const DEFAULT_PAGE_SIZE = 10;

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

function normalizeActivityType(activity: Pick<ActivityLogItem, "sportType" | "type">): string {
  return activity.sportType || activity.type || "Activity";
}

function classifyActivity(activity: Pick<ActivityLogItem, "sportType" | "type">): Exclude<ActivityLogFilter, "all"> {
  const type = normalizeActivityType(activity);
  const runTypes = new Set(["Run", "TrailRun", "VirtualRun"]);
  const rideTypes = new Set(["Ride", "VirtualRide", "GravelRide", "MountainBikeRide", "EBikeRide"]);
  const gymTypes = new Set([
    "WeightTraining",
    "Workout",
    "Crossfit",
    "Elliptical",
    "StairStepper",
    "Yoga",
    "Pilates",
    "HIIT",
    "StrengthTraining"
  ]);

  if (runTypes.has(type)) {
    return "runs";
  }

  if (rideTypes.has(type)) {
    return "rides";
  }

  if (gymTypes.has(type)) {
    return "gym";
  }

  return "other";
}

function toComparableDate(value: string | null | undefined): string {
  return value || "";
}

function normalizeSourceActivityId(value: number | string | null | undefined): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }

  const normalized = String(value ?? "").trim();

  if (!normalized) {
    return null;
  }

  return normalized.replace(/^i/i, "") || null;
}

function getRawActivitySourceIds(activity: ActivityLogItem): Set<string> {
  return new Set([
    normalizeSourceActivityId(activity.id),
    normalizeSourceActivityId(activity.sourceActivityId),
    normalizeSourceActivityId(activity.originalActivityId)
  ].filter((value): value is string => value !== null));
}

function getActivityLocalDate(activity: Pick<ActivityLogItem, "date" | "startDate" | "startDateLocal">): string {
  return (activity.date || activity.startDateLocal || activity.startDate || "").slice(0, 10);
}

function parseLocalTimestamp(value: string | null | undefined): number | null {
  const normalized = (value ?? "").trim();

  if (!normalized) {
    return null;
  }

  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function areNumbersClose(
  left: number | null | undefined,
  right: number | null | undefined,
  absoluteTolerance: number,
  relativeTolerance: number
): boolean {
  if (typeof left !== "number" || typeof right !== "number") {
    return false;
  }

  const tolerance = Math.max(absoluteTolerance, Math.abs(left) * relativeTolerance);
  return Math.abs(left - right) <= tolerance;
}

function areActivitySportsCompatible(sessionSport: string, activity: Pick<ActivityLogItem, "sportType" | "type">): boolean {
  return classifyActivity({ sportType: sessionSport, type: sessionSport }) === classifyActivity(activity);
}

function isRawActivityInterpreted(
  activity: ActivityLogItem,
  publishedSessions: PacerCmsLatestSession[]
): boolean {
  const rawSourceIds = getRawActivitySourceIds(activity);

  for (const session of publishedSessions) {
    const sessionSourceId = normalizeSourceActivityId(session.sourceActivityId);

    if (sessionSourceId && rawSourceIds.has(sessionSourceId)) {
      return true;
    }

    if (getActivityLocalDate(activity) !== session.sessionDate) {
      continue;
    }

    if (!areActivitySportsCompatible(session.sport, activity)) {
      continue;
    }

    const activityStart = parseLocalTimestamp(activity.startDateLocal || activity.startDate);
    const sessionStart = parseLocalTimestamp(session.startDateLocal);
    const closeStart = typeof activityStart === "number"
      && typeof sessionStart === "number"
      && Math.abs(activityStart - sessionStart) <= 180 * 1000;
    const closeDistance = areNumbersClose(session.distanceM, activity.distanceM, 200, 0.03);
    const closeDuration = areNumbersClose(session.movingTimeS, activity.movingTimeS, 180, 0.05)
      || areNumbersClose(session.elapsedTimeS, activity.elapsedTimeS, 180, 0.05);

    // Use a strong fingerprint when provider IDs changed across migrations.
    if ((closeStart && (closeDistance || closeDuration)) || (closeDistance && closeDuration)) {
      return true;
    }
  }

  return false;
}

function toRawActivityCard(activity: ActivityLogItem): ArchiveRawActivityCard {
  const startDateLocal = activity.startDateLocal || activity.startDate;
  const date = startDateLocal.slice(0, 10);
  const dateLabel = formatSessionDateLabel(date);
  const timeLabel = formatSessionTimeLabel(startDateLocal);

  return {
    kind: "raw",
    id: activity.id,
    title: activity.title,
    type: activity.type,
    sportType: activity.sportType,
    category: classifyActivity(activity),
    date: activity.date || date,
    startDate: activity.startDate,
    startDateLocal,
    dateTimeLabel: timeLabel ? `${dateLabel} · ${timeLabel}` : dateLabel,
    distanceKm: typeof activity.distanceM === "number" && activity.distanceM > 0
      ? roundOneDecimal(activity.distanceM / 1000)
      : null,
    durationLabel: formatDuration(activity.movingTimeS),
    elapsedDurationLabel: activity.elapsedTimeS && activity.elapsedTimeS !== activity.movingTimeS
      ? formatDuration(activity.elapsedTimeS)
      : null,
    paceLabel: formatPaceLabel(activity.paceSecPerKm),
    averageHeartRate: typeof activity.averageHeartrate === "number" ? Math.round(activity.averageHeartrate) : null,
    maxHeartRate: typeof activity.maxHeartrate === "number" ? Math.round(activity.maxHeartrate) : null,
    calories: typeof activity.calories === "number" ? Math.round(activity.calories) : null,
    elevationGainM: typeof activity.elevationGainM === "number" && activity.elevationGainM > 0
      ? Math.round(activity.elevationGainM)
      : null,
    averageSpeedKmh: typeof activity.averageSpeedMps === "number" && activity.averageSpeedMps > 0
      ? roundOneDecimal(activity.averageSpeedMps * 3.6)
      : null,
    routeSvgPoints: activity.routeSvgPoints ?? null
  };
}

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

function toArchiveSessionCard(session: PacerCmsLatestSession, slug: string): ArchiveSessionCard {
  const dateLabel = formatSessionDateLabel(session.sessionDate);
  const timeLabel = formatSessionTimeLabel(session.startDateLocal);

  return {
    kind: "session",
    slug,
    sessionId: session.sessionId,
    sourceActivityId: session.sourceActivityId,
    sessionDate: session.sessionDate,
    startDateLocal: session.startDateLocal,
    dateLabel,
    dateTimeLabel: timeLabel ? `${dateLabel} · ${timeLabel}` : dateLabel,
    title: selectEditorialSessionTitle(session.title, session.manual.sessionType),
    sport: session.sport,
    sessionType: session.manual.sessionType || null,
    distanceKm: typeof session.distanceM === "number" && session.distanceM > 0
      ? roundOneDecimal(session.distanceM / 1000)
      : null,
    durationLabel: formatDuration(session.movingTimeS),
    paceLabel: formatPaceLabel(session.paceSecPerKm),
    signalTitle: session.ai.signalTitle || null,
    nextRunTitle: session.ai.nextRunTitle || null,
    routeSvgPoints: session.routeSvgPoints ?? null
  };
}

function buildActivityLog(
  publishedSessionSnapshots: PacerCmsLatestSession[],
  publishedSessions: ArchiveSessionCard[],
  rawActivities: ActivityLogItem[],
): ArchivePageData["activityLog"] {
  const rawCards = rawActivities
    .filter((activity) => !isRawActivityInterpreted(activity, publishedSessionSnapshots))
    .map((activity) => toRawActivityCard(activity));
  const all = [...publishedSessions, ...rawCards].sort((a, b) => {
    const left = a.kind === "session" ? a.startDateLocal || a.sessionDate : a.startDateLocal || a.startDate;
    const right = b.kind === "session" ? b.startDateLocal || b.sessionDate : b.startDateLocal || b.startDate;
    return toComparableDate(right).localeCompare(toComparableDate(left));
  });

  return {
    generatedAt: null,
    all,
    gym: rawCards.filter((activity) => activity.category === "gym"),
    rides: rawCards.filter((activity) => activity.category === "rides"),
    other: rawCards.filter((activity) => activity.category === "other")
  };
}

function buildPagePath(page: number): string {
  return page <= 1 ? "/runs/" : `/runs/${page}/`;
}

function buildPagination(totalSessions: number, currentPage: number, pageSize: number): ArchivePagination {
  const totalPages = Math.max(1, Math.ceil(totalSessions / pageSize));
  const normalizedPage = Math.min(Math.max(1, currentPage), totalPages);

  return {
    currentPage: normalizedPage,
    pageSize,
    totalPages,
    totalSessions,
    previousPath: normalizedPage > 1 ? buildPagePath(normalizedPage - 1) : null,
    nextPath: normalizedPage < totalPages ? buildPagePath(normalizedPage + 1) : null,
    pages: Array.from({ length: totalPages }, (_, index) => {
      const page = index + 1;

      return {
        page,
        path: buildPagePath(page),
        isCurrent: page === normalizedPage
      };
    })
  };
}

export async function loadArchivePageData(page = 1, pageSize = DEFAULT_PAGE_SIZE): Promise<ArchivePageData> {
  const [site, publishedSessions] = await Promise.all([
    loadRequiredManualFile<SiteCopy>("site-copy.json"),
    loadGeneratedOrMock<PacerCmsLatestSession[]>("published-sessions.json")
  ]);
  const activityLogExport = await loadGeneratedOrMock<ActivityLogExport>("activity-log.json")
    .catch(() => ({ generatedAt: null, count: 0, activities: [] }));

  const slugMap = buildUniqueSessionSlugMap(publishedSessions);
  const allSessions = [...publishedSessions]
    .map((session) => ({
      session,
      slug: slugMap.get(session.sessionId)
        ?? `${session.sessionDate}-session-${session.sessionId}`
    }))
    .sort((a, b) => {
      const dateOrder = b.session.sessionDate.localeCompare(a.session.sessionDate);
      if (dateOrder !== 0) {
        return dateOrder;
      }

      return b.session.sessionId - a.session.sessionId;
    })
    .map(({ session, slug }) => toArchiveSessionCard(session, slug));
  const pagination = buildPagination(allSessions.length, page, pageSize);
  const start = (pagination.currentPage - 1) * pagination.pageSize;
  const sessions = allSessions.slice(start, start + pagination.pageSize);
  const activityLog = buildActivityLog(publishedSessions, allSessions, activityLogExport.activities);

  return {
    site,
    count: allSessions.length,
    sessions,
    activityLog: {
      ...activityLog,
      generatedAt: activityLogExport.generatedAt
    },
    pagination
  };
}
