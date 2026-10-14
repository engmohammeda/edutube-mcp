// Edutube feature: playlist import. Accepts a playlist URL (or bare playlist
// id, or a single video URL, or a local CSV playlist file) and resolves the
// ordered video entries. Uses the YouTube Data API when YOUTUBE_API_KEY is
// configured, otherwise falls back to yt-dlp --flat-playlist so the feature
// works without any extra key. CSV files let operators hand-curated playlists
// (url/title/lesson_no columns) without any network resolution at all.
import process from "node:process";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import { METADATA_TIMEOUT_MS } from "../lib/constants.js";

const execFileAsync = promisify(execFile);

export type PlaylistEntry = {
  index: number;
  videoId: string;
  title: string | null;
  lessonNo?: number | null;
};

export type PlaylistSource = "youtube_api" | "yt_dlp" | "single_video" | "csv_file";

export type PlaylistInfo = {
  playlistId: string | null;
  source: PlaylistSource;
  entries: PlaylistEntry[];
};

const PLAYLIST_ID_PREFIXES = ["PL", "UU", "FL", "OL", "RD", "LL", "HL"];

export function parsePlaylistId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^[\w-]{6,}$/.test(trimmed) && PLAYLIST_ID_PREFIXES.some((p) => trimmed.startsWith(p))) {
    return trimmed;
  }
  try {
    const url = new URL(trimmed);
    const list = url.searchParams.get("list");
    if (list) return list;
  } catch {
    // not a URL
  }
  return null;
}

export function isPlaylistUrl(input: string): boolean {
  const trimmed = input.trim();
  if (parsePlaylistId(trimmed) && !isLikelyVideoUrl(trimmed)) return true;
  try {
    const url = new URL(trimmed);
    if (url.searchParams.get("list")) return true;
    return /\/playlist/.test(url.pathname);
  } catch {
    return false;
  }
}

function isLikelyVideoUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.searchParams.has("v") || /\/(watch|shorts|live)\//.test(url.pathname);
  } catch {
    return false;
  }
}

export function extractVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed;
  // Regex fallback first: tolerate cells wrapped in markdown links, HTML
  // entities, or extra comma-fields (common in playlist CSV exports).
  const regex =
    /(?:youtube\.com\/watch\?(?:[^#\s]*&)?v=|youtu\.be\/|youtube\.com\/(?:shorts|live|embed)\/)([\w-]{11})/i;
  const rm = trimmed.match(regex);
  if (rm) return rm[1];
  try {
    const url = new URL(trimmed);
    const v = url.searchParams.get("v");
    if (v && /^[\w-]{11}$/.test(v)) return v;
    if (/youtu\.be$/i.test(url.hostname)) {
      const m = url.pathname.match(/^\/([\w-]{11})/);
      if (m) return m[1];
    }
    const m = url.pathname.match(/\/(shorts|live|embed)\/([\w-]{11})/);
    if (m) return m[2];
  } catch {
    // ignore
  }
  return null;
}

/* --------------------------------- CSV import --------------------------------- */

/**
 * Minimal RFC-4180-ish CSV splitter: supports quoted fields, escaped quotes
 * (""), BOM, and both LF and CRLF line endings.
 */
export function parseCsvRows(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else if (ch === "\r") {
      // handled on \n; tolerate lone \r as a line break too
      if (src[i + 1] !== "\n") {
        row.push(field);
        field = "";
        rows.push(row);
        row = [];
      }
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}

const CSV_URL_COLUMNS = ["url", "video_url", "video_url_or_id", "videourl", "link", "video", "video_id", "videoid", "id"];
const CSV_TITLE_COLUMNS = ["title", "name", "video_title", "lesson_title"];
const CSV_LESSON_NO_COLUMNS = ["lesson_no", "lessonno", "lesson", "no", "#", "num", "number", "index", "position", "order"];

/** Normalize a CSV cell: HTML entities, markdown link wrappers, stray quotes. */
function normalizeCsvCell(cell: string): string {
  let s = cell.trim();
  s = s.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/g, "'");
  // markdown link "[text](target)" → prefer the link text (it holds the URL/data)
  const md = s.match(/^\[([\s\S]*)\]\([\s\S]*\)$/);
  if (md) s = md[1].trim();
  return s;
}

function findColumn(header: string[], candidates: string[]): number {
  return header.findIndex((h) => candidates.includes(normalizeCsvCell(h).toLowerCase()));
}

/**
 * Parse a CSV playlist. Flexible headers:
 *   url | video_url | link | video_id | id   (required)
 *   title | name | lesson_title               (optional)
 *   lesson_no | lesson | index | position     (optional)
 * A header-less CSV is also accepted: column order url[,title[,lesson_no]].
 */
export function parseCsvPlaylist(csvText: string): { playlistId: string | null; entries: PlaylistEntry[] } {
  const rows = parseCsvRows(csvText);
  if (rows.length === 0) {
    throw new Error("CSV playlist is empty.");
  }

  let urlCol = 0;
  let titleCol = 1;
  let lessonNoCol = 2;
  let dataRows = rows;

  const first = rows[0].map((c) => c.trim().toLowerCase());
  const headerUrlCol = findColumn(first, CSV_URL_COLUMNS);
  if (headerUrlCol >= 0) {
    urlCol = headerUrlCol;
    titleCol = findColumn(first, CSV_TITLE_COLUMNS);
    lessonNoCol = findColumn(first, CSV_LESSON_NO_COLUMNS);
    dataRows = rows.slice(1);
    if (dataRows.length === 0) {
      throw new Error("CSV playlist has a header but no data rows.");
    }
  } else {
    // header-less: assume column order url[,title[,lesson_no]]
    titleCol = rows[0].length > 1 ? 1 : -1;
    lessonNoCol = rows[0].length > 2 ? 2 : -1;
  }

  const entries: PlaylistEntry[] = [];
  for (const row of dataRows) {
    const rawUrl = normalizeCsvCell(row[urlCol] ?? "");
    if (!rawUrl) continue;
    const videoId = extractVideoId(rawUrl);
    if (!videoId) {
      throw new Error(`CSV row ${entries.length + 1}: cannot extract a YouTube video id from "${rawUrl.slice(0, 120)}".`);
    }
    const rawTitle = titleCol >= 0 ? normalizeCsvCell(row[titleCol] ?? "") : "";
    const rawLessonNo = lessonNoCol >= 0 ? normalizeCsvCell(row[lessonNoCol] ?? "") : "";
    const lessonNo = rawLessonNo ? Number(rawLessonNo) : null;
    entries.push({
      index: entries.length,
      videoId,
      title: rawTitle || null,
      lessonNo: Number.isFinite(lessonNo as number) && (lessonNo as number) > 0 ? (lessonNo as number) : null,
    });
  }

  if (entries.length === 0) {
    throw new Error("CSV playlist contains no usable video rows.");
  }

  // Optional playlist id column or a playlist URL anywhere in the url column.
  const playlistId = entries.map((e) => parsePlaylistId(e.videoId)).find(Boolean) ?? null;
  return { playlistId, entries };
}

export function isCsvPlaylistPath(input: string): boolean {
  const trimmed = input.trim();
  return /\.csv$/i.test(trimmed) && !/^https?:\/\//i.test(trimmed);
}

async function loadCsvPlaylist(filePath: string, maxVideos: number): Promise<PlaylistInfo> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read CSV playlist file "${filePath}": ${message}`);
  }
  const { playlistId, entries } = parseCsvPlaylist(text);
  return {
    playlistId,
    source: "csv_file",
    entries: entries.slice(0, maxVideos).map((e, i) => ({ ...e, index: i })),
  };
}

/* -------------------------------- resolution -------------------------------- */

async function fetchViaYouTubeApi(playlistId: string, maxVideos: number): Promise<PlaylistEntry[]> {
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) throw new Error("YOUTUBE_API_KEY missing");
  const entries: PlaylistEntry[] = [];
  let pageToken = "";
  while (entries.length < maxVideos) {
    const qs = new URLSearchParams({
      part: "snippet",
      maxResults: String(Math.min(50, maxVideos - entries.length)),
      playlistId,
      key: apiKey,
      ...(pageToken ? { pageToken } : {}),
    });
    const res = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?${qs}`);
    if (!res.ok) throw new Error(`playlistItems HTTP ${res.status}`);
    const data = (await res.json()) as {
      items?: Array<{ snippet?: { resourceId?: { videoId?: string }; title?: string; position?: number } }>;
      nextPageToken?: string;
    };
    for (const item of data.items || []) {
      const videoId = item.snippet?.resourceId?.videoId;
      if (!videoId) continue;
      entries.push({
        index: entries.length,
        videoId,
        title: item.snippet?.title ?? null,
      });
      if (entries.length >= maxVideos) break;
    }
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return entries;
}

async function fetchViaYtDlp(
  playlistUrlOrId: string,
  maxVideos: number,
  timeoutMs: number
): Promise<PlaylistEntry[]> {
  const command = process.env.YT_DLP_PATH?.trim() || "yt-dlp";
  const target = /^https?:\/\//.test(playlistUrlOrId)
    ? playlistUrlOrId
    : `https://www.youtube.com/playlist?list=${playlistUrlOrId}`;
  const { stdout } = await execFileAsync(
    command,
    [
      "--no-warnings",
      "--flat-playlist",
      "--dump-single-json",
      "--playlist-end",
      String(maxVideos),
      target,
    ],
    { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }
  );
  const data = JSON.parse(stdout) as { entries?: Array<{ id?: string; title?: string | null }> };
  return (data.entries || [])
    .filter((e) => Boolean(e.id))
    .map((e, i) => ({ index: i, videoId: e.id as string, title: e.title ?? null }));
}

export async function resolvePlaylistEntries(options: {
  url: string;
  maxVideos?: number;
  timeoutMs?: number;
}): Promise<PlaylistInfo> {
  const maxVideos = Math.max(1, options.maxVideos ?? 50);
  const timeoutMs = options.timeoutMs ?? Math.max(METADATA_TIMEOUT_MS, 120_000);
  const input = options.url.trim();

  if (isCsvPlaylistPath(input)) {
    return loadCsvPlaylist(input, maxVideos);
  }

  const videoId = extractVideoId(input);
  if (videoId && !isPlaylistUrl(input)) {
    return {
      playlistId: null,
      source: "single_video",
      entries: [{ index: 0, videoId, title: null }],
    };
  }

  const playlistId = parsePlaylistId(input);
  if (!playlistId) {
    throw new Error(
      "Unrecognized input. Provide a YouTube playlist URL (…?list=…), a playlist id, a video URL, or a local .csv playlist file."
    );
  }

  if (process.env.YOUTUBE_API_KEY?.trim()) {
    try {
      const entries = await fetchViaYouTubeApi(playlistId, maxVideos);
      if (entries.length > 0) return { playlistId, source: "youtube_api", entries };
    } catch {
      // fall through to yt-dlp
    }
  }

  const entries = await fetchViaYtDlp(input, maxVideos, timeoutMs);
  return { playlistId, source: "yt_dlp", entries };
}
