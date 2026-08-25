# Automatic Model Rotation

Every Gemini model has an independent free-tier quota pool (≈20 generateContent requests/day/model on free keys). Edutube rotates across pools transparently.

## How it works

1. The server queries `GET /v1beta/models` for your key (cached 10 minutes) and keeps every `gemini-*` model that supports `generateContent` (images/tts/embeddings excluded). Future models such as `gemini-3.6-flash` or `gemini-3.7-*` join automatically.
2. Candidate order: requested model → last successful model → `GEMINI_MODEL_ROTATION` (optional env list) → known hints (`gemini-2.5-flash`, `gemini-3-flash-preview`, `gemini-2.5-flash-lite`, `gemini-3.1-flash-lite-preview`, `gemini-2.0-flash`, …, pro models last) → remaining discovered models sorted by family (flash → lite → pro).
3. On `429 RESOURCE_EXHAUSTED` the model is marked exhausted (for the retry delay from the error, minimum 5 minutes) and the same request is retried on the next candidate.
4. Models rejecting structured output schemas are skipped for schema calls.
5. `cachedContent` is dropped when switching models (Gemini caches are model-specific).
6. Rotation is embedded in `generateStructuredJson` and `countTokens`, so **all** tools (short analysis, chunks, synthesis, follow-ups, frame refinement, edutube pipeline) benefit.

## Observability

Server logs emit `gemini.call_failed` (per model) and `gemini.model_rotated {from, to}` events.

## Configuration

```bash
# optional explicit order
GEMINI_MODEL_ROTATION=gemini-2.5-flash,gemini-3-flash-preview,gemini-2.5-flash-lite
```

For production batches, a paid key removes rotation pressure entirely.
