// Aether Workshop: Frontend Application Logic

// Application State
const state = {
    personas: [],
    models: [],
    voices: [],
    chatHistory: [],
    isRunning: false,
    currentSpeakerIndex: -1,
    audioPlaying: false,
    editingPersonaId: null,
    lastTopic: null,
    consecutiveErrors: 0,
};

// How many recent messages to send to the model each turn. Keeps requests
// bounded so the crew can keep talking for hours without the context blowing
// up and timing out. The full transcript still lives in the UI.
const HISTORY_WINDOW = 24;
// Pause the session only after this many failures in a row (lets transient
// Ollama hiccups self-heal instead of killing an hours-long run).
const MAX_CONSECUTIVE_ERRORS = 5;

// DOM Elements
const ollamaStatusEl = document.getElementById("ollama-status");
const voicesStatusEl = document.getElementById("voices-status");
const modelSelect = document.getElementById("persona-model");
const voiceSelect = document.getElementById("persona-voice");
const voiceSearchInput = document.getElementById("voice-search");
const voiceGenderFilter = document.getElementById("voice-gender-filter");
const previewVoiceBtn = document.getElementById("preview-voice-btn");
const personaForm = document.getElementById("persona-form");
const personasListEl = document.getElementById("personas-list");
const personaCountEl = document.getElementById("persona-count");
const chatTopicInput = document.getElementById("chat-topic");
const turnTakingModeSelect = document.getElementById("turn-taking-mode");
const startBtn = document.getElementById("start-btn");
const pauseBtn = document.getElementById("pause-btn");
const stepBtn = document.getElementById("step-btn");
const clearBtn = document.getElementById("clear-btn");
const activeSpeakerStatusEl = document.getElementById("active-speaker-status");
const chatFeedEl = document.getElementById("chat-feed");
const userMessageInput = document.getElementById("user-message-input");
const sendUserMsgBtn = document.getElementById("send-user-msg-btn");
const globalAudio = document.getElementById("global-tts-audio");
const previewAudio = document.getElementById("preview-tts-audio");
const formToggleBtn = document.getElementById("form-toggle-btn");
const formCard = document.querySelector(".form-card");

// Prebuilt Presets Configuration
const PRESETS = {
    ceo: {
        name: "CEO",
        emoji: "👔",
        color: "#6366f1",
        gender: "Male",
        prompt: "You are the Chief Executive Officer of the company. You are a decisive, big-picture visionary focused on strategy, growth, shareholder value, and the long-term mission. You set direction, push for bold bets, and hold the team accountable to results. You speak with confident, executive authority and steer the conversation toward outcomes. Keep your responses short (2-3 sentences max).",
        voice: "en-US-GuyNeural",
        temp: 0.7
    },
    cfo: {
        name: "CFO",
        emoji: "💰",
        color: "#10b981",
        gender: "Female",
        prompt: "You are the Chief Financial Officer. You are analytical, prudent, and detail-oriented, always anchoring the discussion to budgets, margins, cash flow, ROI, and risk. You ask 'what does this cost and what's the return?' and push back on spending that isn't justified by the numbers. You speak precisely and calmly. Keep your responses short (2-3 sentences max).",
        voice: "en-US-AriaNeural",
        temp: 0.6
    },
    cto: {
        name: "CTO",
        emoji: "🖥️",
        color: "#3b82f6",
        gender: "Male",
        prompt: "You are the Chief Technology Officer. You think in terms of architecture, scalability, technical debt, security, and what is actually buildable. You translate business goals into engineering reality and flag feasibility concerns early. You are pragmatic and forward-looking about technology and innovation. Keep your responses short (2-3 sentences max).",
        voice: "en-US-AndrewNeural",
        temp: 0.7
    },
    cmo: {
        name: "CMO",
        emoji: "📣",
        color: "#ec4899",
        gender: "Female",
        prompt: "You are the Chief Marketing Officer. You are energetic, brand-obsessed, and customer-focused, thinking constantly about positioning, messaging, audience, and market trends. You champion the story and the customer's perspective in every decision. You speak with enthusiasm and persuasion. Keep your responses short (2-3 sentences max).",
        voice: "en-US-JennyNeural",
        temp: 0.85
    },
    coo: {
        name: "COO",
        emoji: "⚙️",
        color: "#f59e0b",
        gender: "Male",
        prompt: "You are the Chief Operating Officer. You are the execution engine of the company, focused on process, logistics, timelines, and getting things done efficiently. You turn strategy into concrete plans, owners, and deadlines, and you spot operational bottlenecks. You are practical and no-nonsense. Keep your responses short (2-3 sentences max).",
        voice: "en-US-EricNeural",
        temp: 0.6
    },
    hr: {
        name: "HR Director",
        emoji: "🤝",
        color: "#14b8a6",
        gender: "Female",
        prompt: "You are the Director of Human Resources. You focus on people, culture, hiring, morale, and policy compliance. You advocate for the team's wellbeing and make sure decisions are fair, legal, and good for employee retention. You are warm but professional, and you raise the human impact of any decision. Keep your responses short (2-3 sentences max).",
        voice: "en-US-MichelleNeural",
        temp: 0.7
    },
    legal: {
        name: "Legal Counsel",
        emoji: "⚖️",
        color: "#64748b",
        gender: "Male",
        prompt: "You are the company's General Counsel. You evaluate every decision through the lens of legal risk, compliance, contracts, liability, and intellectual property. You are careful and measured, flagging exposure and recommending safeguards without killing momentum unnecessarily. You speak with precise, cautious authority. Keep your responses short (2-3 sentences max).",
        voice: "en-US-RogerNeural",
        temp: 0.5
    },
    sales: {
        name: "Sales Director",
        emoji: "📈",
        color: "#ef4444",
        gender: "Male",
        prompt: "You are the Director of Sales. You are driven, persuasive, and relentlessly focused on closing deals, hitting quota, and growing the pipeline. You think about the customer relationship, objections, and revenue, and you push to turn ideas into signed contracts. You speak with energy and confidence. Keep your responses short (2-3 sentences max).",
        voice: "en-US-BrianNeural",
        temp: 0.8
    },
    support: {
        name: "Tech Support",
        emoji: "🛠️",
        color: "#06b6d4",
        gender: "Male",
        prompt: "You are a Tech Support specialist on the help desk. You are patient, friendly, and methodical, focused on diagnosing problems, walking people through fixes step by step, and keeping systems running. You ask clarifying questions and explain technical things in plain language. Keep your responses short (2-3 sentences max).",
        voice: "en-GB-RyanNeural",
        temp: 0.6
    }
};

// Initialize Application
window.addEventListener("DOMContentLoaded", async () => {
    setupFormCollapsible();
    setupEventListeners();
    await fetchOllamaModels();
    await fetchVoices();
    loadLocalPersonas();
    updateControlsStatus();
});

// Setup Form Collapse
function setupFormCollapsible() {
    formToggleBtn.addEventListener("click", () => {
        formCard.classList.toggle("collapsed");
    });
}

// Fetch Ollama Models
async function fetchOllamaModels() {
    try {
        const response = await fetch("/api/models");
        const statusText = ollamaStatusEl.querySelector(".status-text");
        
        if (response.ok) {
            const data = await response.json();
            state.models = data.models;
            
            // Populate dropdown
            modelSelect.innerHTML = "";
            if (state.models.length === 0) {
                modelSelect.innerHTML = '<option value="" disabled selected>No models found in Ollama!</option>';
                setIndicatorStatus(ollamaStatusEl, "warning", "Ollama: No Models");
            } else {
                state.models.forEach(model => {
                    const option = document.createElement("option");
                    option.value = model;
                    option.textContent = model;
                    modelSelect.appendChild(option);
                });
                
                // Select smart default model if present
                const preferredModels = ["qwen2.5:7b-instruct", "llama3.2:latest", "llama3:latest", "gemma:latest"];
                let selected = false;
                for (const pref of preferredModels) {
                    if (state.models.includes(pref)) {
                        modelSelect.value = pref;
                        selected = true;
                        break;
                    }
                }
                if (!selected && state.models.length > 0) {
                    modelSelect.value = state.models[0];
                }
                setIndicatorStatus(ollamaStatusEl, "success", "Ollama: Connected");
            }
        } else {
            const errData = await response.json();
            throw new Error(errData.detail || "Server error");
        }
    } catch (error) {
        console.error("Error fetching Ollama models:", error);
        setIndicatorStatus(ollamaStatusEl, "error", "Ollama: Offline");
        modelSelect.innerHTML = '<option value="" disabled selected>Error connecting to Ollama server</option>';
    }
}

// Fetch Edge TTS Voices
async function fetchVoices() {
    try {
        const response = await fetch("/api/voices");
        if (response.ok) {
            const data = await response.json();
            state.voices = data.voices;
            setIndicatorStatus(voicesStatusEl, "success", "Voices: Connected");
            filterAndPopulateVoices();
        } else {
            throw new Error("Failed to load voices");
        }
    } catch (error) {
        console.error("Error fetching voices:", error);
        setIndicatorStatus(voicesStatusEl, "error", "Voices: Offline");
        voiceSelect.innerHTML = '<option value="" disabled selected>Error loading voices</option>';
    }
}

// Filter and Populate Voices Select Element
function filterAndPopulateVoices() {
    const search = voiceSearchInput.value.toLowerCase();
    const gender = voiceGenderFilter.value;
    
    // Filter voices
    const filtered = state.voices.filter(v => {
        const nameMatches = v.FriendlyName.toLowerCase().includes(search) || 
                            v.ShortName.toLowerCase().includes(search) ||
                            v.Locale.toLowerCase().includes(search);
        const genderMatches = gender === "All" || v.Gender === gender;
        
        // Prioritize English/common languages if search is empty
        if (!search) {
            return genderMatches && (v.Language.startsWith("en") || v.Language.startsWith("es") || v.Language.startsWith("fr") || v.Language.startsWith("de"));
        }
        return nameMatches && genderMatches;
    });

    voiceSelect.innerHTML = "";
    if (filtered.length === 0) {
        voiceSelect.innerHTML = '<option value="" disabled selected>No matching voices found</option>';
        return;
    }

    // Sort: English first, then alphabetical
    filtered.sort((a, b) => {
        const aIsEn = a.Language.startsWith("en");
        const bIsEn = b.Language.startsWith("en");
        if (aIsEn && !bIsEn) return -1;
        if (!aIsEn && bIsEn) return 1;
        return a.FriendlyName.localeCompare(b.FriendlyName);
    });

    filtered.forEach(v => {
        const option = document.createElement("option");
        option.value = v.ShortName;
        option.textContent = `${v.FriendlyName} (${v.Gender})`;
        voiceSelect.appendChild(option);
    });

    // Default select a neural voice
    const defaultVoice = filtered.find(v => v.ShortName.includes("en-US-GuyNeural") || v.ShortName.includes("en-US-BrianNeural"));
    if (defaultVoice) {
        voiceSelect.value = defaultVoice.ShortName;
    } else if (filtered.length > 0) {
        voiceSelect.value = filtered[0].ShortName;
    }
}

// Helper to set header status indicators
function setIndicatorStatus(el, status, text) {
    el.className = `status-indicator ${status}`;
    el.querySelector(".status-text").textContent = text;
}

// Local Persona Storage Management
function loadLocalPersonas() {
    const saved = localStorage.getItem("aether_workshop_personas");
    if (saved) {
        try {
            state.personas = JSON.parse(saved);
        } catch (e) {
            console.error("Failed to parse saved personas:", e);
            state.personas = [];
        }
    } else {
        // Load default presets to make the workshop immediately active and impressive!
        state.personas = [
            {
                id: "ceo_default",
                name: PRESETS.ceo.name,
                emoji: PRESETS.ceo.emoji,
                color: PRESETS.ceo.color,
                model: modelSelect.value || "llama3.2:latest",
                voice: "en-US-GuyNeural",
                prompt: PRESETS.ceo.prompt,
                temp: PRESETS.ceo.temp
            },
            {
                id: "cfo_default",
                name: PRESETS.cfo.name,
                emoji: PRESETS.cfo.emoji,
                color: PRESETS.cfo.color,
                model: modelSelect.value || "llama3.2:latest",
                voice: "en-US-AriaNeural",
                prompt: PRESETS.cfo.prompt,
                temp: PRESETS.cfo.temp
            },
            {
                id: "cto_default",
                name: PRESETS.cto.name,
                emoji: PRESETS.cto.emoji,
                color: PRESETS.cto.color,
                model: modelSelect.value || "llama3.2:latest",
                voice: "en-US-AndrewNeural",
                prompt: PRESETS.cto.prompt,
                temp: PRESETS.cto.temp
            }
        ];
        savePersonasToStorage();
    }
    updatePersonaListUI();
}

function savePersonasToStorage() {
    localStorage.setItem("aether_workshop_personas", JSON.stringify(state.personas));
}

// Update Persona List UI
function updatePersonaListUI() {
    personasListEl.innerHTML = "";
    personaCountEl.textContent = state.personas.length;

    if (state.personas.length === 0) {
        personasListEl.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-people-arrows"></i>
                <p>No personas created yet.</p>
                <p class="sub-text">Add your first persona or click a preset above to begin!</p>
            </div>
        `;
        return;
    }

    state.personas.forEach(p => {
        const card = document.createElement("div");
        card.className = "persona-card";
        card.id = `persona-card-${p.id}`;
        card.style.setProperty("--border-color-active", p.color);
        card.style.setProperty("--glow-active", `${p.color}35`);
        
        // Avatar element
        const avatar = document.createElement("div");
        avatar.className = "persona-avatar";
        avatar.style.backgroundColor = `${p.color}20`;
        avatar.style.border = `2px solid ${p.color}`;
        avatar.style.color = p.color;
        avatar.textContent = p.emoji || "🤖";

        const details = document.createElement("div");
        details.className = "persona-details";
        
        const name = document.createElement("div");
        name.className = "persona-card-name";
        name.textContent = p.name;

        // Wave animation container (hidden by default, shown when active speaker class is added)
        const waveform = document.createElement("div");
        waveform.className = "waveform-container hidden";
        waveform.style.setProperty("--speaker-glow-color", p.color);
        for(let i=0; i<4; i++) {
            const bar = document.createElement("span");
            bar.className = "wave-bar";
            waveform.appendChild(bar);
        }
        name.appendChild(waveform);

        const meta = document.createElement("div");
        meta.className = "persona-card-meta";
        meta.innerHTML = `Model: <span>${p.model}</span> • Voice: <span>${p.voice.split("-").slice(2).join("") || p.voice}</span>`;

        details.appendChild(name);
        details.appendChild(meta);

        // Actions
        const actions = document.createElement("div");
        actions.className = "persona-card-actions";

        const editBtn = document.createElement("button");
        editBtn.className = "action-btn";
        editBtn.innerHTML = '<i class="fa-solid fa-pen-to-square"></i>';
        editBtn.title = "Edit Persona";
        editBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            editPersona(p.id);
        });

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "action-btn delete-btn";
        deleteBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
        deleteBtn.title = "Delete Persona";
        deleteBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            deletePersona(p.id);
        });

        actions.appendChild(editBtn);
        actions.appendChild(deleteBtn);

        card.appendChild(avatar);
        card.appendChild(details);
        card.appendChild(actions);

        // If turn mode is manual, clicking the card triggers them to speak!
        card.addEventListener("click", () => {
            if (turnTakingModeSelect.value === "manual" && !state.audioPlaying && !state.isRunning) {
                speakManualTurn(p);
            }
        });

        personasListEl.appendChild(card);
    });
}

// Edit Persona
function editPersona(id) {
    const p = state.personas.find(persona => persona.id === id);
    if (!p) return;

    // Fill form
    state.editingPersonaId = id;
    document.getElementById("persona-id").value = p.id;
    document.getElementById("persona-name").value = p.name;
    document.getElementById("persona-avatar-emoji").value = p.emoji;
    document.getElementById("persona-avatar-color").value = p.color;
    document.getElementById("persona-prompt").value = p.prompt;
    document.getElementById("persona-temp").value = p.temp;
    document.getElementById("temp-val").textContent = p.temp;
    
    // Ensure model exists, if not add it dynamically
    if (!state.models.includes(p.model)) {
        const option = document.createElement("option");
        option.value = p.model;
        option.textContent = p.model;
        modelSelect.appendChild(option);
    }
    modelSelect.value = p.model;

    // Ensure voice exists
    voiceSelect.value = p.voice;

    // Update form header
    document.getElementById("form-title").innerHTML = `<i class="fa-solid fa-user-pen"></i> Edit Persona: ${p.name}`;
    document.getElementById("save-persona-btn").innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Update Persona';
    document.getElementById("cancel-edit-btn").classList.remove("hidden");

    // Open form if collapsed
    formCard.classList.remove("collapsed");
    document.getElementById("persona-name").focus();
}

// Cancel Edit Mode
function resetForm() {
    state.editingPersonaId = null;
    personaForm.reset();
    document.getElementById("persona-id").value = "";
    document.getElementById("form-title").innerHTML = '<i class="fa-solid fa-user-plus"></i> Create New Persona';
    document.getElementById("save-persona-btn").innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Persona';
    document.getElementById("cancel-edit-btn").classList.add("hidden");
    
    // Set sliders back
    document.getElementById("persona-temp").value = 0.7;
    document.getElementById("temp-val").textContent = "0.7";
}

// Delete Persona
function deletePersona(id) {
    state.personas = state.personas.filter(p => p.id !== id);
    savePersonasToStorage();
    updatePersonaListUI();
    updateControlsStatus();
    if (state.editingPersonaId === id) {
        resetForm();
    }
}

// Enable/Disable Controls
function updateControlsStatus() {
    const hasEnoughPersonas = state.personas.length >= 2;
    startBtn.disabled = !hasEnoughPersonas;
    stepBtn.disabled = !hasEnoughPersonas;
    
    const statusMsgEl = activeSpeakerStatusEl.querySelector(".status-msg");
    if (hasEnoughPersonas) {
        if (!state.isRunning) {
            statusMsgEl.textContent = "Workshop ready. Click Start to begin debate.";
        }
    } else {
        statusMsgEl.textContent = "Add at least two personas to start debating";
        pauseDiscussion();
    }
}

// Setup All UI Event Handlers
function setupEventListeners() {
    // Form submit
    personaForm.addEventListener("submit", (e) => {
        e.preventDefault();
        
        const name = document.getElementById("persona-name").value.strip ? document.getElementById("persona-name").value.strip() : document.getElementById("persona-name").value.trim();
        const emoji = document.getElementById("persona-avatar-emoji").value.trim();
        const color = document.getElementById("persona-avatar-color").value;
        const model = modelSelect.value;
        const voice = voiceSelect.value;
        const prompt = document.getElementById("persona-prompt").value.trim();
        const temp = parseFloat(document.getElementById("persona-temp").value);

        if (!name || !model || !voice || !prompt) {
            alert("Please fill in all required fields.");
            return;
        }

        if (state.editingPersonaId) {
            // Update
            const idx = state.personas.findIndex(p => p.id === state.editingPersonaId);
            if (idx !== -1) {
                state.personas[idx] = {
                    ...state.personas[idx],
                    name, emoji, color, model, voice, prompt, temp
                };
            }
        } else {
            // Create
            const newPersona = {
                id: "persona_" + Date.now(),
                name, emoji, color, model, voice, prompt, temp
            };
            state.personas.push(newPersona);
        }

        savePersonasToStorage();
        updatePersonaListUI();
        updateControlsStatus();
        resetForm();
    });

    // Cancel edit button
    document.getElementById("cancel-edit-btn").addEventListener("click", resetForm);

    // Temperature slider update value
    document.getElementById("persona-temp").addEventListener("input", (e) => {
        document.getElementById("temp-val").textContent = e.target.value;
    });

    // Voice search and filters
    voiceSearchInput.addEventListener("input", filterAndPopulateVoices);
    voiceGenderFilter.addEventListener("change", filterAndPopulateVoices);

    // Play Voice Preview
    previewVoiceBtn.addEventListener("click", async () => {
        const voice = voiceSelect.value;
        if (!voice) return;

        previewVoiceBtn.disabled = true;
        previewVoiceBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Synthesizing...';

        try {
            const response = await fetch(`/api/tts?voice=${encodeURIComponent(voice)}&text=${encodeURIComponent("Hello! This is a test of my custom voice. Does it sound good?")}`, {
                method: "POST"
            });
            if (response.ok) {
                const data = await response.json();
                previewAudio.src = data.audio_url;
                previewAudio.play();
            } else {
                alert("Failed to synthesize preview audio.");
            }
        } catch (err) {
            console.error("Preview TTS failed:", err);
            alert("Connection error. Could not reach local server.");
        } finally {
            previewVoiceBtn.disabled = false;
            previewVoiceBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i> Preview Voice';
        }
    });

    // Presetbadges click event
    document.querySelectorAll(".preset-badge").forEach(badge => {
        badge.addEventListener("click", () => {
            const key = badge.dataset.preset;
            const preset = PRESETS[key];
            if (!preset) return;

            document.getElementById("persona-name").value = preset.name;
            document.getElementById("persona-avatar-emoji").value = preset.emoji;
            document.getElementById("persona-avatar-color").value = preset.color;
            document.getElementById("persona-prompt").value = preset.prompt;
            document.getElementById("persona-temp").value = preset.temp;
            document.getElementById("temp-val").textContent = preset.temp;

            // Search and match best voice from the loaded voices list
            const foundVoice = state.voices.find(v => v.ShortName.toLowerCase().includes(preset.voice.toLowerCase()) || (v.Language.startsWith("en") && v.Gender === (preset.gender || "Male")));
            if (foundVoice) {
                voiceSelect.value = foundVoice.ShortName;
            }

            // Open card if collapsed
            formCard.classList.remove("collapsed");
        });
    });

    // Chat controls
    startBtn.addEventListener("click", startDiscussion);
    pauseBtn.addEventListener("click", pauseDiscussion);
    stepBtn.addEventListener("click", () => triggerNextTurn(true));
    clearBtn.addEventListener("click", clearArena);

    // User/Moderator injection
    sendUserMsgBtn.addEventListener("click", injectUserMessage);
    userMessageInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") injectUserMessage();
    });

    // Audio end callback
    globalAudio.addEventListener("ended", onAudioFinished);
    globalAudio.addEventListener("error", (e) => {
        console.error("Audio playback error:", e);
        onAudioFinished(); // Skip on failure
    });
}

// Start Group Discussion Loop
function startDiscussion() {
    if (state.personas.length < 2) return;

    // Nuke memory when the topic has changed since the last run, so the crew
    // starts fresh instead of dragging the previous discussion along.
    const currentTopic = chatTopicInput.value.trim();
    if (state.lastTopic !== null && currentTopic !== state.lastTopic && state.chatHistory.length > 0) {
        resetConversationMemory();
    }
    state.lastTopic = currentTopic;

    state.isRunning = true;
    startBtn.classList.add("hidden");
    pauseBtn.classList.remove("hidden");
    
    // Clear welcome message if first message
    const welcomeEl = chatFeedEl.querySelector(".chat-feed-welcome");
    if (welcomeEl) welcomeEl.remove();

    triggerNextTurn();
}

// Pause Group Discussion
function pauseDiscussion() {
    state.isRunning = false;
    startBtn.classList.remove("hidden");
    pauseBtn.classList.add("hidden");
    
    const statusMsgEl = activeSpeakerStatusEl.querySelector(".status-msg");
    const spinner = activeSpeakerStatusEl.querySelector(".status-spinner");
    spinner.classList.add("hidden");
    
    if (state.personas.length >= 2) {
        statusMsgEl.textContent = "Discussion paused.";
    }
}

// Clear Chat Arena
// Nuke the crew's memory: wipe the transcript the model sees and reset the
// feed. Used both by the Clear button and automatically on a topic change.
function resetConversationMemory() {
    state.chatHistory = [];
    state.currentSpeakerIndex = -1;
    state.consecutiveErrors = 0;
    chatFeedEl.innerHTML = `
        <div class="chat-feed-welcome">
            <div class="welcome-badge">
                <i class="fa-solid fa-bullhorn"></i>
            </div>
            <h3>Welcome to Aether Workshop</h3>
            <p>Once you save at least 2 personas, customize the topic above and click <strong>Start Discussion</strong>. The personas will interact with memory, responding directly to previous statements and to the moderator.</p>
        </div>
    `;

    // Reset highlights
    document.querySelectorAll(".persona-card").forEach(card => {
        card.classList.remove("active-speaker-card");
        card.querySelector(".waveform-container").classList.add("hidden");
    });
}

function clearArena() {
    pauseDiscussion();
    resetConversationMemory();
    state.lastTopic = null;
    updateControlsStatus();
}

// Manual turn trigger (clicking persona card in manual mode)
async function speakManualTurn(persona) {
    // Set index to the clicked persona
    const idx = state.personas.findIndex(p => p.id === persona.id);
    if (idx === -1) return;
    
    state.currentSpeakerIndex = idx;
    
    // Clear welcome
    const welcomeEl = chatFeedEl.querySelector(".chat-feed-welcome");
    if (welcomeEl) welcomeEl.remove();

    await processSpeakerTurn(persona);
}

// Main turn advancing logic
async function triggerNextTurn(isSingleStep = false) {
    if (state.audioPlaying) return;
    if (!state.isRunning && !isSingleStep) return;

    // Pick next speaker index
    const mode = turnTakingModeSelect.value;
    let nextIdx = 0;

    if (state.personas.length === 0) return;

    if (mode === "round-robin") {
        nextIdx = (state.currentSpeakerIndex + 1) % state.personas.length;
    } else if (mode === "random") {
        // Pick a random persona, preferably different from last speaker if possible
        if (state.personas.length > 1) {
            do {
                nextIdx = Math.floor(Math.random() * state.personas.length);
            } while (nextIdx === state.currentSpeakerIndex);
        } else {
            nextIdx = 0;
        }
    } else if (mode === "moderator-decides") {
        // Look at last response message to see if another persona name is mentioned.
        // Heuristic route: parse message for any panelist names.
        let found = -1;
        if (state.chatHistory.length > 0) {
            const lastMsg = state.chatHistory[state.chatHistory.length - 1];
            // Don't search if last speaker was user, standard rotation for user
            if (!lastMsg.is_user) {
                const text = lastMsg.content.toLowerCase();
                for (let i = 0; i < state.personas.length; i++) {
                    const p = state.personas[i];
                    if (p.name.toLowerCase() !== lastMsg.sender.toLowerCase()) {
                        // Check if name is mentioned in text
                        const nameRegex = new RegExp(`\\b${p.name.toLowerCase()}\\b`);
                        if (nameRegex.test(text)) {
                            found = i;
                            break;
                        }
                    }
                }
            }
        }
        
        if (found !== -1) {
            nextIdx = found;
        } else {
            // Fallback to round robin to ensure fairness
            nextIdx = (state.currentSpeakerIndex + 1) % state.personas.length;
        }
    } else if (mode === "manual" && !isSingleStep) {
        // Manual mode does not auto advance
        pauseDiscussion();
        return;
    }

    state.currentSpeakerIndex = nextIdx;
    const speaker = state.personas[nextIdx];
    await processSpeakerTurn(speaker);
}

// Process a single speaker's chat turn via FastAPI
async function processSpeakerTurn(speaker) {
    state.audioPlaying = true;
    
    // UI Visual feedback
    highlightActiveSpeaker(speaker.id);
    
    const statusMsgEl = activeSpeakerStatusEl.querySelector(".status-msg");
    const spinner = activeSpeakerStatusEl.querySelector(".status-spinner");
    statusMsgEl.textContent = `${speaker.name} is thinking...`;
    spinner.classList.remove("hidden");

    // Construct request payload
    const otherNames = state.personas
        .filter(p => p.id !== speaker.id)
        .map(p => p.name);
        
    // Format history — only send the most recent slice so requests stay
    // bounded over very long sessions (full transcript remains on screen).
    const historyPayload = state.chatHistory.slice(-HISTORY_WINDOW).map(h => ({
        sender: h.sender,
        content: h.content,
        is_user: h.is_user
    }));

    // Inject topic into the context if history is empty
    const topic = chatTopicInput.value.trim() || "A casual chat.";
    const fullSystemPrompt = `${speaker.prompt}\n\nThe current discussion topic is: "${topic}". Make sure to address this topic or comment on what other panelists have said.`;

    try {
        const response = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: speaker.model,
                persona_name: speaker.name,
                system_prompt: fullSystemPrompt,
                other_participants: otherNames,
                messages: historyPayload,
                voice: speaker.voice,
                temperature: speaker.temp
            })
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.detail || "Server error");
        }

        const data = await response.json();
        
        // Add to history
        const msgObject = {
            sender: speaker.name,
            content: data.text,
            is_user: false,
            model: speaker.model,
            audioUrl: data.audio_url,
            color: speaker.color,
            emoji: speaker.emoji,
            id: speaker.id
        };
        state.chatHistory.push(msgObject);
        state.consecutiveErrors = 0; // healthy turn — reset the failure streak

        // Display in feed
        renderMessageBubble(msgObject);
        
        // Speak
        if (data.audio_url) {
            statusMsgEl.textContent = `${speaker.name} is speaking...`;
            spinner.classList.add("hidden");
            
            // Set audio source and play
            globalAudio.src = data.audio_url;
            
            // Apply speaking highlights to the message bubble
            const messageCards = document.querySelectorAll(".message-card");
            const lastCard = messageCards[messageCards.length - 1];
            if (lastCard) {
                lastCard.classList.add("speaking-bubble");
                lastCard.style.setProperty("--speaker-glow", `${speaker.color}35`);
                lastCard.style.setProperty("--speaker-border", speaker.color);
            }
            
            // Animate waveform on the sidebar card
            const activeCard = document.getElementById(`persona-card-${speaker.id}`);
            if (activeCard) {
                activeCard.querySelector(".waveform-container").classList.remove("hidden");
            }
            
            await globalAudio.play();
        } else {
            // If no voice synthesized (or error), wait 3-4 seconds reading delay, then continue
            statusMsgEl.textContent = `${speaker.name} finished.`;
            spinner.classList.add("hidden");
            
            setTimeout(() => {
                onAudioFinished();
            }, Math.max(3000, data.text.length * 50)); // reading pace delay
        }

    } catch (error) {
        console.error("Error processing speaker turn:", error);
        state.consecutiveErrors++;
        spinner.classList.add("hidden");

        // Recover playing state so the queue isn't locked
        state.audioPlaying = false;

        if (state.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            // Too many failures in a row — something is genuinely wrong (Ollama
            // down, etc.). Stop and surface it instead of spinning forever.
            statusMsgEl.textContent = `Stopped after ${state.consecutiveErrors} errors: ${error.message}`;
            renderSystemErrorMsg(`System: Paused after ${state.consecutiveErrors} consecutive failures. Last error from ${speaker.name}: ${error.message}`);
            pauseDiscussion();
            return;
        }

        // Transient hiccup — note it and keep the session alive by skipping to
        // the next speaker after a short backoff, so a marathon run survives.
        statusMsgEl.textContent = `${speaker.name} stumbled, skipping... (${error.message})`;
        renderSystemErrorMsg(`System: ${speaker.name} failed this turn (${error.message}). Skipping ahead.`);

        if (state.isRunning) {
            setTimeout(() => triggerNextTurn(), 2000);
        }
    }
}

// Callback when speaking audio ends
function onAudioFinished() {
    state.audioPlaying = false;
    
    // Remove speaking bubble classes
    document.querySelectorAll(".message-card").forEach(c => c.classList.remove("speaking-bubble"));
    
    // Hide waveforms
    document.querySelectorAll(".persona-card").forEach(c => {
        c.querySelector(".waveform-container").classList.add("hidden");
    });

    const statusMsgEl = activeSpeakerStatusEl.querySelector(".status-msg");
    statusMsgEl.textContent = "Waiting...";

    // If running, trigger next speaker turn
    if (state.isRunning) {
        setTimeout(() => {
            triggerNextTurn();
        }, 1200); // 1.2 second breathing delay between speakers
    }
}

// Highlight Active speaker card in sidebar
function highlightActiveSpeaker(speakerId) {
    document.querySelectorAll(".persona-card").forEach(card => {
        if (card.id === `persona-card-${speakerId}`) {
            card.classList.add("active-speaker-card");
        } else {
            card.classList.remove("active-speaker-card");
        }
    });
}

// Render message card in UI
function renderMessageBubble(msg) {
    const card = document.createElement("div");
    card.className = `message-card ${msg.is_user ? 'self-user' : ''}`;
    
    // Avatar container
    const avatarContainer = document.createElement("div");
    avatarContainer.className = "message-avatar-container";
    
    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.style.backgroundColor = msg.is_user ? "rgba(99, 102, 241, 0.1)" : `${msg.color}15`;
    avatar.style.border = `2px solid ${msg.is_user ? 'var(--primary)' : msg.color}`;
    avatar.style.color = msg.is_user ? 'var(--primary)' : msg.color;
    avatar.textContent = msg.is_user ? "👤" : msg.emoji;
    
    avatarContainer.appendChild(avatar);

    // Content container
    const contentWrapper = document.createElement("div");
    contentWrapper.className = "message-content-wrapper";

    const header = document.createElement("div");
    header.className = "message-header-meta";

    const name = document.createElement("span");
    name.className = "message-speaker-name";
    name.textContent = msg.is_user ? "Moderator (You)" : msg.sender;
    
    header.appendChild(name);

    if (!msg.is_user && msg.model) {
        const modelTag = document.createElement("span");
        modelTag.className = "message-tag-model";
        modelTag.textContent = msg.model;
        header.appendChild(modelTag);
        
        // Active speaking waveform inside the chat header too!
        const headerWave = document.createElement("div");
        headerWave.className = "waveform-container hidden";
        headerWave.style.setProperty("--speaker-glow-color", msg.color);
        for(let i=0; i<4; i++) {
            const bar = document.createElement("span");
            bar.className = "wave-bar";
            headerWave.appendChild(bar);
        }
        header.appendChild(headerWave);
    }

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";

    const text = document.createElement("div");
    text.className = "message-text";
    
    // Highlight actions in text (e.g. *scratches chin*)
    let formattedText = msg.content;
    // Regex matches text between asterisks
    formattedText = formattedText.replace(/\*([^*]+)\*/g, '<span class="action-text">*$1*</span>');
    text.innerHTML = formattedText;
    
    bubble.appendChild(text);

    // Playback replay button
    if (msg.audioUrl) {
        const footer = document.createElement("div");
        footer.className = "message-footer-actions";
        
        const playBtn = document.createElement("button");
        playBtn.className = "bubble-action-btn";
        playBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i> Replay';
        playBtn.addEventListener("click", () => {
            playSingleMessageAudio(msg);
        });
        
        footer.appendChild(playBtn);
        bubble.appendChild(footer);
    }

    contentWrapper.appendChild(header);
    contentWrapper.appendChild(bubble);

    card.appendChild(avatarContainer);
    card.appendChild(contentWrapper);

    chatFeedEl.appendChild(card);
    
    // Auto scroll chat feed
    chatFeedEl.scrollTop = chatFeedEl.scrollHeight;
}

// Play single message audio on-demand (replay)
function playSingleMessageAudio(msg) {
    // Pause general running loop temporarily or just overlay audio
    globalAudio.pause();
    
    // Reset visual highlights
    document.querySelectorAll(".message-card").forEach(c => c.classList.remove("speaking-bubble"));
    
    // Highlight specific message bubble
    const cardEl = Array.from(document.querySelectorAll(".message-card")).find(c => {
        const nameEl = c.querySelector(".message-speaker-name");
        return nameEl && nameEl.textContent === msg.sender && c.querySelector(".message-text").innerHTML.includes(msg.content.substring(0, 10));
    });
    
    if (cardEl) {
        cardEl.classList.add("speaking-bubble");
        cardEl.style.setProperty("--speaker-glow", `${msg.color}35`);
        cardEl.style.setProperty("--speaker-border", msg.color);
    }
    
    globalAudio.src = msg.audioUrl;
    globalAudio.play();
}

// Render System Error Message in feed
function renderSystemErrorMsg(textStr) {
    const errorEl = document.createElement("div");
    errorEl.className = "system-error-bubble";
    errorEl.style.cssText = "background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: var(--radius-sm); padding: 0.6rem 1rem; font-size: 0.85rem; color: var(--danger); text-align: center; margin: 0.5rem 0; width: 100%;";
    errorEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${textStr}`;
    chatFeedEl.appendChild(errorEl);
    chatFeedEl.scrollTop = chatFeedEl.scrollHeight;
}

// Inject User/Moderator Message
function injectUserMessage() {
    const text = userMessageInput.value.trim();
    if (!text) return;

    // Clear welcome
    const welcomeEl = chatFeedEl.querySelector(".chat-feed-welcome");
    if (welcomeEl) welcomeEl.remove();

    const msg = {
        sender: "User",
        content: text,
        is_user: true
    };

    state.chatHistory.push(msg);
    renderMessageBubble(msg);
    userMessageInput.value = "";

    // If discussion is running, pause for 1 second and then let the next persona respond to the user's injection!
    if (state.isRunning && !state.audioPlaying) {
        setTimeout(() => {
            triggerNextTurn();
        }, 1000);
    }
}
