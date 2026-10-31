# AI

AutoCast works with **any OpenAI-compatible service**. You bring the service and key; AutoCast never sends your data anywhere else.

## Connect a service

**Settings → ✦ AI**. Click a preset, then fill in the rest:

| Service | Base URL | Text model (example) | Vision | Speech to text |
|---|---|---|---|---|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` | `gpt-4o-mini` | `whisper-1` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash` | `gemini-2.5-flash` | — |
| OpenRouter | `https://openrouter.ai/api/v1` | `openai/gpt-4o-mini` | same | — |
| Ollama (local) | `http://127.0.0.1:11434/v1` | `llama3.1` | `llava` | — |
| OmniRoute / LiteLLM / your own proxy | your proxy URL ending in `/v1` | any model it serves | any vision model | if it serves `/audio/transcriptions` |

| Field | Meaning |
|---|---|
| Text model | Used for all writing |
| Vision model | Looks at video frames (thumbnails, writing without speech). Empty = text only. |
| Speech-to-text model | For transcripts, captions and AI Shorts. Needs `/audio/transcriptions`. |
| Language | Language of AI-written text |
| Safety check | Off, **Warn** (log it, still post) or **Block** (stop risky posts) |
| Daily AI report | The hour to make it (and send to Telegram) |

Press **Test**. The usage line shows calls and tokens this month.

If a model doesn't support JSON mode, AutoCast retries without it.

## The tools

| # | Tool | Where | What it does |
|---|---|---|---|
| 1 | Write with AI | Create post | Title, description, hashtags. Uses the transcript if there is one, otherwise 3 frames (vision). The title box acts as an optional topic hint. |
| 2 | Title ideas | Create post | 5 different titles. Click one to use it. |
| 3 | Rewrite per app | Create post | One version per app, fitting each app's style and limits |
| 4 | Translate to… | Create post | Translates the current tab. Keeps hashtags, names and numbers. |
| 5 | Transcribe | Library → ✦ AI | Speech to text with times. Long videos are sent in 10-minute parts. |
| 6 | Add captions | Library → ✦ AI | A copy of the video with captions burned in: short lines, white with a black outline, no box |
| 7 | AI Shorts | Library → ✦ AI | AI reads the transcript and picks the best moments. Each clip is 9:16, has a hook for 3.5 s, captions, and an AI title (also saved as a `.json` next to it). |
| 8 | AI thumbnail | Library → ✦ AI | AI picks the best of 6 frames and writes 2–4 big words and a big number. You can type your own words. |
| 9 | YouTube thumbnail | automatic | If a video has an AI thumbnail, it is set as the YouTube custom thumbnail |
| 10 | Safety check | before each post, and a button in Create post | Looks for hate, adult content, dangerous advice, spam patterns, misleading money claims, personal data. Block mode fails the post with the reason; no retries. |
| 11 | Autopilot AI | Autopilot rule | New folder videos without a `.json` get AI text (and a thumbnail if ticked) |
| 12 | Live ticker | Control room → AI line | A fresh fact, tip or question every N minutes, on the theme you type. Shown next to your overlay text. No restart. |
| 13 | Now playing | Control room → AI line | A short line about each video when it starts (uses its transcript if there is one) |
| 14 | Ask AutoCast | Overview | Type a request. AI turns it into one action (post a video, start or stop a station). **Nothing happens until you press "Do it."** Only these actions are allowed. |
| 15 | Explain this error | Failed post | The error in plain words, with 2–4 fix steps |
| 16 | Daily report | Overview, Telegram | What happened in 24 hours, what needs action |
| 17 | Suggest times | Accounts → ⚙ | 3 posting times for that app and audience |

## Tips

- **Transcribe first**: writing, Shorts and "now playing" all get much better with a transcript.
- AI text is a draft. Read it before posting, especially facts and numbers.
- Safety checks cost one AI call per post per app (retries don't pay again).
- An AI service on the same VPS but outside Docker (Ollama, OmniRoute): `127.0.0.1` inside the container is the container itself. Use `http://host.docker.internal:<port>/v1` instead. The bundled `docker-compose.yml` already has this line for it:

  ```yaml
  extra_hosts:
    - "host.docker.internal:host-gateway"
  ```

## Privacy

What is sent to your AI service:

| Tool | Sent |
|---|---|
| Writing, rewrite, translate, safety | Title, description, file name, transcript text |
| Vision tools | 3–6 small frames (JPEG, 384–640 px wide) |
| Transcribe | The audio track (16 kHz mono MP3) |
| Ask AutoCast | Account names/ids, station names, the last 40 video names |
| Report, explain | Counts and error messages |

The API key is stored encrypted and never sent to the browser.
