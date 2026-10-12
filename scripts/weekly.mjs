import path from "node:path";
import { DATA_DIR, readArchiveSince, readJson } from "./archive.mjs";
import {
  EXCLUDED_CATEGORIES,
  categoryLabel,
  escapeMarkdownTitle,
  sendToDiscord,
} from "./discord.mjs";
import { computeRising, topKeywords } from "./keywords.mjs";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const SIGNAL_CATEGORIES = new Set(["검색 트렌드", "GitHub 트렌딩"]);

function countByCategory(items) {
  const counts = new Map();
  for (const item of items) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  return counts;
}

function fmtDelta(current, previous) {
  if (previous === 0) return current > 0 ? "신규" : "–";
  const pct = Math.round(((current - previous) / previous) * 100);
  return pct === 0 ? "±0%" : `${pct > 0 ? "▲" : "▼"}${Math.abs(pct)}%`;
}

function categoryEmbed(thisWeek, lastWeek) {
  const now = countByCategory(thisWeek);
  const before = countByCategory(lastWeek);
  const lines = [...now.entries()]
    .filter(([category]) => !SIGNAL_CATEGORIES.has(category))
    .sort((a, b) => b[1] - a[1])
    .map(
      ([category, n]) =>
        `${categoryLabel(category)} **${n}건** (${fmtDelta(n, before.get(category) ?? 0)})`
    );
  return {
    title: `📊 카테고리별 기사 수 (총 ${thisWeek.length}건, 지난주 ${lastWeek.length}건)`,
    description: lines.join("\n") || "수집된 기사가 없습니다.",
    color: 0x5865f2,
  };
}

function keywordEmbed(thisWeek, lastWeek, related) {
  const rising = computeRising(thisWeek, lastWeek, {
    windowHours: 168,
    baselineHours: 168,
    minCount: 4,
    limit: 10,
  });
  const top = topKeywords(thisWeek, 10);
  const risingText = rising.length
    ? rising
        .map((r) => `\`${r.keyword}\` ${r.count}회 (${r.isNew ? "신규" : `지난주 ${r.expected}회`})`)
        .join(" · ")
    : "지난주보다 눈에 띄게 늘어난 키워드가 없습니다.";
  const topText = top.map((t) => `\`${t.keyword}\` ${t.count}`).join(" · ");
  const relatedText = related.length
    ? `\n\n**🧩 AI 연관 키워드 (검색어 후보)**\n${related.map((r) => `\`${r.keyword}\``).join(" · ")}`
    : "";
  return {
    title: "📈 이번 주 키워드",
    description: `**급상승**\n${risingText}\n\n**많이 언급된 키워드**\n${topText}${relatedText}`.slice(0, 4000),
    color: 0xf0b232,
  };
}

function signalEmbed(thisWeek) {
  const searches = thisWeek
    .filter((i) => i.sourceId === "google-trends")
    .sort((a, b) => (b.traffic ?? 0) - (a.traffic ?? 0))
    .slice(0, 10);
  const repos = thisWeek.filter((i) => i.sourceId === "github-trending").slice(0, 10);
  if (searches.length === 0 && repos.length === 0) return null;

  const fields = [];
  if (searches.length) {
    fields.push({
      name: "🔎 구글 인기 검색어",
      value: searches
        .map((i) => `[${escapeMarkdownTitle(i.title)}](${i.link})${i.traffic ? ` ${i.traffic.toLocaleString()}+` : ""}`)
        .join("\n")
        .slice(0, 1024),
      inline: true,
    });
  }
  if (repos.length) {
    fields.push({
      name: "⭐ GitHub 트렌딩",
      value: repos
        .map((i) => `[${escapeMarkdownTitle(i.title)}](${i.link})`)
        .join("\n")
        .slice(0, 1024),
      inline: true,
    });
  }
  return { title: "🧭 이번 주 트렌드 시그널", fields, color: 0x57f287 };
}

async function main() {
  const now = Date.now();
  const all = (await readArchiveSince(now - 2 * WEEK_MS)).filter(
    (item) => !EXCLUDED_CATEGORIES.has(item.category)
  );
  const at = (item) => new Date(item.publishedAt).getTime();
  const thisWeek = all.filter((i) => at(i) >= now - WEEK_MS && at(i) <= now);
  const lastWeek = all.filter((i) => at(i) < now - WEEK_MS);

  const trends = await readJson(path.join(DATA_DIR, "trends.json"), null);
  const fmt = (ms) =>
    new Date(ms).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" });
  const embeds = [
    categoryEmbed(thisWeek, lastWeek),
    keywordEmbed(thisWeek, lastWeek, trends?.related?.keywords ?? []),
    signalEmbed(thisWeek),
  ].filter(Boolean);

  await sendToDiscord({
    content: `🗓️ **주간 트렌드 리포트** (${fmt(now - WEEK_MS)} ~ ${fmt(now)})`,
    embeds,
  });
  console.log(`Sent weekly report: ${thisWeek.length} items this week, ${lastWeek.length} last week.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
