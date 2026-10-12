import { SEARCH_GROUPS, searchGroupUrl } from "./search-keywords.mjs";

export const FEEDS = [
  {
    id: "aitimes",
    name: "AI타임스",
    url: "https://www.aitimes.com/rss/allArticle.xml",
    category: "AI",
  },
  {
    id: "openai",
    name: "OpenAI",
    url: "https://openai.com/news/rss.xml",
    category: "AI",
  },
  {
    id: "mit-tech-review-ai",
    name: "MIT Technology Review AI",
    url: "https://www.technologyreview.com/topic/artificial-intelligence/feed/",
    category: "AI",
  },
  {
    id: "mk-economy",
    name: "매일경제 경제",
    url: "https://www.mk.co.kr/rss/30100041/",
    category: "경제",
  },
  {
    id: "hankyung-economy",
    name: "한국경제",
    url: "https://www.hankyung.com/feed/economy",
    category: "경제",
  },
  {
    id: "fed-press",
    name: "미 연준 보도자료",
    url: "https://www.federalreserve.gov/feeds/press_all.xml",
    category: "경제",
  },
  {
    id: "platum",
    name: "플래텀",
    url: "https://platum.kr/feed",
    category: "창업",
  },
  {
    id: "tubefilter",
    name: "Tubefilter",
    url: "https://www.tubefilter.com/feed/",
    category: "크리에이터 이코노미",
  },
  {
    id: "youtube-blog",
    name: "YouTube 공식 블로그",
    url: "https://blog.youtube/rss/",
    category: "크리에이터 이코노미",
  },
  // 기상청 날씨누리 RSS는 2025-03-31부로 공식 중단(대체: 회원가입이 필요한
  // 기상청 API허브). 대신 날씨 관련 뉴스 헤드라인을 모아주는 구글뉴스 검색
  // RSS로 대체.
  {
    id: "weather-news",
    name: "날씨 뉴스",
    url: `https://news.google.com/rss/search?q=${encodeURIComponent(
      "날씨 기상특보 OR 예보"
    )}&hl=ko&gl=KR&ceid=KR:ko`,
    category: "날씨",
  },
  {
    id: "gov-support",
    name: "정부지원정책",
    url: `https://news.google.com/rss/search?q=${encodeURIComponent(
      '"지원사업" 공고 OR 모집'
    )}&hl=ko&gl=KR&ceid=KR:ko`,
    category: "정부지원정책",
  },
  {
    id: "geeknews",
    name: "긱뉴스(GeekNews)",
    url: "https://news.hada.io/rss/news",
    category: "개발",
  },
  // Daily trending searches in Korea. Every item's <link> is the same feed
  // URL, so collect.mjs rewrites it per search term (kind: "google-trends").
  {
    id: "google-trends",
    name: "구글 트렌드 인기 검색어",
    url: "https://trends.google.com/trending/rss?geo=KR",
    category: "검색 트렌드",
    kind: "google-trends",
  },
  // GitHub has no official trending feed; this community mirror regenerates
  // the daily trending page as RSS.
  {
    id: "github-trending",
    name: "GitHub Trending",
    url: "https://mshibanami.github.io/GitHubTrendingRSS/daily/all.xml",
    category: "GitHub 트렌딩",
  },
  // Keyword searches, one Google News feed per group in search-keywords.mjs
  ...SEARCH_GROUPS.map((group) => ({
    id: group.id,
    name: group.name,
    url: searchGroupUrl(group),
    category: group.category,
  })),
];
