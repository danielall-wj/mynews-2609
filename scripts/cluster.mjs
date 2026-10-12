// Groups near-duplicate stories — mostly one press release syndicated across
// many outlets in Google News searches — so readers see it once.

const WINDOW_MS = 48 * 60 * 60 * 1000;
const MIN_OVERLAP = 0.6;

function bigrams(title) {
  const text = title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const grams = new Set();
  for (let i = 0; i < text.length - 1; i++) grams.add(text.slice(i, i + 2));
  return grams;
}

// Share of the shorter title's bigrams found in the longer one, so a short
// rewrite of a long headline still counts as the same story.
function overlap(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const g of small) if (large.has(g)) shared++;
  return shared / small.size;
}

// Returns items with duplicates marked: the earliest item of each group keeps
// `dupCount`/`dupSources`, the rest get `dupOf` pointing at it.
export function markDuplicates(items) {
  const sorted = [...items]
    .map(({ dupOf: _a, dupCount: _b, dupSources: _c, ...rest }) => rest)
    .sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt));
  const leaders = [];
  const result = new Map();

  for (const item of sorted) {
    const grams = bigrams(item.title);
    const at = new Date(item.publishedAt).getTime();
    const leader = leaders.find(
      (l) =>
        l.item.category === item.category &&
        at - l.at <= WINDOW_MS &&
        overlap(l.grams, grams) >= MIN_OVERLAP
    );
    if (leader) {
      const lead = result.get(leader.item.id);
      lead.dupCount = (lead.dupCount ?? 0) + 1;
      const name = item.publisher ?? item.source;
      lead.dupSources = [...new Set([...(lead.dupSources ?? []), name])].slice(0, 5);
      result.set(item.id, { ...item, dupOf: leader.item.id });
    } else {
      leaders.push({ item, grams, at });
      result.set(item.id, { ...item });
    }
  }
  return items.map((i) => result.get(i.id));
}
