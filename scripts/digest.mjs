import path from "node:path";
import { DATA_DIR, readJson } from "./archive.mjs";
import {
  DASHBOARD_URL,
  EXCLUDED_CATEGORIES,
  categoryLabel,
  escapeMarkdownTitle,
  joinLines,
  lastKstBoundary,
  packMessages,
  sendMessages,
} from "./discord.mjs";
import { FEEDS } from "./feeds.mjs";

const LATEST_PATH = path.join(DATA_DIR, "latest.json");
const META_PATH = path.join(DATA_DIR, "meta.json");
const DIGEST_HOUR_KST = 9;
const MAX_ITEMS_PER_CATEGORY = 5;
// 2-hourly collection: 6 failures in a row ≈ half a day without that feed
const FAILURE_ALERT_THRESHOLD = 6;

// Categories in feeds.mjs order, so the digest layout is the same every day
const CATEGORY_ORDER = [...new Set(FEEDS.map((f) => f.category))];

// Stories carried by many outlets first, then the newest
function rank(a, b) {
  return (b.dupCount ?? 0) - (a.dupCount ?? 0) || new Date(b.publishedAt) - new Date(a.publishedAt);
}

function itemLine(item) {
  const by = item.publisher ? `${item.source} · ${item.publisher}` : item.source;
  const more = item.dupCount ? ` (외 ${item.dupCount}곳)` : "";
  return `• [${escapeMarkdownTitle(item.title)}](${item.link}) — ${by}${more}`;
}

function buildEmbeds(stories) {
  const byCategory = new Map();
  for (const item of stories) {
    if (!byCategory.has(item.category)) byCategory.set(item.category, []);
    byCategory.get(item.category).push(item);
  }
  const categories = [...byCategory.keys()].sort(
    (a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b)
  );

  return categories.map((category) => {
    const items = byCategory.get(category).sort(rank);
    const lines = items.slice(0, MAX_ITEMS_PER_CATEGORY).map(itemLine);
    const extra = items.length - lines.length;
    if (extra > 0) lines.push(`…외 ${extra}건 — [대시보드에서 보기](${DASHBOARD_URL})`);
    return {
      title: `${categoryLabel(category)} (${items.length}건)`,
      description: joinLines(lines, 4000),
      color: 0x5865f2,
    };
  });
}

function failureNotice(meta) {
  const failing = (meta.feeds ?? []).filter((f) => (f.consecutiveFailures ?? 0) >= FAILURE_ALERT_THRESHOLD);
  if (!failing.length) return "";
  return `\n⚠️ 수집 실패가 계속되는 피드: ${failing
    .map((f) => `${f.name}(${f.consecutiveFailures}회)`)
    .join(", ")}`;
}

async function main() {
  const now = Date.now();
  const windowEnd = lastKstBoundary(now, DIGEST_HOUR_KST);
  const windowStart = windowEnd - 24 * 60 * 60 * 1000;

  const all = await readJson(LATEST_PATH, []);
  const meta = await readJson(META_PATH, {});
  const inWindow = all.filter((item) => {
    const at = new Date(item.publishedAt).getTime();
    return !EXCLUDED_CATEGORIES.has(item.category) && at >= windowStart && at < windowEnd;
  });
  // Duplicates are folded into their lead story's "외 N곳"
  const stories = inWindow.filter((item) => !item.dupOf);

  const today = new Date(windowEnd).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });
  const notice = failureNotice(meta);

  if (stories.length === 0) {
    await sendMessages([
      { content: `📭 **${today} 뉴스 요약** — 지난 24시간 동안 수집된 새 뉴스가 없습니다.${notice}` },
    ]);
    console.log("No items in window; sent empty-digest notice.");
    return;
  }

  const content = `📰 **${today} 뉴스 요약** (기사 ${stories.length}건 · [대시보드](${DASHBOARD_URL}))${notice}`;
  const messages = packMessages(content, buildEmbeds(stories));
  await sendMessages(messages);

  console.log(
    `Sent digest: ${stories.length} stories (${inWindow.length} items) in ${messages.length} message(s).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
