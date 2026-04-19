import path from "node:path";
import { readJsonFile } from "./json.ts";
import { currentDataDir, manualDataDir, mockDataDir } from "./paths.ts";
import {
  buildFallbackNextRun,
  buildSessionSlug,
  selectEditorialSessionTitle,
  toCoachFeedback,
  toLatestSession,
  type PacerCmsLatestSession
} from "./pacer-cms.ts";
import type { CanonicalSiteOutput, CoachFeedback, LatestSession, SiteCopy } from "./types.ts";

export interface PublishedSessionEntry {
  slug: string;
  sessionId: number;
  sessionDate: string;
  title: string;
  latestSession: LatestSession;
  coachFeedback: CoachFeedback;
  aiParagraphs: string[];
  carryForward: string | null;
  nextRunTitle: string | null;
  nextRunSummary: string | null;
}

export interface SessionPageData extends PublishedSessionEntry {
  site: SiteCopy;
}

interface SessionEditorialOverrides {
  coachFeedback?: CoachFeedback;
  aiParagraphs?: string[];
  carryForward?: string | null;
  nextRunTitle?: string | null;
  nextRunSummary?: string | null;
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

function toPublishedSessionEntry(
  snapshot: PacerCmsLatestSession,
  overrides: SessionEditorialOverrides = {}
): PublishedSessionEntry {
  const nextRun = buildFallbackNextRun(snapshot);
  const latestSession = toLatestSession(snapshot);
  const coachFeedback = toCoachFeedback(snapshot, nextRun);
  const aiParagraphs = snapshot.ai.signalParagraphs.filter((paragraph) => paragraph.trim().length > 0);

  return {
    slug: buildSessionSlug(snapshot.sessionDate, snapshot.title, snapshot.manual.sessionType),
    sessionId: snapshot.sessionId,
    sessionDate: snapshot.sessionDate,
    title: selectEditorialSessionTitle(snapshot.title, snapshot.manual.sessionType),
    latestSession,
    coachFeedback: overrides.coachFeedback ?? coachFeedback,
    aiParagraphs: overrides.aiParagraphs && overrides.aiParagraphs.length > 0 ? overrides.aiParagraphs : aiParagraphs,
    carryForward: overrides.carryForward ?? (snapshot.ai.carryForward || null),
    nextRunTitle: overrides.nextRunTitle ?? (snapshot.ai.nextRunTitle || nextRun?.title || null),
    nextRunSummary: overrides.nextRunSummary ?? (snapshot.ai.nextRunSummary || nextRun?.summary || null)
  };
}

export async function loadPublishedSessionEntries(): Promise<PublishedSessionEntry[]> {
  const [snapshots, canonicalOutput, currentCoachFeedback] = await Promise.all([
    loadGeneratedOrMock<PacerCmsLatestSession[]>("published-sessions.json"),
    loadGeneratedOrMock<CanonicalSiteOutput>("site-output.json").catch(() => null),
    loadGeneratedOrMock<CoachFeedback>("coach-feedback.json").catch(() => null)
  ]);

  const sortedSnapshots = snapshots
    .slice()
    .sort((a, b) => {
      const dateOrder = b.sessionDate.localeCompare(a.sessionDate);
      if (dateOrder !== 0) {
        return dateOrder;
      }

      return b.sessionId - a.sessionId;
    });

  return sortedSnapshots.map((snapshot, index) => {
    if (index !== 0 || !canonicalOutput) {
      return toPublishedSessionEntry(snapshot);
    }

    return toPublishedSessionEntry(snapshot, {
      coachFeedback: currentCoachFeedback ?? undefined,
      aiParagraphs: canonicalOutput.signalParagraphs.filter((paragraph) => paragraph.trim().length > 0),
      carryForward: canonicalOutput.carryForward || null,
      nextRunTitle: canonicalOutput.nextRunTitle || null,
      nextRunSummary: canonicalOutput.nextRunSummary || null
    });
  });
}

export async function loadSessionPageData(slug: string): Promise<SessionPageData | null> {
  const [site, sessions] = await Promise.all([
    loadRequiredManualFile<SiteCopy>("site-copy.json"),
    loadPublishedSessionEntries()
  ]);

  const session = sessions.find((entry) => entry.slug === slug);

  if (!session) {
    return null;
  }

  return {
    site,
    ...session
  };
}
