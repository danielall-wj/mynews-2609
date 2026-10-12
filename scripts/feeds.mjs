import { SEARCH_GROUPS, searchGroupUrl } from "./search-keywords.mjs";

// Optional per-feed fields: `timezone` for zone-less pubDates, `exclude`
// (regexes tested against title + publisher + snippet), `titleMustInclude`.
export const FEEDS = [
  {
    id: "aitimes",
    name: "AI타임스",
    url: "https://www.aitimes.com/rss/allArticle.xml",
    category: "AI",
    // pubDate comes as "2026-10-12 18:00:00" in KST with no zone
    timezone: "+09:00",
    // Auto-generated local event clips ("AI 생성 영상"), not AI news
    exclude: [/AI 생성 영상/],
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
    // Vietnamese weather forecasts machine-translated into Korean
    exclude: [/vietnam\.vn/i],
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
  // --- Research reports ---
  {
    id: "bok-issue-notes",
    name: "한국은행 이슈노트",
    url: "https://www.bok.or.kr/portal/bbs/P0002353/news.rss?menuNo=200433",
    category: "연구 보고서",
  },
  {
    id: "bok-research",
    name: "한국은행 경제연구",
    url: "https://www.bok.or.kr/portal/bbs/P0002454/news.rss?menuNo=200434",
    category: "연구 보고서",
  },
  // NBER's feed is omitted on purpose: its items carry no dates, so every run
  // would re-stamp them as new and they'd top the daily digest forever.
  {
    id: "bis-research",
    name: "BIS 연구",
    url: "https://www.bis.org/doclist/reshub_papers.rss",
    category: "해외 연구",
  },
  {
    id: "ecb-blog",
    name: "ECB 블로그",
    url: "https://www.ecb.europa.eu/rss/blog.html",
    category: "해외 연구",
  },
  {
    id: "ny-fed-liberty-street",
    name: "뉴욕연준 Liberty Street",
    url: "https://libertystreeteconomics.newyorkfed.org/feed/",
    category: "해외 연구",
  },
  {
    id: "voxeu",
    name: "VoxEU (CEPR)",
    url: "https://cepr.org/rss/vox-content",
    category: "해외 연구",
  },
  {
    id: "bruegel",
    name: "Bruegel",
    url: "https://www.bruegel.org/rss.xml",
    category: "해외 연구",
  },
  // Keyword searches, one Google News feed per group in search-keywords.mjs
  ...SEARCH_GROUPS.map((group) => ({
    id: group.id,
    name: group.name,
    url: searchGroupUrl(group),
    category: group.category,
    titleMustInclude: group.titleMustInclude,
  })),
];
