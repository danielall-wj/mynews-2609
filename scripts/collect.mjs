import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import Parser from "rss-parser";
import { FEEDS } from "./feeds.mjs";
import { computeRising } from "./keywords.mjs";
import { tagsFor, trackedTerms } from "./search-keywords.mjs";
import { ARCHIVE_DIR, DATA_DIR, monthKey, readArchiveSince, readJson } from "./archive.mjs";
import { markDuplicates } from "./cluster.mjs";

const LATEST_PATH = path.join(DATA_DIR, "latest.json");
const META_PATH = path.join(DATA_DIR, "meta.json");
const ARCHIVE_INDEX_PATH = path.join(ARCHIVE_DIR, "index.json");
const TRENDS_PATH = path.join(DATA_DIR, "trends.json");

const LATEST_MAX_ITEMS = 1500;
const LATEST_MAX_AGE_DAYS = 3;
// Busy feeds (한국경제 alone posts ~100 a day) would otherwise fill the window
// and push quieter feeds' 2–3 day old stories out before LATEST_MAX_AGE_DAYS.
const LATEST_MAX_PER_FEED = 200;
// Older items from a feed are ignored. Some feeds (OpenAI) return their whole
// back catalogue on every run, which used to create archive files back to 2015.
const MAX_ITEM_AGE_DAYS = 30;
// Monthly archive files kept, current month included; older ones are deleted.
const ARCHIVE_RETENTION_MONTHS = 12;
// A pubDate this far past fetch time is a timezone bug, not a real date.
const FUTURE_TOLERANCE_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
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

// Feeds like AI타임스 send "2026-10-12 18:00:00" with no zone; JS would read
// it as UTC. `feed.timezone` ("+09:00") says what zone such dates are in.
// A date in the future is treated as missing: clamping it to "now" re-stamped
// the item on every run and pinned it to the top until the date came true.
function parsePublished(item, feed, fetchedAt) {
  let ms = null;
  const raw = item.pubDate?.trim();
  if (feed.timezone && raw && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(raw)) {
    ms = Date.parse(`${raw.replace(" ", "T")}${feed.timezone}`);
  } else if (item.isoDate || raw) {
    ms = Date.parse(item.isoDate ?? raw);
  }
  if (!Number.isFinite(ms) || ms > fetchedAt + FUTURE_TOLERANCE_MS) return null;
  return ms;
}

const FEEDS_BY_ID = new Map(FEEDS.map((feed) => [feed.id, feed]));

// Per-feed `exclude` patterns; also applied to stored items so a newly added
// pattern clears matching items out of latest.json and the archive right away.
function isExcluded(item) {
  const patterns = FEEDS_BY_ID.get(item.sourceId)?.exclude;
  if (!patterns) return false;
  const text = [item.title, item.publisher, item.snippet].filter(Boolean).join(" ");
  return patterns.some((pattern) => pattern.test(text));
}

// Google News headlines end in " - <publisher>"; split it off so titles read
// cleanly and duplicate detection compares the headline alone.
function splitPublisher(title, link) {
  if (!link.includes("news.google.com")) return { title };
  const match = title.match(/^(.*\S) - ([^-]+)$/);
  return match ? { title: match[1], publisher: match[2].trim() } : { title };
}

async function fetchFeed(feed, fetchedAt) {
  const text = await fetchFeedText(feed.url);
  const parsed = await parser.parseString(text);
  const oldest = fetchedAt - MAX_ITEM_AGE_DAYS * DAY_MS;
  let newestMs = null;
  const items = (parsed.items ?? [])
    .map((item) => (feed.kind === "google-trends" ? adaptGoogleTrendsItem(item) : item))
    .map((item) => {
      const link = item.link?.trim();
      // Only http(s): a "javascript:" link would run script when clicked
      if (!link || !/^https?:\/\//i.test(link)) return null;
      // Undated items are left out here; main() adds their first-seen dates
      const published = parsePublished(item, feed, fetchedAt);
      if (published !== null) newestMs = Math.max(newestMs ?? 0, published);
      if (published !== null && published < oldest) return null;
      const { title, publisher } = splitPublisher(decodeEntities((item.title ?? "").trim()), link);
      let snippet = (item.contentSnippet ?? "").replace(/\s+/g, " ").trim();
      // Google News "snippets" just repeat the headline and publisher
      if (snippet.startsWith(title)) snippet = "";
      return {
        id: linkId(link),
        title,
        link,
        source: feed.name,
        sourceId: feed.id,
        category: feed.category,
        // Undated items get their first-seen time in resolveUndated
        publishedAt: published === null ? null : new Date(published).toISOString(),
        snippet: snippet.slice(0, 240),
        ...(publisher ? { publisher } : {}),
        ...(item.traffic ? { traffic: item.traffic } : {}),
      };
    })
    .filter(Boolean)
    .filter(
      (item) => !feed.titleMustInclude || feed.titleMustInclude.some((t) => item.title.includes(t))
    )
    .filter((item) => !isExcluded(item));
  // Newest date the feed offered, even if older than MAX_ITEM_AGE_DAYS —
  // shown on the status tab to tell a quiet feed from a dead one
  items.newestAt = newestMs === null ? null : new Date(newestMs).toISOString();
  return items;
}

// Re-derived on every save so edits to TAGS in search-keywords.mjs also apply
// to items collected before the edit.
function withTags(item) {
  const { tags: _previous, ...rest } = item;
  const tags = tagsFor(rest);
  return tags.length ? { ...rest, tags } : rest;
}

// Freshly fetched items replace stored copies, so fixes like corrected dates
// take effect. Undated items already carry their first-seen date by now.
function mergeItems(existing, incoming) {
  const map = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) map.set(item.id, item);
  return [...map.values()];
}

const byNewest = (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt);
const earlier = (a, b) => (!a || (b && Date.parse(b) < Date.parse(a)) ? b : a);

async function readWholeArchive(archiveIndex) {
  const items = [];
  for (const key of archiveIndex) {
    items.push(...(await readJson(path.join(ARCHIVE_DIR, `${key}.json`), [])));
  }
  return items;
}

// Re-files every archived item by monthKey; months left empty are written as
// empty files so nothing stale remains in them.
async function rewriteArchive(archiveIndex, items) {
  const byMonth = new Map([...archiveIndex].map((key) => [key, []]));
  for (const item of items) {
    const key = monthKey(item.publishedAt);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(item);
  }
  for (const [key, monthItems] of byMonth) {
    await writeJson(path.join(ARCHIVE_DIR, `${key}.json`), monthItems.sort(byNewest));
    archiveIndex.add(key);
  }
}

// Undated items (GitHub Trending, or a pubDate in the future) are dated by when
// they were first seen. Looking only in latest.json wasn't enough: once an item
// aged out of the window it came back as brand new if the feed still listed it.
// The archive keeps every item for ARCHIVE_RETENTION_MONTHS, so it's read too.
async function resolveUndated(items, previousLatest, archiveIndex, fetchedAt) {
  const undated = items.filter((item) => item.publishedAt === null);
  if (!undated.length) return;
  const firstSeen = new Map(previousLatest.map((item) => [item.id, item.publishedAt]));
  if (undated.some((item) => !firstSeen.has(item.id))) {
    for (const item of await readWholeArchive(archiveIndex)) {
      firstSeen.set(item.id, earlier(firstSeen.get(item.id), item.publishedAt));
    }
  }
  const now = new Date(fetchedAt).toISOString();
  for (const item of undated) item.publishedAt = firstSeen.get(item.id) ?? now;
}

// Exclude patterns as text, stored in meta.json to notice when they change
const EXCLUDE_SIGNATURE = JSON.stringify(
  FEEDS.filter((feed) => feed.exclude).map((feed) => [feed.id, feed.exclude.map(String)])
);

// One-off data fixes, recorded in meta.json so each runs exactly once.
const MIGRATIONS = {
  // AI타임스 dates were read as UTC while actually KST: shift stored copies
  // back 9h and re-file any that cross a month boundary.
  "aitimes-kst": async ({ latest, archiveIndex }) => {
    const shift = (item) =>
      item.sourceId === "aitimes"
        ? { ...item, publishedAt: new Date(Date.parse(item.publishedAt) - 9 * 60 * 60 * 1000).toISOString() }
        : item;
    await rewriteArchive(archiveIndex, (await readWholeArchive(archiveIndex)).map(shift));
    return latest.map(shift);
  },
  // Months are now split in KST, and undated GitHub Trending items may have
  // been re-stamped into a later month: keep one copy at its earliest date
  // (in latest.json too) and re-file everything.
  "kst-months-first-seen": async ({ latest, archiveIndex }) => {
    const archived = await readWholeArchive(archiveIndex);
    const isTrending = (item) => item.sourceId === "github-trending";
    const firstSeen = new Map();
    for (const item of [...latest, ...archived].filter(isTrending)) {
      firstSeen.set(item.id, earlier(firstSeen.get(item.id), item.publishedAt));
    }
    const withFirstSeen = (item) => (isTrending(item) ? { ...item, publishedAt: firstSeen.get(item.id) } : item);
    const kept = new Set();
    const deduped = archived.filter((item) => !isTrending(item) || (!kept.has(item.id) && kept.add(item.id)));
    await rewriteArchive(archiveIndex, deduped.map(withFirstSeen));
    return latest.map(withFirstSeen);
  },
};

// Compact JSON: indentation was over a third of every data file's size, and
// these files are re-committed every run.
function writeJson(filePath, data) {
  return writeFile(filePath, JSON.stringify(data));
}

// Deletes archive months older than the retention window and drops them from
// the index. Scans the directory too, so files missing from the index go as well.
async function pruneArchive(archiveIndex, now) {
  const [year, month] = monthKey(new Date(now).toISOString()).split("-").map(Number);
  const oldestKept = new Date(Date.UTC(year, month - 1 - (ARCHIVE_RETENTION_MONTHS - 1), 1))
    .toISOString()
    .slice(0, 7);
  const files = (await readdir(ARCHIVE_DIR)).filter((name) => /^\d{4}-\d{2}\.json$/.test(name));
  const keys = new Set([...archiveIndex, ...files.map((name) => name.slice(0, 7))]);
  const removed = [];
  for (const key of keys) {
    if (key >= oldestKept) continue;
    if (files.includes(`${key}.json`)) await unlink(path.join(ARCHIVE_DIR, `${key}.json`));
    archiveIndex.delete(key);
    removed.push(key);
  }
  if (removed.length) console.log(`Pruned ${removed.length} archive months older than ${oldestKept}.`);
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
  const fetchedAt = Date.now();
  const previousMeta = await readJson(META_PATH, {});
  const previousFeeds = new Map((previousMeta.feeds ?? []).map((f) => [f.id, f]));

  const results = await Promise.allSettled(FEEDS.map((feed) => fetchFeed(feed, fetchedAt)));

  const newItems = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));

  let previousLatest = await readJson(LATEST_PATH, []);
  const archiveIndex = new Set(await readJson(ARCHIVE_INDEX_PATH, []));
  const migrations = new Set(previousMeta.migrations ?? []);
  for (const [name, migrate] of Object.entries(MIGRATIONS)) {
    if (migrations.has(name)) continue;
    previousLatest = await migrate({ latest: previousLatest, archiveIndex });
    migrations.add(name);
    console.log(`Applied migration: ${name}`);
  }

  await resolveUndated(newItems, previousLatest, archiveIndex, fetchedAt);

  const feedStatus = [];
  results.forEach((result, i) => {
    const feed = FEEDS[i];
    const previous = previousFeeds.get(feed.id);
    if (result.status === "fulfilled") {
      // First-seen dates count here, so an undated feed whose mirror stalls
      // shows as stale instead of "updated just now" on every run
      const dates = result.value.map((item) => item.publishedAt);
      const newestAt = [result.value.newestAt, ...dates].reduce(
        (newest, d) => (d && (!newest || Date.parse(d) > Date.parse(newest)) ? d : newest),
        null
      );
      feedStatus.push({
        id: feed.id,
        name: feed.name,
        ok: true,
        count: result.value.length,
        recent24h: dates.filter((d) => Date.parse(d) >= fetchedAt - DAY_MS).length,
        newestAt: newestAt ?? previous?.newestAt ?? null,
        consecutiveFailures: 0,
      });
    } else {
      feedStatus.push({
        id: feed.id,
        name: feed.name,
        ok: false,
        error: String(result.reason?.message ?? result.reason),
        newestAt: previous?.newestAt ?? null,
        consecutiveFailures: (previous?.consecutiveFailures ?? 0) + 1,
      });
    }
  });

  // --- latest.json: recent window across all feeds, for the live dashboard ---
  const cutoff = fetchedAt - LATEST_MAX_AGE_DAYS * DAY_MS;
  const perFeed = new Map();
  const underFeedCap = (item) => {
    const count = (perFeed.get(item.sourceId) ?? 0) + 1;
    perFeed.set(item.sourceId, count);
    return count <= LATEST_MAX_PER_FEED;
  };
  const latest = markDuplicates(
    mergeItems(previousLatest, newItems)
      .filter((item) => new Date(item.publishedAt).getTime() >= cutoff && !isExcluded(item))
      .sort(byNewest)
      .filter(underFeedCap)
      .slice(0, LATEST_MAX_ITEMS)
      .map(withTags)
  );
  await writeJson(LATEST_PATH, latest);

  // --- monthly archive: full history, for search ---
  // A changed exclude list is applied to every month, not just this run's
  if (previousMeta.excludeSignature !== EXCLUDE_SIGNATURE) {
    const archived = await readWholeArchive(archiveIndex);
    const kept = archived.filter((item) => !isExcluded(item));
    if (kept.length < archived.length) {
      await rewriteArchive(archiveIndex, kept);
      console.log(`Removed ${archived.length - kept.length} archived items matching exclude patterns.`);
    }
  }

  const itemsByMonth = new Map();
  for (const item of newItems) {
    const key = monthKey(item.publishedAt);
    if (!itemsByMonth.has(key)) itemsByMonth.set(key, []);
    itemsByMonth.get(key).push(item);
  }

  for (const [key, items] of itemsByMonth) {
    const archivePath = path.join(ARCHIVE_DIR, `${key}.json`);
    const existing = await readJson(archivePath, []);
    const merged = mergeItems(existing, items)
      .filter((item) => !isExcluded(item))
      .sort(byNewest)
      .map(withTags);
    await writeJson(archivePath, merged);
    archiveIndex.add(key);
  }
  await pruneArchive(archiveIndex, fetchedAt);
  await writeJson(ARCHIVE_INDEX_PATH, [...archiveIndex].sort().reverse());

  await writeJson(TRENDS_PATH, await buildTrends());

  await writeFile(
    META_PATH,
    JSON.stringify(
      {
        lastUpdated: new Date(fetchedAt).toISOString(),
        feeds: feedStatus,
        latestCount: latest.length,
        migrations: [...migrations],
        excludeSignature: EXCLUDE_SIGNATURE,
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
