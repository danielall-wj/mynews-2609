// Keyword-driven collection and tagging. Edit this file to change what gets
// searched and tagged — feeds.mjs and the dashboard pick it up automatically.

// Each group becomes one Google News search feed. Phrases are OR-combined and
// quoted so "AI 에이전트" matches as a phrase rather than two loose words.
export const SEARCH_GROUPS = [
  {
    id: "ai-agents",
    name: "AI 검색: 에이전트",
    category: "AI 활용",
    phrases: ["AI 에이전트", "에이전틱 AI", "AI 비서"],
  },
  {
    id: "ai-automation",
    name: "AI 검색: 업무 자동화",
    category: "AI 활용",
    phrases: ["AI 업무 자동화", "업무 자동화 AI", "AI 워크플로", "RPA AI"],
  },
  {
    id: "ai-adoption",
    name: "AI 검색: 도입·활용 사례",
    category: "AI 활용",
    phrases: ["생성형 AI 도입", "AI 활용 사례", "AI 전환", "AX 전환"],
  },
  // Institutes without their own RSS (KDI, 자본시장연구원 etc.): coverage of
  // their reports. Google News matches body text too, so keep only headlines
  // that actually name an institute.
  {
    id: "kr-institute-reports",
    name: "국내 연구소 보고서 뉴스",
    category: "연구 보고서",
    phrases: ["KDI", "자본시장연구원", "한국금융연구원", "현대경제연구원", "대외경제정책연구원", "LG경영연구원"],
    suffix: "보고서",
    titleMustInclude: ["KDI", "연구원"],
  },
];

// Tags attached to every collected item (any feed) whose title or snippet
// contains one of the terms. Matching is case-insensitive substring.
export const TAGS = {
  "AI 에이전트": ["에이전트", "에이전틱", "agent", "agentic"],
  "업무 자동화": ["자동화", "automation", "워크플로", "workflow", "rpa"],
  "생성형 AI": ["생성형", "generative", "llm", "챗gpt", "chatgpt", "클로드", "claude", "제미나이", "gemini"],
  MCP: ["mcp", "model context protocol"],
  "AI 코딩": ["코딩 에이전트", "바이브 코딩", "vibe coding", "copilot", "cursor", "claude code", "codex"],
};

// Google News caps a search at 100 results sorted by relevance; `when:7d`
// keeps them recent instead of surfacing year-old evergreen articles.
export function searchGroupUrl(group) {
  const phrases = group.phrases.map((p) => `"${p}"`).join(" OR ");
  const query = `(${phrases})${group.suffix ? ` ${group.suffix}` : ""} when:7d`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`;
}

export function tagsFor(item) {
  const text = `${item.title} ${item.snippet ?? ""}`.toLowerCase();
  return Object.entries(TAGS)
    .filter(([, terms]) => terms.some((term) => text.includes(term)))
    .map(([tag]) => tag);
}

// Every search phrase and tag term, lowercased — used to skip keywords we
// already track when suggesting new related keywords.
export function trackedTerms() {
  const terms = new Set();
  for (const group of SEARCH_GROUPS) {
    for (const phrase of group.phrases) {
      for (const word of phrase.toLowerCase().split(/\s+/)) terms.add(word);
    }
  }
  for (const list of Object.values(TAGS)) for (const term of list) terms.add(term.toLowerCase());
  return terms;
}
