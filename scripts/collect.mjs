import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import Parser from "rss-parser";
import { FEEDS } from "./feeds.mjs";
import { computeRising } from "./keywords.mjs";
import { tagsFor, trackedTerms } from "./search-keywords.mjs";
import { ARCHIVE_DIR, DATA_DIR, monthKey, readArchiveSince, readJson } from "./archive.mjs";

const LATEST_PATH = path.join(DATA_DIR, "latest.json");
const META_PATH = path.join(DATA_DIR, "meta.json");
const ARCHIVE_INDEX_PATH = path.join(ARCHIVE_DIR, "index.json");
const TRENDS_PATH = path.join(DATA_DIR, "trends.json");

const LATEST_MAX_ITEMS = 800;
const LATEST_MAX_AGE_DAYS = 3;
const TREND_WINDOWS_HOURS = [24, 72];
const TREND_BASELINE_HOURS = 7 * 24;
const RELATED_WINDOW_HOURS = 72;
// Items that count as "about AI" when looking for related keywords
const AI_CATEGORIES = new Set(["AI", "AI 활용"]);

const parser = new Parser({
  timeout: 20000,
  customFields: {
    item: ["ht:approx_traffic", ["ht:news_item", "htNewsItems", { keepArray: true }]],
  },
});

// rss-parser's built-in HTTP client doesn't decompress gzip responses (some
// feeds, e.g. Tubefilter, always gzip regardless of Accept-Encoding). Fetch
// manually — the platform fetch() decompresses transparently — and hand the
// decoded text to parser.parseString() instead of parser.parseURL().
async function fetchFeedText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; mynews-2609/1.0)" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function linkId(link) {
  return createHash("sha1").update(link).digest("hex").slice(0, 16);
}

// "2000+" → 2000, for ranking search terms by volume
function parseTraffic(value) {
  const n = Number(String(value ?? "").replace(/[^\d]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Google Trends items all link to the feed itself; give each search term its
// own stable link (so dedupe works per term) and surface the traffic and the
// headline explaining why it's trending.
function adaptGoogleTrendsItem(item) {
  const term = (item.title ?? "").trim();
  const traffic = item["ht:approx_traffic"];
  const headline = item.htNewsItems?.[0]?.["ht:news_item_title"]?.[0];
  return {
    ...item,
    link: `https://trends.google.com/trends/explore?geo=KR&q=${encodeURIComponent(term)}`,
    contentSnippet: [traffic && `검색량 ${traffic}`, headline].filter(Boolean).join(" · "),
    traffic: parseTraffic(traffic),
  };
}

// Some feeds (e.g. 한국은행) double-escape entities, leaving "&middot;" in titles
const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·" };
function decodeEntities(text) {
  return text.replace(/&(#x?[\da-f]+|[a-z]+);/gi, (match, code) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

async function fetchFeed(feed) {
  const text = await fetchFeedText(feed.url);
  const parsed = await parser.parseString(text);
  const items = (parsed.items ?? [])
    .map((item) => (feed.kind === "google-trends" ? adaptGoogleTrendsItem(item) : item))
    .map((item) => {
      const link = item.link?.trim();
      if (!link) return null;
      const publishedAt =
        item.isoDate ?? (item.pubDate ? new Date(item.pubDate).toISOString() : null);
      return {
        id: linkId(link),
        title: decodeEntities((item.title ?? "").trim()),
        link,
        source: feed.name,
        sourceId: feed.id,
        category: feed.category,
        publishedAt: publishedAt ?? new Date().toISOString(),
        snippet: (item.contentSnippet ?? "").replace(/\s+/g, " ").trim().slice(0, 240),
        ...(item.traffic ? { traffic: item.traffic } : {}),
      };
    })
    .filter(Boolean)
    .filter(
      (item) => !feed.titleMustInclude || feed.titleMustInclude.some((t) => item.title.includes(t))
    );
  return items;
}

// Re-derived on every save so edits to TAGS in search-keywords.mjs also apply
// to items collected before the edit.
function withTags(item) {
  const { tags: _previous, ...rest } = item;
  const tags = tagsFor(rest);
  return tags.length ? { ...rest, tags } : rest;
}

function dedupeByLink(items) {
  const map = new Map();
  for (const item of items) {
    const existing = map.get(item.id);
    if (!existing || new Date(item.publishedAt) > new Date(existing.publishedAt)) {
      map.set(item.id, item);
    }
  }
  return [...map.values()];
}

// Rising keywords per dashboard range: the window vs. the week before it.
async function buildTrends() {
  const now = Date.now();
  const hour = 60 * 60 * 1000;
  const longest = Math.max(...TREND_WINDOWS_HOURS);
  const items = await readArchiveSince(now - (longest + TREND_BASELINE_HOURS) * hour);
  const at = (item) => new Date(item.publishedAt).getTime();

  const windows = {};
  for (const hours of TREND_WINDOWS_HOURS) {
    const start = now - hours * hour;
    const baselineStart = start - TREND_BASELINE_HOURS * hour;
    windows[hours] = computeRising(
      items.filter((i) => at(i) >= start),
      items.filter((i) => at(i) >= baselineStart && at(i) < start),
      { windowHours: hours, baselineHours: TREND_BASELINE_HOURS }
    );
  }

  // Related-keyword candidates: rising words in AI coverage that no search
  // group or tag tracks yet — worth adding to search-keywords.mjs.
  const isAi = (i) => AI_CATEGORIES.has(i.category) || i.tags?.length;
  const tracked = trackedTerms();
  const relatedStart = now - RELATED_WINDOW_HOURS * hour;
  const related = computeRising(
    items.filter((i) => isAi(i) && at(i) >= relatedStart),
    items.filter((i) => isAi(i) && at(i) >= relatedStart - TREND_BASELINE_HOURS * hour && at(i) < relatedStart),
    { windowHours: RELATED_WINDOW_HOURS, baselineHours: TREND_BASELINE_HOURS, limit: 40 }
  )
    .filter(
      (r) =>
        r.keyword !== "ai" &&
        !tracked.has(r.keyword) &&
        ![...tracked].some((t) => t.length >= 3 && r.keyword.includes(t))
    )
    .slice(0, 12);

  return {
    generatedAt: new Date(now).toISOString(),
    baselineHours: TREND_BASELINE_HOURS,
    windows,
    related: { windowHours: RELATED_WINDOW_HOURS, keywords: related },
  };
}

async function main() {
  await mkdir(ARCHIVE_DIR, { recursive: true });

  const results = await Promise.allSettled(FEEDS.map((feed) => fetchFeed(feed)));

  const newItems = [];
  const feedStatus = [];
  results.forEach((result, i) => {
    const feed = FEEDS[i];
    if (result.status === "fulfilled") {
      newItems.push(...result.value);
      feedStatus.push({ id: feed.id, name: feed.name, ok: true, count: result.value.length });
    } else {
      feedStatus.push({
        id: feed.id,
        name: feed.name,
        ok: false,
        error: String(result.reason?.message ?? result.reason),
      });
    }
  });

  // --- latest.json: recent window across all feeds, for the live dashboard ---
  const previousLatest = await readJson(LATEST_PATH, []);
  const mergedLatest = dedupeByLink([...previousLatest, ...newItems]).sort(
    (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)
  );
  const cutoff = Date.now() - LATEST_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const latest = mergedLatest
    .filter((item) => new Date(item.publishedAt).getTime() >= cutoff)
    .slice(0, LATEST_MAX_ITEMS)
    .map(withTags);
  await writeFile(LATEST_PATH, JSON.stringify(latest, null, 2));

  // --- monthly archive: full history, for search ---
  const itemsByMonth = new Map();
  for (const item of newItems) {
    const key = monthKey(item.publishedAt);
    if (!itemsByMonth.has(key)) itemsByMonth.set(key, []);
    itemsByMonth.get(key).push(item);
  }

  const archiveIndex = new Set(await readJson(ARCHIVE_INDEX_PATH, []));
  for (const [key, items] of itemsByMonth) {
    const archivePath = path.join(ARCHIVE_DIR, `${key}.json`);
    const existing = await readJson(archivePath, []);
    const merged = dedupeByLink([...existing, ...items])
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
      .map(withTags);
    await writeFile(archivePath, JSON.stringify(merged, null, 2));
    archiveIndex.add(key);
  }
  await writeFile(
    ARCHIVE_INDEX_PATH,
    JSON.stringify([...archiveIndex].sort().reverse(), null, 2)
  );

  await writeFile(TRENDS_PATH, JSON.stringify(await buildTrends(), null, 2));

  await writeFile(
    META_PATH,
    JSON.stringify(
      {
        lastUpdated: new Date().toISOString(),
        feeds: feedStatus,
        latestCount: latest.length,
      },
      null,
      2
    )
  );

  const failed = feedStatus.filter((f) => !f.ok);
  console.log(`Collected ${newItems.length} items (${latest.length} in latest window).`);
  if (failed.length) {
    console.warn("Feeds that failed:", failed.map((f) => `${f.name}: ${f.error}`).join(" | "));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
