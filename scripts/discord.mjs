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
};

// Still collected for the dashboard, but left out of Discord messages.
export const EXCLUDED_CATEGORIES = new Set(["날씨"]);

export function categoryLabel(category) {
  return `${CATEGORY_EMOJI[category] ?? "📰"} ${category}`;
}

export function escapeMarkdownTitle(title) {
  return title.replace(/[\[\]]/g, "").slice(0, 140);
}

export async function sendToDiscord(payload) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error("DISCORD_WEBHOOK_URL is not set");
  }
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Discord webhook failed: ${res.status} ${await res.text()}`);
  }
}
