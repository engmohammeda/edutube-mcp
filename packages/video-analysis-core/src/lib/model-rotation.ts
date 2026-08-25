// LOCAL PATCH (agent-env feature): automatic cross-key + cross-model rotation.
// Every (API key, model) pair has its own free-tier quota pool. When a pair
// returns RESOURCE_EXHAUSTED (429), the rotator transparently switches to the
// next available pair so long batches can keep running. The model catalogue is
// discovered live from the Gemini API (per key), so future models
// (e.g. gemini-3.6-flash, gemini-3.7-*) join the rotation without code changes.
// Configure extra keys with GEMINI_API_KEYS=key2,key3 (GEMINI_API_KEY stays primary).
import process from "node:process";

const CACHE_TTL_MS = 10 * 60_000;

let discoveredCache: { at: number; key: string; models: string[] } | null = null;
const exhaustedUntil = new Map<string, number>(); // `${key}::${model}` -> ts
const schemaUnsupported = new Set<string>();
let preferredModel: string | null = null;

// Video-capable families ordered to spread usage across free pools.
// Models listed here but not present for the key are skipped automatically;
// discovered models not listed here are appended by family score.
const PRIORITY_HINTS = [
  "gemini-2.5-flash",
  "gemini-3-flash-preview",
  "gemini-2.5-flash-lite",
  "gemini-3.1-flash-lite-preview",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.6-flash",
  "gemini-3.7-flash",
  "gemini-3-flash",
  "gemini-3.0-flash",
  "gemini-3-pro-preview",
  "gemini-2.5-pro",
];

function textOf(error: unknown): string {
  if (error == null) return "";
  const e = error as { message?: unknown; causeMessage?: unknown };
  const message = typeof e.message === "string" ? e.message : String(error);
  const cause = typeof e.causeMessage === "string" ? e.causeMessage : "";
  return `${message} ${cause}`;
}

export function isQuotaError(error: unknown): boolean {
  const msg = textOf(error);
  return /RESOURCE_EXHAUSTED|429|exceeded your current quota|quota exceeded|retry in \d/i.test(msg);
}

export function isSchemaUnsupportedError(error: unknown): boolean {
  const msg = textOf(error);
  return /INVALID_ARGUMENT/.test(msg) && /schema|response_json_schema|responseJsonSchema/i.test(msg);
}

export function parseRetrySeconds(error: unknown): number | null {
  const msg = textOf(error);
  const m = msg.match(/retry in ([\d.]+)\s*s/i) || msg.match(/retryDelay[^0-9]{0,10}(\d+)\s*s/i);
  return m ? Math.ceil(Number(m[1])) : null;
}

export function listGeminiApiKeys(): string[] {
  const primary = process.env.GEMINI_API_KEY?.trim() || "";
  const extra = (process.env.GEMINI_API_KEYS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of [primary, ...extra]) {
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

function familyScore(name: string): number {
  if (/lite/i.test(name)) return 2;
  if (/flash/i.test(name)) return 1;
  if (/pro/i.test(name)) return 4;
  return 3;
}

async function discoverModels(apiKey: string): Promise<string[]> {
  if (!apiKey) return [];
  if (discoveredCache && discoveredCache.key === apiKey && Date.now() - discoveredCache.at < CACHE_TTL_MS) {
    return discoveredCache.models;
  }
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?pageSize=500&key=${encodeURIComponent(apiKey)}`
    );
    if (!res.ok) throw new Error(`models list HTTP ${res.status}`);
    const data = (await res.json()) as {
      models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
    };
    const names = (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => (m.name || "").replace(/^models\//, ""))
      .filter((n) => /^gemini-/i.test(n))
      .filter((n) => !/(image|tts|embedding|imagen|music|live|deep-research|a2a|computer)/i.test(n));
    discoveredCache = { at: Date.now(), key: apiKey, models: names };
    return names;
  } catch {
    return discoveredCache?.models ?? [];
  }
}

function dedupe(list: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of list) {
    if (!m || seen.has(m)) continue;
    seen.add(m);
    out.push(m);
  }
  return out;
}

export type RotationPick = { model: string; key: string };

export class ModelRotator {
  private lastError: unknown = null;

  constructor(
    private requestedModel: string,
    private apiKeys: string[]
  ) {}

  async pick(): Promise<RotationPick | null> {
    const envList = dedupe(
      (process.env.GEMINI_MODEL_ROTATION || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    );
    // Discovery from the first key is representative for the account family.
    const discovered = await discoverModels(this.apiKeys[0] || "");

    const explicit = dedupe([this.requestedModel, ...envList]);
    let hinted = dedupe([...(preferredModel ? [preferredModel] : []), ...PRIORITY_HINTS]);
    if (discovered.length > 0) {
      hinted = hinted.filter((m) => discovered.includes(m));
    } else if (this.apiKeys.length === 0) {
      hinted = [];
    }
    const rest = discovered
      .filter((m) => !explicit.includes(m) && !hinted.includes(m))
      .sort((a, b) => familyScore(a) - familyScore(b) || a.localeCompare(b));

    const candidates = [...explicit, ...hinted, ...rest];
    const now = Date.now();
    for (const model of candidates) {
      if (schemaUnsupported.has(model)) continue;
      for (const key of this.apiKeys) {
        const pairKey = `${key}::${model}`;
        const until = exhaustedUntil.get(pairKey);
        if (until && now < until) continue;
        return { model, key };
      }
    }
    return null;
  }

  markSuccess(model: string): void {
    preferredModel = model;
  }

  markQuotaExhausted(model: string, key: string, retrySeconds: number | null): void {
    const secs = Math.min(Math.max(retrySeconds ?? 3600, 300), 6 * 3600);
    exhaustedUntil.set(`${key}::${model}`, Date.now() + secs * 1000);
  }

  markSchemaUnsupported(model: string): void {
    schemaUnsupported.add(model);
  }

  setLastError(error: unknown): void {
    this.lastError = error;
  }

  getLastError(): unknown {
    return this.lastError;
  }
}
