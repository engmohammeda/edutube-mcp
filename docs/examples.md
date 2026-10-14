# Examples

These examples are prompts you can use from an MCP-compatible client after configuring the server.

## Short Video Summary

```text
Analyze this YouTube video and summarize the main argument in the video's original language:
https://www.youtube.com/watch?v=VIDEO_ID
```

## Timestamped Study Notes

```text
Analyze this lecture and return timestamped study notes, key terms, and a final review checklist:
https://www.youtube.com/watch?v=VIDEO_ID
```

## Audio-First Analysis

```text
Use the audio analysis tool for this video. Extract the speaker's claims, supporting evidence, and action items:
https://www.youtube.com/watch?v=VIDEO_ID
```

## Clip Window

```text
Analyze only the section from 120 seconds to 420 seconds. Return the important points with timestamps:
https://www.youtube.com/watch?v=VIDEO_ID
```

## Metadata Lookup

```text
Fetch metadata for this YouTube video before analyzing it:
https://www.youtube.com/watch?v=VIDEO_ID
```

## Long VOD Workflow

```text
Check the YouTube analyzer capabilities, then analyze this long VOD. Focus on decisions, tasks, names, dates, and timestamps:
https://www.youtube.com/watch?v=VIDEO_ID
```

## Follow-Up Question

```text
Continue the previous long-video analysis and list every concrete recommendation with a timestamp and confidence level.
```

## Structured Output

Ask your MCP client to call `analyze_youtube_video` with a custom JSON schema when you need predictable output for downstream processing.

Example target shape:

```json
{
  "summary": "string",
  "language": "string",
  "topics": ["string"],
  "timestampedMoments": [
    {
      "time": "string",
      "event": "string",
      "importance": "low | medium | high"
    }
  ]
}
```

## Lesson Extraction (Edutube)

Extract a whole course playlist as structured lessons — one JSON per video:

```text
Extract structured lessons from this playlist using the writing course preset:
https://www.youtube.com/playlist?list=PL...
```

The agent will call `start_edutube_extraction` with `course: "writing"`, poll `get_edutube_job_status`, and report `get_edutube_job_result`.

```text
Extract phonetics lessons from my CSV playlist at ./my-course.csv into ./phonetics-lessons
```

```text
Validate the extracted lessons in ./writing-lessons against the writing preset
```

(Uses `edutube-mcp validate ./writing-lessons --course writing` — see [validation](validation.md).)

Custom prompt + schema, keeping full control of the output shape:

```text
Extract lessons from https://www.youtube.com/watch?v=VIDEO_ID using my prompt in ./my-prompt.txt and my schema in ./my-schema.json
```

Real extracted samples for every preset: [`examples/lessons-all.json`](../examples/lessons-all.json) (conversation), [`examples/phonetics-lessons-all.json`](../examples/phonetics-lessons-all.json), [`examples/writing-lessons-all.json`](../examples/writing-lessons-all.json).
