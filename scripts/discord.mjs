// Shared by the daily digest and the weekly trend report.

export const CATEGORY_EMOJI = {
  AI: "🤖",
  경제: "💵",
  창업: "🚀",
  "크리에이터 이코노미": "🎬",
  날씨: "☀️",
  정부지원정책: "🏛️",
  개발: "💻",
  "검색 트렌드": "🔎",
  "GitHub 트렌딩": "⭐",
  "AI 활용": "🛠️",
  "연구 보고서": "📑",
  "해외 연구": "🌐",
};

// Still collected for the dashboard, but left out of Discord messages.
export const EXCLUDED_CATEGORIES = new Set(["날씨"]);

export function categoryLabel(category) {
  return `${CATEGORY_EMOJI[category] ?? "📰"} ${category}`;
}

export function escapeMarkdownTitle(title) {
  return title.replace(/[\[\]]/g, "").slice(0, 140);
}

export const DASHBOARD_URL = "https://mynews-2609.vercel.app";

// Discord limits: 10 embeds and 6000 characters (all titles, descriptions,
// fields, footers and content combined) per message; 4096 per description,
// 1024 per field value. Stay a little under the total for safety.
const MAX_EMBEDS = 10;
const MAX_MESSAGE_CHARS = 5800;

// Join lines up to `limit` characters without cutting a line (and thus a
// markdown link) in half.
export function joinLines(lines, limit) {
  const kept = [];
  let length = 0;
  for (const line of lines) {
    const added = line.length + (kept.length ? 1 : 0);
    if (length + added > limit) break;
    kept.push(line);
    length += added;
  }
  return kept.join("\n");
}

function embedChars(embed) {
  return (
    (embed.title?.length ?? 0) +
    (embed.description?.length ?? 0) +
    (embed.footer?.text?.length ?? 0) +
    (embed.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0)
  );
}

// Split embeds into as many messages as needed; `content` goes on the first.
export function packMessages(content, embeds) {
  const messages = [];
  let current = { content, embeds: [] };
  let chars = content?.length ?? 0;
  for (const embed of embeds) {
    const size = embedChars(embed);
    if (current.embeds.length && (current.embeds.length >= MAX_EMBEDS || chars + size > MAX_MESSAGE_CHARS)) {
      messages.push(current);
      current = { embeds: [] };
      chars = 0;
    }
    current.embeds.push(embed);
    chars += size;
  }
  messages.push(current);
  return messages;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Retries rate limits (honoring retry_after) and transient 5xx errors.
export async function sendToDiscord(payload, attempts = 4) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error("DISCORD_WEBHOOK_URL is not set");
  }
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) return;
    const body = await res.text();
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= attempts) {
      throw new Error(`Discord webhook failed: ${res.status} ${body}`);
    }
    let waitMs = 2000 * attempt;
    try {
      waitMs = Math.max(waitMs, Math.ceil(JSON.parse(body).retry_after * 1000));
    } catch {
      // non-JSON error body — fall back to linear backoff
    }
    console.warn(`Discord ${res.status}, retrying in ${waitMs}ms`);
    await sleep(waitMs);
  }
}

export async function sendMessages(messages) {
  for (const [i, message] of messages.entries()) {
    if (i > 0) await sleep(1000);
    await sendToDiscord(message);
  }
}

// The most recent `hour`:00 KST at or before `now` — digests cover fixed
// windows ending here, so a late-starting run neither drops nor repeats news.
export function lastKstBoundary(now, hour, weekday = null) {
  const KST = 9 * 60 * 60 * 1000;
  const local = new Date(now + KST);
  local.setUTCHours(hour, 0, 0, 0);
  let boundary = local.getTime() - KST;
  if (boundary > now) boundary -= 24 * 60 * 60 * 1000;
  if (weekday !== null) {
    while (new Date(boundary + KST).getUTCDay() !== weekday) boundary -= 24 * 60 * 60 * 1000;
  }
  return boundary;
}
