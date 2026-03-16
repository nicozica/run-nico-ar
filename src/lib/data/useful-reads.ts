import type {
  UsefulRead,
  UsefulReadFeedConfig,
  UsefulReadFeedSource
} from "./types.ts";
import { readJsonFile } from "./json.ts";

interface RefreshUsefulReadsOptions {
  limit?: number;
}

const DEFAULT_LIMIT = 5;

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function cleanText(value: string | undefined): string {
  if (!value) {
    return "";
  }

  return decodeHtmlEntities(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeTagName(tagName: string): string {
  return tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractTagContent(block: string, tagNames: string[]): string {
  for (const tagName of tagNames) {
    const pattern = new RegExp(`<${escapeTagName(tagName)}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapeTagName(tagName)}>`, "i");
    const match = pattern.exec(block);

    if (match?.[1]) {
      return cleanText(match[1]);
    }
  }

  return "";
}

function extractRssLink(block: string): string {
  const pattern = /<link(?:\s[^>]*)?>([\s\S]*?)<\/link>/i;
  const match = pattern.exec(block);
  return cleanText(match?.[1]);
}

function extractAtomLink(block: string): string {
  const alternatePattern = /<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']alternate["'][^>]*\/?>/i;
  const simplePattern = /<link\b[^>]*href=["']([^"']+)["'][^>]*\/?>/i;
  const match = alternatePattern.exec(block) ?? simplePattern.exec(block);
  return cleanText(match?.[1]);
}

function toIsoDate(value: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    return undefined;
  }

  return new Date(timestamp).toISOString();
}

function formatPublishedLabel(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  }).format(date);
}

function parseRssItems(xml: string, source: UsefulReadFeedSource): UsefulRead[] {
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];

  return items.map((item) => {
    const published = toIsoDate(extractTagContent(item, ["pubDate", "published", "updated", "dc:date", "date"]));

    return {
      title: extractTagContent(item, ["title"]) || "(untitled)",
      url: extractRssLink(item),
      source: source.name,
      topic: source.topic,
      published,
      publishedLabel: formatPublishedLabel(published)
    };
  }).filter((item) => Boolean(item.url));
}

function parseAtomEntries(xml: string, source: UsefulReadFeedSource): UsefulRead[] {
  const entries = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];

  return entries.map((entry) => {
    const published = toIsoDate(extractTagContent(entry, ["published", "updated", "dc:date", "date"]));

    return {
      title: extractTagContent(entry, ["title"]) || "(untitled)",
      url: extractAtomLink(entry),
      source: source.name,
      topic: source.topic,
      published,
      publishedLabel: formatPublishedLabel(published)
    };
  }).filter((item) => Boolean(item.url));
}

function parseFeed(xml: string, source: UsefulReadFeedSource): UsefulRead[] {
  const rssItems = parseRssItems(xml, source);

  if (rssItems.length > 0) {
    return rssItems;
  }

  return parseAtomEntries(xml, source);
}

function sortByPublishedDesc(items: UsefulRead[]): UsefulRead[] {
  return [...items].sort((left, right) => {
    const leftTime = left.published ? Date.parse(left.published) : 0;
    const rightTime = right.published ? Date.parse(right.published) : 0;
    return rightTime - leftTime;
  });
}

function dedupeByUrl(items: UsefulRead[]): UsefulRead[] {
  const seen = new Set<string>();
  const result: UsefulRead[] = [];

  for (const item of items) {
    if (!item.url || seen.has(item.url)) {
      continue;
    }

    seen.add(item.url);
    result.push(item);
  }

  return result;
}

export function selectUsefulReadsPreview(items: UsefulRead[], limit = DEFAULT_LIMIT): UsefulRead[] {
  if (limit <= 0) {
    return [];
  }

  const candidates = sortByPublishedDesc(dedupeByUrl(items)).slice(0, Math.max(limit * 8, 18));
  const selected: UsefulRead[] = [];
  const seenUrls = new Set<string>();
  const sourceCounts = new Map<string, number>();

  for (const item of candidates) {
    if (selected.length >= limit) {
      return selected;
    }

    if (seenUrls.has(item.url) || (sourceCounts.get(item.source) ?? 0) >= 1) {
      continue;
    }

    selected.push(item);
    seenUrls.add(item.url);
    sourceCounts.set(item.source, (sourceCounts.get(item.source) ?? 0) + 1);
  }

  for (const item of candidates) {
    if (selected.length >= limit) {
      return selected;
    }

    if (seenUrls.has(item.url) || (sourceCounts.get(item.source) ?? 0) >= 2) {
      continue;
    }

    selected.push(item);
    seenUrls.add(item.url);
    sourceCounts.set(item.source, (sourceCounts.get(item.source) ?? 0) + 1);
  }

  return selected;
}

export async function loadUsefulReadSources(filePath: string): Promise<UsefulReadFeedSource[]> {
  const config = await readJsonFile<UsefulReadFeedConfig>(filePath);

  if (!config?.feeds?.length) {
    throw new Error(`Missing useful read sources at ${filePath}`);
  }

  return config.feeds.filter((feed) => Boolean(feed.name?.trim()) && Boolean(feed.url?.trim()));
}

export async function refreshUsefulReads(
  sources: UsefulReadFeedSource[],
  options: RefreshUsefulReadsOptions = {}
): Promise<UsefulRead[]> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const feedResults = await Promise.allSettled(sources.map(async (source) => {
    const response = await fetch(source.url, {
      headers: {
        "user-agent": "run.nico.ar/1.0 (+https://run.nico.ar)"
      },
      signal: AbortSignal.timeout(6500)
    });

    if (!response.ok) {
      throw new Error(`Feed request failed for ${source.name}: ${response.status}`);
    }

    const xml = await response.text();
    return parseFeed(xml, source).slice(0, 12);
  }));
  const feedItems = feedResults.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);

  const merged = feedItems.flat();

  if (merged.length === 0) {
    throw new Error("No useful reads could be fetched from configured feeds.");
  }

  return selectUsefulReadsPreview(merged, limit);
}
