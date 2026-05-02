import path from "node:path";
import { readJsonFile } from "./json.ts";
import { currentDataDir, manualDataDir, mockDataDir } from "./paths.ts";
import {
  buildSessionSlug,
  selectEditorialSessionTitle,
  type PacerCmsLatestSession
} from "./pacer-cms.ts";
import { formatSessionDateLabel, formatSessionTimeLabel } from "./session-display.ts";
import type { SiteCopy } from "./types.ts";

export interface ArchiveSessionCard {
  slug: string;
  sessionId: number;
  sessionDate: string;
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

function toArchiveSessionCard(session: PacerCmsLatestSession): ArchiveSessionCard {
  const dateLabel = formatSessionDateLabel(session.sessionDate);
  const timeLabel = formatSessionTimeLabel(session.startDateLocal);

  return {
    slug: buildSessionSlug(session.sessionDate, session.title, session.manual.sessionType),
    sessionId: session.sessionId,
    sessionDate: session.sessionDate,
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

  const allSessions = [...publishedSessions]
    .sort((a, b) => {
      const dateOrder = b.sessionDate.localeCompare(a.sessionDate);
      if (dateOrder !== 0) {
        return dateOrder;
      }

      return b.sessionId - a.sessionId;
    })
    .map((session) => toArchiveSessionCard(session));
  const pagination = buildPagination(allSessions.length, page, pageSize);
  const start = (pagination.currentPage - 1) * pagination.pageSize;
  const sessions = allSessions.slice(start, start + pagination.pageSize);

  return {
    site,
    count: allSessions.length,
    sessions,
    pagination
  };
}
