import { readFile } from "node:fs/promises";
import path from "node:path";

export const DATA_DIR = path.join(process.cwd(), "docs", "data");
export const ARCHIVE_DIR = path.join(DATA_DIR, "archive");

export async function readJson(filePath, fallback) {
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// YYYY-MM in Korean time, so a story from 08:00 KST on the 1st files under
// the new month rather than the previous one (UTC is still the 31st then).
export function monthKey(dateIso) {
  return new Date(Date.parse(dateIso) + KST_OFFSET_MS).toISOString().slice(0, 7);
}

// Archived items published at or after fromMs, across every month file the
// range touches.
export async function readArchiveSince(fromMs) {
  const months = new Set([monthKey(new Date().toISOString())]);
  for (let t = fromMs; t <= Date.now(); t += 24 * 60 * 60 * 1000) {
    months.add(monthKey(new Date(t).toISOString()));
  }
  const items = [];
  for (const key of months) {
    items.push(...(await readJson(path.join(ARCHIVE_DIR, `${key}.json`), [])));
  }
  return items.filter((item) => new Date(item.publishedAt).getTime() >= fromMs);
}
