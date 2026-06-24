# Aether Workshop — Business Crew Edition

A local, voice-enabled **multi-persona AI studio**. You assemble a panel of AI
personas — a full business org out of the box (CEO, CFO, CTO, …) — give them a
topic, and watch them talk it out in real time, each in their own synthesized
voice. Two modes turn it into more than a chat:

- **🎬 Story Mode** narrates cinematic stage directions before and after each line,
  so the discussion plays out like a screenplay.
- **📁 Project Mode** ingests a real codebase (clone a GitHub repo or upload files)
  and has the crew analyze it for improvements, gaps, and monetization.

Everything runs **on your own machine**: the language models come from
[Ollama](https://ollama.com), and speech is generated with Microsoft Edge's
neural text-to-speech voices.

---

## Table of contents

- [What it does](#what-it-does)
- [The built-in crews](#the-built-in-crews)
- [Requirements](#requirements)
- [Setup](#setup)
- [Running it](#running-it)
- [Using the workshop](#using-the-workshop)
- [Story Mode](#story-mode)
- [Project Mode](#project-mode)
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
  played back automatically, so the panel actually *talks*. Emphasized words
  (`*like this*`) are spoken — only the markdown markers are stripped.
- **You're the moderator.** Jump in at any time with a message; the personas treat
  you as the host of the discussion.
- **Turn-taking modes.** Round-robin, random, "moderator decides" (personas hand
  off to whoever they name), or fully manual.
- **Story Mode.** A voiced narrator adds before/after stage directions around each
  line. See [Story Mode](#story-mode).
- **Project Mode.** Point the crew at a GitHub repo or uploaded files and they
  review the actual code. See [Project Mode](#project-mode).
- **Custom personas.** Create, edit, and delete your own personas — name, emoji,
  color, voice, system prompt, and "temperature" (creativity) — all saved locally
  in your browser.
- **Built to run for hours.** The per-turn context is capped and transient model
  errors are skipped instead of killing the session, so a panel can keep going
  indefinitely.

---

## The built-in crews

Click a preset badge in the UI to load it into the form, then **Save** it to the
panel. There are two preset rows.

### Business crew

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

### Review crew (for Project Mode)

| Persona                   | Focus                                                  |
| ------------------------- | ------------------------------------------------------ |
| 🏗️ Senior Architect        | Structure, scalability, technical debt, refactors     |
| 🧭 Product Strategist      | Product-market fit, user value, missing features       |
| 🔒 Security Auditor        | Vulnerabilities, secrets, unsafe patterns, severity    |
| 🎨 UX Critic               | Usability, flows, accessibility, polish                |
| 💸 Monetization Strategist | Pricing, revenue models, go-to-market, first revenue   |

The **Load Review Crew** button in the Project Mode panel swaps the whole panel to
these five with one click.

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
- **Git** — required by Project Mode to clone repositories
  (<https://git-scm.com/downloads>). Not needed if you only upload files.
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
3. Install the Python dependencies (`fastapi`, `uvicorn`, `httpx`, `edge-tts`,
   `python-multipart`).
4. Check whether Ollama is installed and remind you to pull a model.

If you prefer to do it manually:

```
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
```

> If you upgrade from an older copy, re-run `setup.bat` (or
> `pip install -r requirements.txt`) so the new `python-multipart` dependency —
> needed for Project Mode uploads — is installed.

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
>
> The server does **not** auto-reload. After updating the code, restart the
> launcher window for backend changes to take effect.

---

## Using the workshop

1. **Pick models & voices.** The sidebar lists the Ollama models it found and the
   full catalog of Edge voices (searchable, filterable by gender).
2. **Build your panel.** Click a preset badge (or fill the form yourself), choose a
   model and voice, then **Save**. You need at least **two** personas to start.
3. **Set a topic** in the box above the chat feed.
4. **Start Discussion.** The personas take turns speaking and you'll hear each one.
   - **Pause** to halt, **Next Speaker Turn** to advance one turn at a time,
     **Clear Arena** to wipe the conversation.
   - Changing the topic resets the conversation memory automatically so the panel
     starts fresh.
5. **Chime in.** Type into the moderator box and send — the panel responds to you.

Your custom personas persist in your browser's local storage, so they're still
there next time you open the app **on the same browser and URL**.

---

## Story Mode

Toggle **🎬 Story Mode** (next to the topic box) and pick a **narrator voice**.
Each turn then plays as a scene:

> *Alex leans forward, elbows on the table, scanning the report with a critical gaze.*
> **Alex:** "These numbers are a disaster."
> *Alex sits back, slumps, and rubs his temples.*
> *Tom shifts in his seat, jaw tightening.*
> **Tom:** "...let me explain."

- A **voiced narrator** speaks a third-person, present-tense stage direction
  **before** each line (the lead-in) and **after** each line (the reaction).
- Stage directions are added to the conversation history, so the personas *see*
  the staged action and react to it (glances, hand-offs, tension).
- Narration is best-effort: if a beat fails it's skipped without breaking the run.

> Story Mode roughly triples the model calls per turn (before + line + after), so
> each round is slower and audio clips accumulate faster.

---

## Project Mode

Toggle **📁 Project Mode** to reveal the ingest panel, then either:

- **Clone & Analyze** — paste a GitHub repo URL and the server clones it
  (shallow, depth-1) into a local `workspace/` folder; or
- **Upload & Analyze** — upload a `.zip` of a project (extracted safely) or a set
  of individual files.

The server indexes the project's text files and shows the name, file count, and a
file-tree preview. From then on, every persona turn is fed:

- a **project digest** (file tree + README + manifest files like `package.json`,
  `requirements.txt`, …), always present; plus
- a **rotating window of file excerpts** that advances each turn, so the whole
  codebase gets covered over the course of a session.

Each persona is steered to give concrete feedback from their role — improvements,
gaps/risks, and monetization — citing real file names. Pair it with **Load Review
Crew** for a panel tuned to exactly that.

- **Unload Project** clears the loaded project from memory.
- Loading a project nudges the topic toward a review (unless you set your own).
- The `workspace/` folder is git-ignored and is overwritten each time you load.

---

## How it works

```
Browser (static/) ──HTTP──▶ FastAPI (main.py) ──▶ Ollama   (text generation)
        ▲                          │
        │                          ├────────────▶ Edge TTS (speech synthesis)
        │                          └────────────▶ git / workspace (Project Mode)
        └──────  audio + text + stage directions ◀──┘
```

- The **frontend** (`static/app.js`) manages personas, turn order, the chat feed,
  and a promise-based audio engine that plays each turn's clips in sequence
  (narrator-before → line → narrator-after).
- The **backend** (`main.py`) builds an in-character system prompt, forwards the
  recent conversation to Ollama's chat API, then synthesizes the reply to an MP3
  with Edge TTS and returns text + audio URL. It also generates narrator stage
  directions and serves the Project Mode review context.
- To keep long sessions stable, only a **sliding window** of recent messages is
  sent each turn (full transcript stays on screen), and a failed turn is
  **skipped** rather than ending the session — it only stops after several
  consecutive failures.

---

## Project layout

```
.
├── main.py              # FastAPI backend (chat, voices, TTS, narrate, project/*)
├── requirements.txt     # Python dependencies
├── setup.bat            # One-time environment setup
├── run_workshop.bat     # Launches the server + opens the browser
├── static/
│   ├── index.html       # UI markup
│   ├── app.js           # All frontend logic (personas, turns, audio, modes)
│   ├── style.css        # Styling
│   └── audio/           # Generated TTS clips (git-ignored, cleared on startup)
├── workspace/           # Cloned/uploaded projects for Project Mode (git-ignored)
└── README.md
```

---

## API reference

All endpoints are served by `main.py`.

| Method | Path                    | Purpose                                                       |
| ------ | ----------------------- | ------------------------------------------------------------- |
| GET    | `/`                     | Serves the UI (`static/index.html`).                          |
| GET    | `/api/models`           | Lists models available from the local Ollama server.         |
| GET    | `/api/voices`           | Lists all Edge TTS voices.                                    |
| POST   | `/api/chat`             | Generates one persona's turn (text + synthesized audio URL). |
| POST   | `/api/narrate`          | Generates a narrator stage direction (`before`/`after`) + audio. |
| POST   | `/api/tts`              | Synthesizes arbitrary text to audio (used for voice preview). |
| POST   | `/api/project/load_repo`| Clones a git repo into the workspace and indexes it.         |
| POST   | `/api/project/upload`   | Ingests an uploaded `.zip` or files and indexes them.        |
| GET    | `/api/project/status`   | Current project name, source, file count, and tree.          |
| GET    | `/api/project/context`  | Rotating review context for a given `turn`.                  |
| POST   | `/api/project/clear`    | Unloads the current project.                                 |

---

## Configuration

- **Ollama URL** — defaults to `http://localhost:11434`. Override with the
  `OLLAMA_URL` environment variable before launching.
- **Port** — the launcher uses `8000`. Edit `run_workshop.bat` to change it.
  (`.claude/launch.json` configures a separate dev-preview port and isn't needed to
  run the app.)
- **History window / error tolerance** — tunable near the top of `static/app.js`
  via `HISTORY_WINDOW` and `MAX_CONSECUTIVE_ERRORS`.
- **Project Mode indexing** — tunable near the top of `main.py`: `MAX_INDEX_FILES`,
  `MAX_READ_BYTES`, `PROJECT_FILES_PER_TURN`, `PROJECT_EXCERPT_LEN`, and the
  skip-dir / text-extension sets.

---

## Troubleshooting

- **"Ollama: No Models" / connection warning** — make sure the Ollama app is
  running and you've pulled at least one model (`ollama pull llama3.2`).
- **Changes don't show up after an update** — the server doesn't auto-reload;
  restart `run_workshop.bat`. For UI changes, also hard-refresh with **Ctrl+F5**
  (the app cache-busts its script tag to minimize this).
- **My saved personas disappeared** — personas live in your browser's
  `localStorage`, which is tied to the exact origin. Opening the app at
  `http://localhost:8000` vs. `http://<your-ip>:8000` are *different* origins with
  separate storage. Re-open the URL you originally used.
- **No audio** — Edge TTS needs an internet connection; check your network. Replies
  still appear as text without it.
- **Project upload fails** — make sure the `python-multipart` dependency is
  installed (re-run `setup.bat`). For repo cloning, make sure `git` is installed.

---

## Notes & limitations

- The `.bat` helpers are Windows-specific. On macOS/Linux you can run the app
  directly: `uvicorn main:app --host 0.0.0.0 --port 8000`.
- Generated audio clips accumulate in `static/audio/` during a session and are
  cleared on the next server startup. Story Mode + a large crew fills this faster.
- A loaded project lives in memory and in `workspace/`; loading a new one replaces
  it.
- Personas are stored per-browser; there is currently no export/import. (Planned.)
