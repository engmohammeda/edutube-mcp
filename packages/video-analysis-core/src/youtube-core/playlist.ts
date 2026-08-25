// Edutube feature: playlist import. Accepts a playlist URL (or bare playlist
// id, or a single video URL) and resolves the ordered video entries. Uses the
// YouTube Data API when YOUTUBE_API_KEY is configured, otherwise falls back to
// yt-dlp --flat-playlist so the feature works without any extra key.
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { METADATA_TIMEOUT_MS } from "../lib/constants.js";

const execFileAsync = promisify(execFile);

export type PlaylistEntry = {
  index: number;
  videoId: string;
  title: string | null;
};

export type PlaylistInfo = {
  playlistId: string | null;
  source: "youtube_api" | "yt_dlp" | "single_video";
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
  try {
    const url = new URL(trimmed);
    const v = url.searchParams.get("v");
    if (v) return v;
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
      "Unrecognized input. Provide a YouTube playlist URL (…?list=…), a playlist id, or a video URL."
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
