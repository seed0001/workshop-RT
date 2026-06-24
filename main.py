import os
import re
import uuid
import shutil
import logging
import asyncio
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
import httpx
import edge_tts

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

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
AUDIO_DIR = os.path.join(STATIC_DIR, "audio")

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
    """Removes text in asterisks, underscores, or brackets (actions/thoughts) for speech synthesis."""
    # Remove asterisks and text between them: *chuckles* -> ""
    text = re.sub(r'\*[^*]+\*', '', text)
    # Remove underscores and text between them: _sighs_ -> ""
    text = re.sub(r'_[^_]+_', '', text)
    # Remove brackets and text between them: [thoughtful] -> ""
    text = re.sub(r'\[[^\]]+\]', '', text)
    # Clean up multiple spaces
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

    return {
        "persona_name": req.persona_name,
        "text": response_text,
        "audio_url": audio_url
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

# Serve UI Static Files
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/")
async def read_index():
    """Serves the index.html landing page."""
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return HTMLResponse(content="<h1>Frontend index.html not found yet. Please wait.</h1>", status_code=404)
