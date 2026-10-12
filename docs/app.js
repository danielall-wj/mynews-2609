const CATEGORY_EMOJI = {
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

const THEME_KEY = "mynews:theme";

const BOOKMARK_KEY = "mynews:bookmarks";

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function fmtTime(iso) {
  try {
    return new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  } catch {
    return iso;
  }
}

function uniqueCategories(items) {
  return [...new Set(items.map((i) => i.category))].sort();
}

function populateSelect(select, values, allLabel) {
  select.innerHTML = "";
  const allOpt = document.createElement("option");
  allOpt.value = "";
  allOpt.textContent = allLabel;
  select.appendChild(allOpt);
  for (const v of values) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    select.appendChild(opt);
  }
}

function loadBookmarks() {
  try {
    return JSON.parse(localStorage.getItem(BOOKMARK_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveBookmarks(list) {
  try {
    localStorage.setItem(BOOKMARK_KEY, JSON.stringify(list));
  } catch {
    // localStorage unavailable (private mode, etc.) — bookmarking silently no-ops
  }
}

function isBookmarked(id, bookmarks) {
  return bookmarks.some((b) => b.id === id);
}

function toggleBookmark(item) {
  const bookmarks = loadBookmarks();
  const idx = bookmarks.findIndex((b) => b.id === item.id);
  if (idx >= 0) {
    bookmarks.splice(idx, 1);
  } else {
    bookmarks.unshift(item);
  }
  saveBookmarks(bookmarks);
  return bookmarks;
}

function cardHtml(item, bookmarks) {
  const marked = isBookmarked(item.id, bookmarks);
  return `
    <div class="card">
      <button class="bookmark-btn${marked ? " active" : ""}" data-id="${item.id}" aria-label="즐겨찾기 토글">${marked ? "★" : "☆"}</button>
      <div class="card-body">
        <a href="${item.link}" target="_blank" rel="noopener">${item.title}</a>
        <div class="meta">${item.source} · ${fmtTime(item.publishedAt)}</div>
        ${item.snippet ? `<div class="snippet">${item.snippet}</div>` : ""}
        ${
          item.tags?.length
            ? `<div class="tags">${item.tags.map((t) => `<span class="tag">#${escapeHtml(t)}</span>`).join("")}</div>`
            : ""
        }
      </div>
    </div>
  `;
}

function renderGrouped(container, items) {
  container._itemsById = new Map(items.map((i) => [i.id, i]));
  if (!container._bookmarkBound) {
    container.addEventListener("click", (e) => {
      const btn = e.target.closest(".bookmark-btn");
      if (!btn) return;
      const item = container._itemsById.get(btn.dataset.id);
      if (!item) return;
      const bookmarks = toggleBookmark(item);
      const marked = isBookmarked(item.id, bookmarks);
      btn.classList.toggle("active", marked);
      btn.textContent = marked ? "★" : "☆";
    });
    container._bookmarkBound = true;
  }

  if (items.length === 0) {
    container.innerHTML = '<p class="empty">표시할 뉴스가 없습니다.</p>';
    return;
  }

  const bookmarks = loadBookmarks();
  const byCategory = new Map();
  for (const item of items) {
    if (!byCategory.has(item.category)) byCategory.set(item.category, []);
    byCategory.get(item.category).push(item);
  }

  container.innerHTML = "";
  for (const [category, catItems] of byCategory) {
    const section = document.createElement("div");
    section.className = "category-group";
    const heading = document.createElement("h2");
    heading.textContent = `${CATEGORY_EMOJI[category] ?? "📰"} ${category} (${catItems.length})`;
    section.appendChild(heading);
    section.insertAdjacentHTML(
      "beforeend",
      catItems.map((item) => cardHtml(item, bookmarks)).join("")
    );
    container.appendChild(section);
  }
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return [];
  return res.json();
}

function initExplore(items) {
  const searchInput = document.getElementById("explore-search");
  const categorySelect = document.getElementById("explore-category");
  populateSelect(categorySelect, uniqueCategories(items), "전체 카테고리");
  const tagSelect = document.getElementById("explore-tag");
  populateSelect(tagSelect, [...new Set(items.flatMap((i) => i.tags ?? []))].sort(), "전체 태그");

  const container = document.getElementById("explore-content");

  function apply() {
    const q = searchInput.value.trim().toLowerCase();
    const cat = categorySelect.value;
    const tag = tagSelect.value;
    const filtered = items.filter((item) => {
      const matchesQ = !q || item.title.toLowerCase().includes(q);
      const matchesCat = !cat || item.category === cat;
      const matchesTag = !tag || item.tags?.includes(tag);
      return matchesQ && matchesCat && matchesTag;
    });
    renderGrouped(container, filtered);
  }

  searchInput.addEventListener("input", apply);
  categorySelect.addEventListener("change", apply);
  tagSelect.addEventListener("change", apply);
  apply();
}

function initCategory(items) {
  const subtabsNav = document.getElementById("category-subtabs");
  const searchInput = document.getElementById("category-search");
  const container = document.getElementById("category-content");
  let activeCat = "";

  subtabsNav.innerHTML = "";
  const allBtn = document.createElement("button");
  allBtn.textContent = "전체";
  allBtn.dataset.cat = "";
  allBtn.className = "active";
  subtabsNav.appendChild(allBtn);
  for (const c of uniqueCategories(items)) {
    const btn = document.createElement("button");
    btn.textContent = `${CATEGORY_EMOJI[c] ?? "📰"} ${c}`;
    btn.dataset.cat = c;
    subtabsNav.appendChild(btn);
  }

  function apply() {
    const q = searchInput.value.trim().toLowerCase();
    const filtered = items.filter((item) => {
      const matchesQ = !q || item.title.toLowerCase().includes(q);
      const matchesCat = !activeCat || item.category === activeCat;
      return matchesQ && matchesCat;
    });
    renderGrouped(container, filtered);
  }

  subtabsNav.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      subtabsNav.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activeCat = btn.dataset.cat;
      apply();
    });
  });

  searchInput.addEventListener("input", apply);
  apply();
}

function computeTrend(items, hours) {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const recent = items.filter((i) => new Date(i.publishedAt).getTime() >= cutoff);

  const byCategory = new Map();
  const bySource = new Map();
  for (const i of recent) {
    byCategory.set(i.category, (byCategory.get(i.category) ?? 0) + 1);
    bySource.set(i.source, (bySource.get(i.source) ?? 0) + 1);
  }
  return {
    total: recent.length,
    byCategory: [...byCategory.entries()].sort((a, b) => b[1] - a[1]),
    bySource: [...bySource.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
  };
}

function trendBarHtml(label, count, max) {
  const width = max > 0 ? Math.round((count / max) * 100) : 0;
  return `
    <div class="trend-row">
      <div class="trend-label">${label}</div>
      <div class="trend-bar"><div class="trend-bar-fill" style="width:${width}%"></div></div>
      <div class="trend-count">${count}</div>
    </div>
  `;
}

function risingHtml(rising, baselineHours) {
  if (!rising?.length) {
    return '<p class="empty">평소보다 눈에 띄게 늘어난 키워드가 없습니다.</p>';
  }
  const chips = rising
    .map((r) => {
      const hint = r.isNew
        ? "신규"
        : `평소 ${r.expected}회 → ×${((r.count + 1) / (r.expected + 1)).toFixed(1)}`;
      return `
        <span class="keyword-chip" title="${escapeHtml(`평소 기대치 ${r.expected}회`)}">
          ${escapeHtml(r.keyword)} <b>${r.count}</b>
          <small${r.isNew ? ' class="new"' : ""}>${escapeHtml(hint)}</small>
        </span>`;
    })
    .join("");
  return `
    <div class="keyword-chips">${chips}</div>
    <p class="trend-note">기사 제목 키워드 언급 수를 직전 ${baselineHours / 24}일 평균과 비교했습니다.</p>
  `;
}

function signalListHtml(items, extra) {
  if (items.length === 0) return '<p class="empty">해당 기간에 수집된 항목이 없습니다.</p>';
  return `
    <ol class="signal-list">
      ${items
        .map(
          (i) => `
        <li>
          <a href="${escapeHtml(i.link)}" target="_blank" rel="noopener">${escapeHtml(i.title)}</a>
          ${extra(i) ? `<span class="signal-extra">${escapeHtml(extra(i))}</span>` : ""}
        </li>`
        )
        .join("")}
    </ol>
  `;
}

function renderTrend(container, items, hours, trends) {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const inRange = (sourceId) =>
    items.filter((i) => i.sourceId === sourceId && new Date(i.publishedAt).getTime() >= cutoff);
  const searches = inRange("google-trends").sort((a, b) => (b.traffic ?? 0) - (a.traffic ?? 0));
  const repos = inRange("github-trending");

  const signalsHtml = `
    <h2>📈 급상승 키워드</h2>
    ${risingHtml(trends?.windows?.[hours], trends?.baselineHours ?? 168)}
    <h2>🧩 AI 연관 키워드 <small class="trend-note-inline">검색어 후보</small></h2>
    ${
      trends?.related?.keywords?.length
        ? `<div class="keyword-chips">${trends.related.keywords
            .map(
              (r) =>
                `<span class="keyword-chip">${escapeHtml(r.keyword)} <b>${r.count}</b>${r.isNew ? ' <small class="new">신규</small>' : ""}</span>`
            )
            .join("")}</div>
          <p class="trend-note">최근 ${trends.related.windowHours / 24}일 AI 기사에서 급상승했지만 아직 검색어·태그에 없는 키워드입니다. 수집하려면 <code>scripts/search-keywords.mjs</code>에 추가하세요.</p>`
        : '<p class="empty">새로 떠오른 연관 키워드가 없습니다.</p>'
    }
    <div class="signal-grid">
      <div>
        <h2>🔎 구글 인기 검색어</h2>
        ${signalListHtml(searches.slice(0, 15), (i) => (i.traffic ? `${i.traffic.toLocaleString()}+` : ""))}
      </div>
      <div>
        <h2>⭐ GitHub 트렌딩</h2>
        ${signalListHtml(repos.slice(0, 15), (i) => i.snippet?.slice(0, 80) ?? "")}
      </div>
    </div>
  `;

  const { total, byCategory, bySource } = computeTrend(items, hours);
  if (total === 0) {
    container.innerHTML = signalsHtml + '<p class="empty">해당 기간에 수집된 뉴스가 없습니다.</p>';
    return;
  }
  const maxCat = Math.max(...byCategory.map(([, n]) => n));
  const maxSrc = Math.max(...bySource.map(([, n]) => n));
  container.innerHTML = `
    ${signalsHtml}
    <p class="trend-summary">해당 기간 총 ${total}건 수집됨</p>
    <h2>카테고리별 발행량</h2>
    <div class="trend-list">
      ${byCategory.map(([c, n]) => trendBarHtml(`${CATEGORY_EMOJI[c] ?? "📰"} ${c}`, n, maxCat)).join("")}
    </div>
    <h2>소스별 발행량 TOP ${bySource.length}</h2>
    <div class="trend-list">
      ${bySource.map(([s, n]) => trendBarHtml(s, n, maxSrc)).join("")}
    </div>
  `;
}

function initTrend(items, trends) {
  const subtabsNav = document.getElementById("trend-subtabs");
  const container = document.getElementById("trend-content");

  subtabsNav.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      subtabsNav.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderTrend(container, items, Number(btn.dataset.range), trends);
    });
  });

  renderTrend(container, items, 24, trends);
}

async function initHistory() {
  const months = await fetchJson("data/archive/index.json");
  const monthSelect = document.getElementById("history-month");
  monthSelect.innerHTML = "";
  for (const m of months) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    monthSelect.appendChild(opt);
  }

  const searchInput = document.getElementById("history-search");
  const categorySelect = document.getElementById("history-category");
  const container = document.getElementById("history-content");

  let currentItems = [];

  async function loadMonth() {
    const month = monthSelect.value;
    if (!month) {
      currentItems = [];
      populateSelect(categorySelect, [], "전체 카테고리");
      renderGrouped(container, []);
      return;
    }
    currentItems = await fetchJson(`data/archive/${month}.json`);
    currentItems.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    populateSelect(categorySelect, uniqueCategories(currentItems), "전체 카테고리");
    apply();
  }

  function apply() {
    const q = searchInput.value.trim().toLowerCase();
    const cat = categorySelect.value;
    const filtered = currentItems.filter((item) => {
      const matchesQ =
        !q ||
        item.title.toLowerCase().includes(q) ||
        (item.snippet ?? "").toLowerCase().includes(q);
      const matchesCat = !cat || item.category === cat;
      return matchesQ && matchesCat;
    });
    renderGrouped(container, filtered);
  }

  monthSelect.addEventListener("change", loadMonth);
  searchInput.addEventListener("input", apply);
  categorySelect.addEventListener("change", apply);

  if (months.length > 0) {
    monthSelect.value = months[0];
    await loadMonth();
  } else {
    renderGrouped(container, []);
  }
}

function initBookmark() {
  const container = document.getElementById("bookmark-content");

  function refresh() {
    const bookmarks = loadBookmarks();
    if (bookmarks.length === 0) {
      container.innerHTML = '<p class="empty">즐겨찾기한 뉴스가 없습니다. 기사 카드의 ☆를 눌러 추가하세요.</p>';
      return;
    }
    renderGrouped(container, bookmarks);
  }

  refresh();
  return refresh;
}

async function initStatus() {
  const meta = await fetchJson("data/meta.json");
  const container = document.getElementById("status-content");

  if (!meta.feeds || meta.feeds.length === 0) {
    container.innerHTML = '<p class="empty">수집 데이터가 없습니다.</p>';
    return;
  }

  const rows = meta.feeds
    .map(
      (f) => `
        <tr class="${f.ok ? "ok" : "fail"}">
          <td>${f.name}</td>
          <td>${f.ok ? "✅ 정상" : "⚠️ 실패"}</td>
          <td>${f.ok ? `${f.count}건` : f.error}</td>
        </tr>
      `
    )
    .join("");

  container.innerHTML = `
    <p class="trend-summary">마지막 수집: ${fmtTime(meta.lastUpdated)} · 최근 창(latest) ${meta.latestCount ?? 0}건</p>
    <table class="status-table">
      <thead><tr><th>피드</th><th>상태</th><th>비고</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function initTabs(onShow) {
  const buttons = document.querySelectorAll("nav.tabs button");
  const sections = {
    explore: document.getElementById("tab-explore"),
    category: document.getElementById("tab-category"),
    trend: document.getElementById("tab-trend"),
    history: document.getElementById("tab-history"),
    bookmark: document.getElementById("tab-bookmark"),
    status: document.getElementById("tab-status"),
  };
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      for (const [key, el] of Object.entries(sections)) {
        el.hidden = key !== btn.dataset.tab;
      }
      onShow?.(btn.dataset.tab);
    });
  });
}

function initTheme() {
  const button = document.getElementById("theme-toggle");
  const render = () => {
    const dark = document.documentElement.dataset.theme === "dark";
    button.textContent = dark ? "☀️ 라이트" : "🌙 다크";
  };
  button.addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme !== "dark";
    if (dark) document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
    } catch {
      // localStorage unavailable — the toggle still works for this visit
    }
    render();
  });
  render();
}

async function main() {
  initTheme();
  const meta = await fetchJson("data/meta.json");
  document.getElementById("last-updated").textContent = meta.lastUpdated
    ? `마지막 수집: ${fmtTime(meta.lastUpdated)} (${meta.latestCount ?? 0}건)`
    : "아직 수집된 데이터가 없습니다.";

  const items = await fetchJson("data/latest.json");
  items.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  initExplore(items);
  initCategory(items);
  const trends = await fetch("data/trends.json", { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
  initTrend(items, trends);
  initHistory();
  const refreshBookmark = initBookmark();
  initStatus();

  initTabs((tab) => {
    if (tab === "bookmark") refreshBookmark();
  });
}

main();
