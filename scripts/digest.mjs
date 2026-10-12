import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  EXCLUDED_CATEGORIES,
  categoryLabel,
  escapeMarkdownTitle,
  sendToDiscord,
} from "./discord.mjs";

const LATEST_PATH = path.join(process.cwd(), "docs", "data", "latest.json");
const WINDOW_HOURS = 24;
const MAX_ITEMS_PER_CATEGORY = 8;

async function readLatest() {
  try {
    const raw = await readFile(LATEST_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function buildEmbeds(items) {
  const byCategory = new Map();
  for (const item of items) {
    if (!byCategory.has(item.category)) byCategory.set(item.category, []);
    byCategory.get(item.category).push(item);
  }

  const embeds = [];
  for (const [category, categoryItems] of byCategory) {
    const top = categoryItems
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
      .slice(0, MAX_ITEMS_PER_CATEGORY);
    const lines = top.map(
      (item) => `• [${escapeMarkdownTitle(item.title)}](${item.link}) — ${item.source}`
    );
    const extra = categoryItems.length - top.length;
    if (extra > 0) lines.push(`…외 ${extra}건`);

    embeds.push({
      title: `${categoryLabel(category)} (${categoryItems.length}건)`,
      description: lines.join("\n").slice(0, 4000),
      color: 0x5865f2,
    });
  }
  return embeds;
}

async function main() {
  const all = await readLatest();
  const cutoff = Date.now() - WINDOW_HOURS * 60 * 60 * 1000;
  const recent = all.filter(
    (item) =>
      !EXCLUDED_CATEGORIES.has(item.category) &&
      new Date(item.publishedAt).getTime() >= cutoff
  );

  const today = new Date().toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });

  if (recent.length === 0) {
    await sendToDiscord({
      content: `📭 **${today} 뉴스 요약** — 지난 ${WINDOW_HOURS}시간 동안 수집된 새 뉴스가 없습니다.`,
    });
    console.log("No recent items; sent empty-digest notice.");
    return;
  }

  const embeds = buildEmbeds(recent);
  const chunkSize = 10; // Discord max embeds per message
  for (let i = 0; i < embeds.length; i += chunkSize) {
    const chunk = embeds.slice(i, i + chunkSize);
    await sendToDiscord({
      content: i === 0 ? `📰 **${today} 뉴스 요약** (총 ${recent.length}건)` : undefined,
      embeds: chunk,
    });
  }

  console.log(`Sent digest with ${recent.length} items across ${embeds.length} categories.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
