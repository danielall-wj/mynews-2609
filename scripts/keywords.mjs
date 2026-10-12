// Title keyword extraction and "rising keyword" scoring, shared by the
// collector (writes docs/data/trends.json) and the weekly Discord report.

// Feeds whose titles are already trend signals (search terms, repo names) —
// counting their words as news keywords would only add noise.
export const NON_NEWS_SOURCE_IDS = new Set(["google-trends", "github-trending"]);
// Weather headlines are near-identical forecasts every day; they swamp the
// counts without saying anything about trends.
const SKIPPED_CATEGORIES = new Set(["날씨"]);

// Trailing Korean particles/endings stripped from 3+ character words, longest
// first so "에서" wins over "서". Crude, but no morphological analyzer needed.
const KO_SUFFIXES = [
  "에서는", "으로는", "에게서", "이라는", "라는", "까지", "부터", "에서", "으로",
  "에게", "처럼", "보다", "한다", "했다", "된다", "됐다", "하는", "하고", "이며",
  "은", "는", "이", "가", "을", "를", "에", "와", "과", "도", "로", "만",
];

const STOPWORDS = new Set([
  // Korean news boilerplate
  "기자", "뉴스", "오늘", "내일", "어제", "발표", "위해", "통해", "대한", "관련",
  "지난", "올해", "내년", "이번", "최대", "최초", "사진", "영상", "단독", "종합",
  "속보", "대표", "국내", "해외", "글로벌", "공개", "출시", "개최", "진행", "추진",
  "확대", "강화", "이상", "이하", "억원", "만원", "조원", "가능", "예정", "전망",
  "기업", "시장", "서비스", "신규", "모집", "공고", "사업", "하나", "모든", "가장",
  "있는", "없는", "있다", "없다", "이후", "현재", "주요", "통한", "따른", "등",
  "하는", "오전", "오후", "참여기업", "지원사업", "예상됩니다", "gn",
  "방법", "이유", "만에", "대신", "먼저", "준비", "비밀", "정체",
  "기여", "대안", "분야", "대응", "고도화", "특화", "공유", "지적", "목표", "관리", "기반", "시급", "이곳", "지역", "평가", "기록", "능력", "과제",
  // English
  "the", "a", "an", "to", "of", "and", "in", "for", "on", "with", "is", "are",
  "be", "how", "new", "your", "from", "at", "by", "as", "that", "this", "it",
  "its", "you", "we", "our", "or", "will", "can", "what", "why", "more", "about",
  "after", "into", "over", "up", "out", "has", "have", "not", "but", "than",
  "now", "who", "all", "just", "get", "gets", "says", "say", "via", "vs", "show",
]);

const HANGUL = /[가-힣]/;

function normalizeToken(raw) {
  let token = raw.toLowerCase();
  if (HANGUL.test(token) && token.length >= 3) {
    for (const suffix of KO_SUFFIXES) {
      if (token.endsWith(suffix) && token.length - suffix.length >= 2) {
        token = token.slice(0, -suffix.length);
        break;
      }
    }
  }
  return token;
}

export function extractKeywords(title) {
  const tokens = title.match(/[\p{L}\p{N}]+(?:[-.][\p{L}\p{N}]+)*/gu) ?? [];
  const keywords = new Set();
  for (const raw of tokens) {
    const token = normalizeToken(raw);
    if (token.length < 2) continue;
    // Bare numbers and dates/amounts like "13일", "10월", "2026년", "10mm"
    if (/^[\d.,-]+\p{L}{0,3}$/u.test(token)) continue;
    if (STOPWORDS.has(token)) continue;
    keywords.add(token);
  }
  return keywords;
}

// Number of items mentioning each keyword (each item counts once per keyword),
// plus which feeds mentioned it.
export function countKeywords(items) {
  const counts = new Map();
  for (const item of items) {
    if (NON_NEWS_SOURCE_IDS.has(item.sourceId)) continue;
    if (SKIPPED_CATEGORIES.has(item.category)) continue;
    // Google News appends " - <publisher>" to every headline
    const title = item.link.includes("news.google.com")
      ? item.title.replace(/ - [^-]+$/, "")
      : item.title;
    for (const kw of extractKeywords(title)) {
      const entry = counts.get(kw) ?? { count: 0, sources: new Set() };
      entry.count += 1;
      entry.sources.add(item.sourceId);
      counts.set(kw, entry);
    }
  }
  return counts;
}

// Keywords mentioned noticeably more in the current window than the baseline
// rate predicts. `expected` scales the baseline count to the window length.
// A keyword must come from 2+ feeds: one outlet's recurring column or one
// press release syndicated across a Google News search isn't a trend.
export function computeRising(
  currentItems,
  baselineItems,
  { windowHours, baselineHours, minCount = 3, limit = 15 }
) {
  const current = countKeywords(currentItems);
  const baseline = countKeywords(baselineItems);
  const scale = windowHours / baselineHours;

  const rising = [];
  for (const [keyword, { count, sources }] of current) {
    if (count < minCount || sources.size < 2) continue;
    const expected = (baseline.get(keyword)?.count ?? 0) * scale;
    const ratio = (count + 1) / (expected + 1);
    if (ratio < 2) continue;
    rising.push({
      keyword,
      count,
      expected: Math.round(expected * 10) / 10,
      isNew: !baseline.has(keyword),
      score: (count - expected) / Math.sqrt(expected + 1),
    });
  }
  return rising.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function topKeywords(items, limit = 10) {
  return [...countKeywords(items).entries()]
    .map(([keyword, { count }]) => ({ keyword, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
