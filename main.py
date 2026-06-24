import os
import re
import io
import uuid
import shutil
import zipfile
import logging
import asyncio
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, HTTPException, BackgroundTasks, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
import httpx
import edge_tts

import tasks  # Task Extraction + DAG Execution subsystem (decoupled module)

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("persona-workshop")

app = FastAPI(title="Persona Workshop Backend")

# Enable CORS for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount the Task Extraction + DAG endpoints (/api/tasks, /api/dag/*).
app.include_router(tasks.router)

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
AUDIO_DIR = os.path.join(STATIC_DIR, "audio")
WORKSPACE_DIR = os.path.join(os.path.dirname(__file__), "workspace")

# ---------------------------------------------------------------------------
# Project Mode: clone/upload a codebase into a workspace, index its text files,
# and serve a rotating review context so the crew can analyze the whole project
# over the course of a session.
# ---------------------------------------------------------------------------
PROJECT_SKIP_DIRS = {
    ".git", "node_modules", "__pycache__", ".venv", "venv", "env", "dist", "build",
    ".next", "out", "target", ".idea", ".vscode", ".pytest_cache", ".mypy_cache",
    "coverage", ".gradle", "bin", "obj", "audio", ".cache", "vendor", ".turbo",
}
PROJECT_TEXT_EXT = {
    ".py", ".js", ".ts", ".tsx", ".jsx", ".mjs", ".cjs", ".java", ".go", ".rs", ".rb",
    ".php", ".c", ".cpp", ".cc", ".h", ".hpp", ".cs", ".html", ".htm", ".css", ".scss",
    ".sass", ".less", ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".md",
    ".markdown", ".txt", ".sh", ".bash", ".bat", ".ps1", ".sql", ".vue", ".svelte", ".kt",
    ".kts", ".swift", ".m", ".mm", ".r", ".pl", ".lua", ".dart", ".ex", ".exs", ".scala",
    ".clj", ".gradle", ".xml", ".env", ".gitignore", ".dockerignore", ".graphql", ".proto",
}
PROJECT_NAMED_FILES = {"dockerfile", "makefile", "readme", "license", "procfile", ".env.example"}
MAX_INDEX_FILES = 600        # cap how many text files we track
MAX_READ_BYTES = 24000       # cap bytes read from any single file
PROJECT_FILES_PER_TURN = 3   # how many files to surface each review turn
PROJECT_EXCERPT_LEN = 1800   # chars per file excerpt in the review context

# In-memory store of the currently loaded project (single-user local app).
PROJECT: Dict[str, Any] = {
    "name": None, "root": None, "source": None, "files": [], "tree": "", "digest": "",
}


def _looks_like_text(name: str) -> bool:
    lower = name.lower()
    if lower in PROJECT_NAMED_FILES or lower.startswith("readme") or lower.startswith("dockerfile"):
        return True
    _, ext = os.path.splitext(lower)
    return ext in PROJECT_TEXT_EXT


def _read_text(abspath: str) -> str:
    try:
        with open(abspath, "r", encoding="utf-8", errors="ignore") as f:
            return f.read(MAX_READ_BYTES)
    except Exception:
        return ""


def _build_tree(rels: List[str]) -> str:
    shown = rels[:250]
    tree = "\n".join(shown)
    if len(rels) > len(shown):
        tree += f"\n... (+{len(rels) - len(shown)} more files)"
    return tree


def _build_digest(root: str, rels: List[str]) -> str:
    parts: List[str] = []
    readme = next((r for r in rels if r.lower().split("/")[-1].startswith("readme")), None)
    if readme:
        parts.append(f"=== README ({readme}) ===\n{_read_text(os.path.join(root, readme))[:4000]}")
    manifests = [
        "package.json", "requirements.txt", "pyproject.toml", "setup.py", "go.mod",
        "cargo.toml", "pom.xml", "build.gradle", "composer.json", "gemfile",
    ]
    for m in manifests:
        match = next((r for r in rels if r.lower().split("/")[-1] == m), None)
        if match:
            parts.append(f"=== {match} ===\n{_read_text(os.path.join(root, match))[:1500]}")
    return "\n\n".join(parts)


def _index_project(root: str, name: str, source: str) -> Dict[str, Any]:
    files: List[str] = []
    for dirpath, dirnames, filenames in os.walk(root):
        # prune skip dirs in-place so os.walk doesn't descend into them
        dirnames[:] = [d for d in dirnames if d not in PROJECT_SKIP_DIRS]
        for fn in filenames:
            if _looks_like_text(fn):
                rel = os.path.relpath(os.path.join(dirpath, fn), root).replace("\\", "/")
                files.append(rel)
    # shallow paths first, then alphabetical; then cap
    files.sort(key=lambda r: (r.count("/"), r.lower()))
    files = files[:MAX_INDEX_FILES]
    PROJECT.update({
        "name": name,
        "root": root,
        "source": source,
        "files": files,
        "tree": _build_tree(files),
        "digest": _build_digest(root, files),
    })
    logger.info(f"Indexed project '{name}' ({len(files)} text files) from {source}")
    return PROJECT


def _project_summary() -> Dict[str, Any]:
    return {
        "loaded": PROJECT["root"] is not None,
        "name": PROJECT["name"],
        "source": PROJECT["source"],
        "file_count": len(PROJECT["files"]),
        "tree": PROJECT["tree"][:4000],
    }


def _project_context(turn: int) -> str:
    """Build the review context for a given turn: the always-present digest plus a
    rotating window of file excerpts so the whole project gets covered over time."""
    if not PROJECT["root"]:
        return ""
    rels = PROJECT["files"]
    header = (
        f"You are reviewing a real software project called '{PROJECT['name']}' "
        f"(source: {PROJECT['source']}).\n\n"
        f"PROJECT FILE LIST ({len(rels)} files):\n{PROJECT['tree']}\n\n"
        f"PROJECT DIGEST:\n{PROJECT['digest']}\n\n"
    )
    excerpts: List[str] = []
    if rels:
        n = len(rels)
        start = (turn * PROJECT_FILES_PER_TURN) % n
        seen = set()
        for i in range(min(PROJECT_FILES_PER_TURN, n)):
            rel = rels[(start + i) % n]
            if rel in seen:
                continue
            seen.add(rel)
            content = _read_text(os.path.join(PROJECT["root"], rel))[:PROJECT_EXCERPT_LEN]
            excerpts.append(f"----- FILE: {rel} -----\n{content}")
    return header + "FILES TO FOCUS ON THIS TURN:\n" + "\n\n".join(excerpts)


def _safe_extract_zip(data: bytes, dest: str) -> None:
    """Extract a zip while guarding against path-traversal (zip-slip)."""
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        dest_abs = os.path.abspath(dest)
        for member in zf.infolist():
            target = os.path.abspath(os.path.join(dest, member.filename))
            if not (target == dest_abs or target.startswith(dest_abs + os.sep)):
                continue  # skip entries that would escape the destination
            if member.is_dir():
                os.makedirs(target, exist_ok=True)
            else:
                os.makedirs(os.path.dirname(target), exist_ok=True)
                with zf.open(member) as src, open(target, "wb") as out:
                    shutil.copyfileobj(src, out)


def _collapse_single_root(dest: str) -> str:
    """If an extracted archive contains exactly one top-level folder (the usual
    GitHub zip layout), treat that folder as the project root."""
    try:
        entries = [e for e in os.listdir(dest) if not e.startswith("__MACOSX")]
    except OSError:
        return dest
    if len(entries) == 1 and os.path.isdir(os.path.join(dest, entries[0])):
        return os.path.join(dest, entries[0])
    return dest

# Create directories and clean audio cache on startup
@app.on_event("startup")
async def startup_event():
    os.makedirs(STATIC_DIR, exist_ok=True)
    os.makedirs(AUDIO_DIR, exist_ok=True)
    
    # Clear previous audio cache to save space
    try:
        count = 0
        for filename in os.listdir(AUDIO_DIR):
            file_path = os.path.join(AUDIO_DIR, filename)
            if os.path.isfile(file_path) and filename.endswith(".mp3"):
                os.remove(file_path)
                count += 1
        logger.info(f"Cleaned up {count} cached audio files on startup.")
    except Exception as e:
        logger.error(f"Error cleaning up audio cache: {e}")

# Pydantic models for chat requests
class Message(BaseModel):
    sender: str  # Name of the speaker (e.g. "Einstein", "User")
    content: str
    is_user: bool  # True if it's the real human user speaking

class ChatRequest(BaseModel):
    model: str
    persona_name: str
    system_prompt: str
    other_participants: List[str]
    messages: List[Message]
    voice: Optional[str] = None
    temperature: float = 0.7
    extract_tasks: bool = False   # when true, run the task-extraction pass on the reply

class NarrateRequest(BaseModel):
    model: str
    character: str               # who the stage direction is about
    phase: str                   # "before" (leading into their line) or "after" (their reaction)
    topic: str = ""
    participants: List[str] = []
    messages: List[Message] = []
    voice: Optional[str] = None
    temperature: float = 0.85

def clean_text_for_tts(text: str) -> str:
    """Prepares text for speech synthesis. Markdown emphasis markers are stripped
    but the emphasized WORDS are kept and spoken (so *word* is read as "word", not
    skipped). Bracketed meta annotations like [thoughtful] are dropped."""
    # Keep the words inside markdown emphasis, just drop the markers.
    text = re.sub(r'\*\*([^*]+)\*\*', r'\1', text)   # **bold**   -> bold
    text = re.sub(r'\*([^*]+)\*', r'\1', text)         # *italic*   -> italic
    # Underscore emphasis only at word boundaries, so snake_case identifiers
    # (e.g. clean_text_for_tts) are left untouched.
    text = re.sub(r'(?<!\w)__([^_]+)__(?!\w)', r'\1', text)   # __bold__
    text = re.sub(r'(?<!\w)_([^_]+)_(?!\w)', r'\1', text)     # _italic_
    # Bracketed meta like [thoughtful] / [pause] is non-spoken; remove it.
    text = re.sub(r'\[[^\]]+\]', '', text)
    # Collapse any leftover stray markers and whitespace.
    text = text.replace('*', '').strip()
    text = re.sub(r'\s+', ' ', text).strip()
    return text

@app.get("/api/models")
async def get_models():
    """Fetches available local models from Ollama."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{OLLAMA_URL}/api/tags")
            if response.status_code == 200:
                data = response.json()
                models = [model["name"] for model in data.get("models", [])]
                return {"models": models}
            else:
                raise HTTPException(status_code=500, detail="Failed to connect to local Ollama server.")
    except Exception as e:
        logger.error(f"Error fetching Ollama models: {e}")
        # Return empty list or error so frontend can show helpful warning
        return JSONResponse(
            status_code=503,
            content={"detail": "Ollama server not running or unreachable at http://localhost:11434. Make sure Ollama is open."}
        )

@app.get("/api/voices")
async def get_voices():
    """Fetches all Edge TTS voices."""
    try:
        voices_manager = await edge_tts.VoicesManager.create()
        # Extract voices data
        voices = voices_manager.voices
        return {"voices": voices}
    except Exception as e:
        logger.error(f"Error fetching Edge TTS voices: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch voices: {str(e)}")

@app.post("/api/chat")
async def chat_turn(req: ChatRequest):
    """Processes a single chat turn for a persona using Ollama and synthesizes voice with Edge TTS."""
    # 1. Construct the tailored system prompt
    # List other participants in the room
    others_str = ", ".join(req.other_participants) if req.other_participants else "none"
    full_system_prompt = (
        f"You are {req.persona_name}. {req.system_prompt.strip()}\n\n"
        f"You are participating in a group discussion. The other participants present in the room are: {others_str}.\n"
        f"The moderator/host of this discussion is the human 'User'.\n"
        f"When 'User' speaks, address them as the moderator or host. "
        f"Keep your responses natural, in-character, and concise (typically 2-4 sentences). Do not repeat yourself. "
        f"Do not prefix your response with your name or any label like '{req.persona_name}:'. Just speak your lines directly."
    )

    # 2. Format the message history for Ollama's chat API
    # We map the speaker's own past messages to "assistant", and everyone else's messages (prefixed with sender name) to "user".
    ollama_messages = [{"role": "system", "content": full_system_prompt}]
    
    for msg in req.messages:
        if msg.sender == req.persona_name:
            # Current persona's own history
            ollama_messages.append({"role": "assistant", "content": msg.content})
        else:
            # Someone else's history (prefix with sender name so the persona knows who said it)
            prefix = "User" if msg.is_user else msg.sender
            ollama_messages.append({"role": "user", "content": f"{prefix}: {msg.content}"})

    # Add a final user instruction to nudge Ollama to speak in character
    ollama_messages.append({
        "role": "user", 
        "content": f"It is your turn to speak now, {req.persona_name}. Respond to the discussion in character."
    })

    # 3. Call Ollama
    response_text = ""
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            ollama_payload = {
                "model": req.model,
                "messages": ollama_messages,
                "options": {
                    "temperature": req.temperature,
                },
                "stream": False
            }
            logger.info(f"Sending request to Ollama for persona '{req.persona_name}' using model '{req.model}'")
            res = await client.post(f"{OLLAMA_URL}/api/chat", json=ollama_payload)
            if res.status_code == 200:
                result = res.json()
                response_text = result.get("message", {}).get("content", "").strip()
            else:
                raise HTTPException(status_code=res.status_code, detail=f"Ollama returned error: {res.text}")
    except httpx.RequestError as e:
        logger.error(f"HTTP request to Ollama failed: {e}")
        raise HTTPException(status_code=503, detail="Ollama server connection failed. Please ensure Ollama is running.")
    except Exception as e:
        logger.error(f"Ollama chat error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    # Strip out leading persona name tags if the LLM outputted them anyway (e.g. "Socrates: Hello" -> "Hello")
    name_prefix_pattern = re.compile(rf"^\s*{re.escape(req.persona_name)}\s*:\s*", re.IGNORECASE)
    response_text = name_prefix_pattern.sub("", response_text).strip()
    # Strip wrapping quotes if the model wrapped its entire response in quotes
    if response_text.startswith('"') and response_text.endswith('"') and len(response_text) > 1:
        response_text = response_text[1:-1].strip()

    # 4. Generate TTS audio if voice is selected
    audio_url = None
    if req.voice and response_text:
        # Clean text for TTS (remove actions in asterisks, thoughts, etc.)
        tts_text = clean_text_for_tts(response_text)
        
        if tts_text:
            try:
                audio_filename = f"{uuid.uuid4()}.mp3"
                audio_path = os.path.join(AUDIO_DIR, audio_filename)
                
                logger.info(f"Generating TTS for '{req.persona_name}' using voice '{req.voice}'")
                communicate = edge_tts.Communicate(tts_text, req.voice)
                await communicate.save(audio_path)
                
                audio_url = f"/static/audio/{audio_filename}"
            except Exception as e:
                logger.error(f"Edge TTS synthesis failed: {e}")
                # We don't fail the chat generation if only TTS fails, just continue without audio
                audio_url = None

    # Task extraction hook (decoupled layer). Best-effort: never breaks chat.
    extracted = []
    if req.extract_tasks and response_text:
        try:
            extracted = tasks.extract_from_text(response_text, req.persona_name)
        except Exception as e:
            logger.error(f"Task extraction failed: {e}")

    return {
        "persona_name": req.persona_name,
        "text": response_text,
        "audio_url": audio_url,
        "extracted_tasks": extracted,
    }

@app.post("/api/narrate")
async def narrate_turn(req: NarrateRequest):
    """Produces a single third-person stage direction (Story Mode narrator) and
    synthesizes it with the narrator voice. Used before and after each character
    speaks to give the discussion a screenplay/stage feel."""
    others = ", ".join(req.participants) if req.participants else "the others in the room"

    if req.phase == "before":
        phase_instruction = (
            f"Describe what {req.character} physically does right now as they take focus and prepare to speak — "
            f"their movement, posture, expression, or where they direct their attention — reacting to the moment that just occurred."
        )
    else:
        phase_instruction = (
            f"Describe {req.character}'s physical reaction, body language, or gesture in the beat immediately after they finished speaking."
        )

    system_prompt = (
        "You are the Narrator and stage director of an unfolding scene, like the directions in a screenplay. "
        "You NEVER speak any character's dialogue and you NEVER use quotation marks. "
        "You write ONLY third-person, present-tense physical stage directions: movement, posture, facial expressions, glances, and blocking. "
        "Do not narrate inner thoughts or speech — only observable action. "
        f"The scene revolves around: \"{req.topic}\". The characters present are: {others}, and {req.character}. "
        "Keep it to ONE concise, cinematic sentence (two at most). "
        + phase_instruction
    )

    ollama_messages = [{"role": "system", "content": system_prompt}]
    for msg in req.messages:
        prefix = "User" if msg.is_user else msg.sender
        ollama_messages.append({"role": "user", "content": f"{prefix}: {msg.content}"})
    ollama_messages.append({
        "role": "user",
        "content": f"Write the stage direction for {req.character} now. Output only the stage direction itself — no name label, no quotation marks."
    })

    narration_text = ""
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            payload = {
                "model": req.model,
                "messages": ollama_messages,
                "options": {"temperature": req.temperature},
                "stream": False,
            }
            logger.info(f"Narrating '{req.phase}' beat for '{req.character}' using model '{req.model}'")
            res = await client.post(f"{OLLAMA_URL}/api/chat", json=payload)
            if res.status_code == 200:
                narration_text = res.json().get("message", {}).get("content", "").strip()
            else:
                raise HTTPException(status_code=res.status_code, detail=f"Ollama returned error: {res.text}")
    except httpx.RequestError as e:
        logger.error(f"Narration request to Ollama failed: {e}")
        raise HTTPException(status_code=503, detail="Ollama server connection failed.")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Narration error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    # Clean up: strip wrapping quotes/asterisks the model may add around directions.
    narration_text = narration_text.strip().strip('*').strip()
    if len(narration_text) > 1 and narration_text.startswith('"') and narration_text.endswith('"'):
        narration_text = narration_text[1:-1].strip()

    # Synthesize the narrator's voice.
    audio_url = None
    if req.voice and narration_text:
        tts_text = clean_text_for_tts(narration_text)
        if tts_text:
            try:
                audio_filename = f"narr_{uuid.uuid4()}.mp3"
                audio_path = os.path.join(AUDIO_DIR, audio_filename)
                communicate = edge_tts.Communicate(tts_text, req.voice)
                await communicate.save(audio_path)
                audio_url = f"/static/audio/{audio_filename}"
            except Exception as e:
                logger.error(f"Narrator TTS synthesis failed: {e}")
                audio_url = None

    return {"text": narration_text, "audio_url": audio_url}

@app.post("/api/tts")
async def generate_tts(text: str, voice: str):
    """Synthesizes text on-demand and returns the audio path (useful for voice testing)."""
    try:
        tts_text = clean_text_for_tts(text)
        if not tts_text:
            raise HTTPException(status_code=400, detail="No speakable text provided.")
            
        audio_filename = f"preview_{uuid.uuid4()}.mp3"
        audio_path = os.path.join(AUDIO_DIR, audio_filename)
        
        communicate = edge_tts.Communicate(tts_text, voice)
        await communicate.save(audio_path)
        
        return {"audio_url": f"/static/audio/{audio_filename}"}
    except Exception as e:
        logger.error(f"TTS Preview failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ---------------------------------------------------------------------------
# Project Mode endpoints
# ---------------------------------------------------------------------------
@app.post("/api/project/load_repo")
async def project_load_repo(payload: Dict[str, Any]):
    """Clone a public GitHub (or any git) repository into the workspace and index it."""
    repo_url = (payload.get("repo_url") or "").strip()
    if not repo_url:
        raise HTTPException(status_code=400, detail="repo_url is required.")
    if not re.match(r'^(https?://|git@)[\w.@:/\-~]+$', repo_url):
        raise HTTPException(status_code=400, detail="That doesn't look like a valid repository URL.")

    os.makedirs(WORKSPACE_DIR, exist_ok=True)
    name = re.sub(r'\.git$', '', repo_url.rstrip("/").split("/")[-1]) or "repo"
    name = re.sub(r'[^A-Za-z0-9_.-]', '_', name)
    dest = os.path.join(WORKSPACE_DIR, name)
    if os.path.exists(dest):
        shutil.rmtree(dest, ignore_errors=True)

    try:
        proc = await asyncio.create_subprocess_exec(
            "git", "clone", "--depth", "1", repo_url, dest,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        try:
            _, stderr = await asyncio.wait_for(proc.communicate(), timeout=180)
        except asyncio.TimeoutError:
            proc.kill()
            raise HTTPException(status_code=504, detail="Cloning timed out after 3 minutes.")
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="git is not installed on the server.")

    if proc.returncode != 0:
        detail = stderr.decode(errors="ignore").strip()[:300] if stderr else "unknown error"
        raise HTTPException(status_code=400, detail=f"git clone failed: {detail}")

    _index_project(dest, name, f"GitHub repo {repo_url}")
    return _project_summary()


@app.post("/api/project/upload")
async def project_upload(files: List[UploadFile] = File(...)):
    """Ingest an uploaded project: a single .zip is extracted; otherwise the files
    are saved side by side. Then the result is indexed for review."""
    os.makedirs(WORKSPACE_DIR, exist_ok=True)

    if len(files) == 1 and files[0].filename and files[0].filename.lower().endswith(".zip"):
        base = os.path.splitext(os.path.basename(files[0].filename))[0]
        name = re.sub(r'[^A-Za-z0-9_.-]', '_', base) or "upload"
        dest = os.path.join(WORKSPACE_DIR, name)
        if os.path.exists(dest):
            shutil.rmtree(dest, ignore_errors=True)
        os.makedirs(dest, exist_ok=True)
        try:
            _safe_extract_zip(await files[0].read(), dest)
        except zipfile.BadZipFile:
            raise HTTPException(status_code=400, detail="That file isn't a valid .zip archive.")
        root = _collapse_single_root(dest)
        _index_project(root, name, f"uploaded zip {files[0].filename}")
    else:
        name = "uploaded_files"
        dest = os.path.join(WORKSPACE_DIR, name)
        if os.path.exists(dest):
            shutil.rmtree(dest, ignore_errors=True)
        os.makedirs(dest, exist_ok=True)
        for uf in files:
            safe = os.path.basename(uf.filename or "file")
            if not safe:
                continue
            with open(os.path.join(dest, safe), "wb") as out:
                out.write(await uf.read())
        _index_project(dest, name, f"{len(files)} uploaded file(s)")

    return _project_summary()


@app.get("/api/project/status")
async def project_status():
    return _project_summary()


@app.post("/api/project/clear")
async def project_clear():
    PROJECT.update({"name": None, "root": None, "source": None, "files": [], "tree": "", "digest": ""})
    return {"loaded": False}


@app.get("/api/project/context")
async def project_context(turn: int = 0):
    """Returns the rotating review context (digest + a window of file excerpts)."""
    return {"context": _project_context(turn), "loaded": PROJECT["root"] is not None}


# Serve UI Static Files
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/")
async def read_index():
    """Serves the index.html landing page."""
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return HTMLResponse(content="<h1>Frontend index.html not found yet. Please wait.</h1>", status_code=404)
