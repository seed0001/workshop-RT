# Aether Workshop — Business Crew Edition

A local, voice-enabled **multi-persona AI discussion studio**. You assemble a panel
of AI personas — a full business org out of the box (CEO, CFO, CTO, …) — give them
a topic, and watch them talk it out with each other in real time, each in their own
synthesized voice. Everything runs **on your own machine**: the language models come
from [Ollama](https://ollama.com), and speech is generated with Microsoft Edge's
neural text-to-speech voices.

---

## Table of contents

- [What it does](#what-it-does)
- [The built-in business crew](#the-built-in-business-crew)
- [Requirements](#requirements)
- [Setup](#setup)
- [Running it](#running-it)
- [Using the workshop](#using-the-workshop)
- [How it works](#how-it-works)
- [Project layout](#project-layout)
- [API reference](#api-reference)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [Notes & limitations](#notes--limitations)

---

## What it does

- **Multi-persona round-table.** Two or more AI personas hold a continuous,
  in-character conversation, responding to each other and to you.
- **Real local models.** Each persona is backed by a local Ollama model of your
  choice (Llama 3.2, Qwen, Gemma, etc.).
- **Spoken responses.** Every reply is synthesized to audio with Edge TTS and
  played back automatically, so the panel actually *talks*.
- **You're the moderator.** Jump in at any time with a message; the personas treat
  you as the host of the discussion.
- **Turn-taking modes.** Round-robin, random, "moderator decides" (personas hand
  off to whoever they name), or fully manual.
- **Custom personas.** Create, edit, and delete your own personas — name, emoji,
  color, voice, system prompt, and "temperature" (creativity) — all saved locally
  in your browser.
- **Built to run for hours.** The per-turn context is capped and transient model
  errors are skipped instead of killing the session, so a panel can keep going
  indefinitely.

---

## The built-in business crew

The starter presets are a complete company. Click a preset badge in the UI to load
it into the form, then save it to the panel.

| Persona          | Focus                                                   |
| ---------------- | ------------------------------------------------------- |
| 👔 CEO           | Strategy, vision, growth, holding the team accountable  |
| 💰 CFO           | Budgets, margins, ROI, risk — "what does it cost?"      |
| 🖥️ CTO           | Architecture, scalability, technical feasibility        |
| 📣 CMO           | Brand, positioning, messaging, the customer's voice     |
| ⚙️ COO           | Process, execution, timelines, operational bottlenecks  |
| 🤝 HR Director   | People, culture, hiring, morale, fairness               |
| ⚖️ Legal Counsel | Compliance, contracts, liability, IP risk               |
| 📈 Sales Director| Pipeline, closing, quota, customer relationships        |
| 🛠️ Tech Support  | Help-desk diagnostics, patient step-by-step fixes       |

On first run, the panel is pre-populated with the **CEO, CFO, and CTO** so you can
start a discussion immediately.

---

## Requirements

- **Windows** (the `.bat` helpers target Windows; the Python app itself is
  cross-platform).
- **Python 3.10+** — <https://www.python.org/downloads/> (tick *“Add Python to
  PATH”* during install).
- **Ollama** — <https://ollama.com/download> — plus at least one pulled model:
  ```
  ollama pull llama3.2
  ```
- **Internet access** for the voices: Edge TTS streams from Microsoft's online
  service, so speech synthesis needs a connection. (The language models run fully
  offline once pulled.)

---

## Setup

Run the one-time setup, which creates an isolated Python environment and installs
everything:

```
setup.bat
```

It will:

1. Confirm Python is installed and on your PATH.
2. Create a virtual environment in `.venv`.
3. Install the Python dependencies (`fastapi`, `uvicorn`, `httpx`, `edge-tts`).
4. Check whether Ollama is installed and remind you to pull a model.

If you prefer to do it manually:

```
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
```

---

## Running it

1. Make sure **Ollama is running** (it usually starts on login) and you've pulled a
   model.
2. Double-click **`run_workshop.bat`**.

The launcher starts the server and opens <http://localhost:8000> in your browser.
It also binds to your local network, so other devices on your Wi-Fi can reach it at
the `http://<your-ip>:8000` address shown in the console.

> The launcher uses the `.venv` created by `setup.bat`. If `.venv` doesn't exist it
> falls back to a globally installed `uvicorn`.

---

## Using the workshop

1. **Pick models & voices.** The sidebar lists the Ollama models it found and the
   full catalog of Edge voices (searchable, filterable by gender).
2. **Build your panel.** Click a preset badge (or fill the form yourself), choose a
   model and voice, then **Save**. You need at least **two** personas to start.
3. **Set a topic** in the box above the chat feed.
4. **Start Discussion.** The personas take turns speaking and you'll hear each one.
   - **Pause** to halt, **Step** to advance one turn at a time, **Clear** to wipe
     the conversation.
   - Changing the topic resets the conversation memory automatically so the panel
     starts fresh.
5. **Chime in.** Type into the moderator box and send — the panel responds to you.

Your custom personas persist in your browser's local storage, so they're still
there next time you open the app **on the same browser and URL**.

---

## How it works

```
Browser (static/) ──HTTP──▶ FastAPI (main.py) ──▶ Ollama  (text generation)
        ▲                            │
        │                            └────────▶ Edge TTS (speech synthesis)
        └────────  audio + text  ◀───────────────┘
```

- The **frontend** (`static/app.js`) manages personas, the turn order, the chat
  feed, and audio playback. It calls the backend once per speaker turn.
- The **backend** (`main.py`) builds an in-character system prompt, forwards the
  recent conversation to Ollama's chat API, then synthesizes the reply to an MP3
  with Edge TTS and returns both text and an audio URL.
- To keep long sessions stable, the frontend only sends a **sliding window** of the
  most recent messages each turn (full transcript stays on screen), and a failed
  turn is **skipped** rather than ending the session — it only stops after several
  consecutive failures.

---

## Project layout

```
.
├── main.py              # FastAPI backend: /api/chat, /api/models, /api/voices, /api/tts
├── requirements.txt     # Python dependencies
├── setup.bat            # One-time environment setup
├── run_workshop.bat     # Launches the server + opens the browser
├── static/
│   ├── index.html       # UI markup
│   ├── app.js           # All frontend logic (personas, turns, audio)
│   ├── style.css        # Styling
│   └── audio/           # Generated TTS clips (git-ignored, cleared on startup)
└── README.md
```

---

## API reference

All endpoints are served by `main.py`.

| Method | Path           | Purpose                                                        |
| ------ | -------------- | -------------------------------------------------------------- |
| GET    | `/`            | Serves the UI (`static/index.html`).                           |
| GET    | `/api/models`  | Lists models available from the local Ollama server.          |
| GET    | `/api/voices`  | Lists all Edge TTS voices.                                     |
| POST   | `/api/chat`    | Generates one persona's turn (text + synthesized audio URL).  |
| POST   | `/api/tts`     | Synthesizes arbitrary text to audio (used for voice preview).  |

---

## Configuration

- **Ollama URL** — defaults to `http://localhost:11434`. Override with the
  `OLLAMA_URL` environment variable before launching.
- **Port** — the launcher uses `8000`. Edit `run_workshop.bat` (and
  `.claude/launch.json`) to change it.
- **History window / error tolerance** — tunable near the top of `static/app.js`
  via `HISTORY_WINDOW` and `MAX_CONSECUTIVE_ERRORS`.

---

## Troubleshooting

- **"Ollama: No Models" / connection warning** — make sure the Ollama app is
  running and you've pulled at least one model (`ollama pull llama3.2`).
- **Preset buttons do nothing after an update** — your browser cached the old
  JavaScript. Hard-refresh with **Ctrl+F5**. (The app already cache-busts its
  script tag to minimize this.)
- **My saved personas disappeared** — personas live in your browser's
  `localStorage`, which is tied to the exact origin. Opening the app at
  `http://localhost:8000` vs. `http://<your-ip>:8000` are *different* origins with
  separate storage. Re-open the URL you originally used.
- **No audio** — Edge TTS needs an internet connection; check your network. Replies
  still appear as text without it.

---

## Notes & limitations

- The `.bat` helpers are Windows-specific. On macOS/Linux you can run the app
  directly: `uvicorn main:app --host 0.0.0.0 --port 8000`.
- Generated audio clips accumulate in `static/audio/` during a session and are
  cleared on the next server startup.
- Personas are stored per-browser; there is currently no export/import. (Planned.)
