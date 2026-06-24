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
    turnTimer: null,        // pending setTimeout handle for the next turn
    stopRequested: false,   // set on pause so an in-flight turn bails out
    projectLoaded: false,   // a codebase is loaded for review
    projectTurn: 0,         // advances each turn to rotate which files are reviewed
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
const storyModeToggle = document.getElementById("story-mode-toggle");
const narratorVoiceSelect = document.getElementById("narrator-voice");
const narratorVoiceWrap = document.getElementById("narrator-voice-wrap");
const projectModeToggle = document.getElementById("project-mode-toggle");
const projectPanel = document.getElementById("project-panel");
const projectRepoUrl = document.getElementById("project-repo-url");
const projectLoadRepoBtn = document.getElementById("project-load-repo-btn");
const projectFileInput = document.getElementById("project-file-input");
const projectUploadBtn = document.getElementById("project-upload-btn");
const loadReviewCrewBtn = document.getElementById("load-review-crew-btn");
const projectClearBtn = document.getElementById("project-clear-btn");
const projectStatusEl = document.getElementById("project-status");
const taskModeToggle = document.getElementById("task-mode-toggle");
const tasksPanel = document.getElementById("tasks-panel");
const tasksRefreshBtn = document.getElementById("tasks-refresh-btn");
const pendingTasksList = document.getElementById("pending-tasks-list");
const humanTasksList = document.getElementById("human-tasks-list");
const dagList = document.getElementById("dag-list");
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
const navItems = Array.from(document.querySelectorAll(".nav-item"));
const appViews = Array.from(document.querySelectorAll(".app-view"));
const workshopModeSummary = document.getElementById("workshop-mode-summary");
const settingsRefreshModelsBtn = document.getElementById("settings-refresh-models");
const settingsRefreshVoicesBtn = document.getElementById("settings-refresh-voices");

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
    },

    // --- Project Review Crew (for Project Mode) ---
    architect: {
        name: "Senior Architect",
        emoji: "🏗️",
        color: "#0ea5e9",
        gender: "Male",
        prompt: "You are a Senior Software Architect reviewing a real codebase. You evaluate structure, modularity, scalability, technical debt, and maintainability. You cite specific files and patterns you see, call out fragile or duplicated code, and propose concrete refactors. Be direct and technical. Keep your responses short (2-4 sentences).",
        voice: "en-US-AndrewNeural",
        temp: 0.6
    },
    product: {
        name: "Product Strategist",
        emoji: "🧭",
        color: "#8b5cf6",
        gender: "Female",
        prompt: "You are a Product Strategist reviewing a project. You focus on product-market fit, user value, missing features, and gaps in the experience. You ask 'who is this for and what problem does it solve?', spot where the product is incomplete, and suggest the highest-impact additions. Keep your responses short (2-4 sentences).",
        voice: "en-US-AriaNeural",
        temp: 0.7
    },
    security: {
        name: "Security Auditor",
        emoji: "🔒",
        color: "#ef4444",
        gender: "Male",
        prompt: "You are a Security Auditor reviewing a codebase. You look for vulnerabilities, exposed secrets, unsafe input handling, injection risks, weak auth, and dependency risks. You name the specific file and line-of-thinking, rate severity, and give a concrete fix. Be precise and cautious. Keep your responses short (2-4 sentences).",
        voice: "en-US-RogerNeural",
        temp: 0.5
    },
    uxcritic: {
        name: "UX Critic",
        emoji: "🎨",
        color: "#ec4899",
        gender: "Female",
        prompt: "You are a UX Critic reviewing a project. You focus on usability, user flows, clarity, accessibility, and visual polish. You point out confusing interactions, missing feedback, and friction, and you suggest concrete improvements to make the experience smoother and more delightful. Keep your responses short (2-4 sentences).",
        voice: "en-US-JennyNeural",
        temp: 0.7
    },
    monetization: {
        name: "Monetization Strategist",
        emoji: "💸",
        color: "#22c55e",
        gender: "Male",
        prompt: "You are a Monetization and Growth Strategist reviewing a project. You focus on how it could make money: pricing models, subscription vs one-time, premium features, target market, go-to-market, and realistic revenue paths. You identify the strongest monetization angle and the fastest path to first revenue. Keep your responses short (2-4 sentences).",
        voice: "en-US-GuyNeural",
        temp: 0.75
    }
};

// Persona keys that make up the one-click "Review Crew" for Project Mode.
const REVIEW_CREW_KEYS = ["architect", "product", "security", "uxcritic", "monetization"];

// Initialize Application
window.addEventListener("DOMContentLoaded", async () => {
    setupViewNavigation();
    setupFormCollapsible();
    setupEventListeners();
    await fetchOllamaModels();
    await fetchVoices();
    loadLocalPersonas();
    updateControlsStatus();
    refreshProjectStatus();
    updateWorkshopModeSummary();
});

// Application-level navigation. Views share the same DOM and runtime state, so
// changing pages never resets an active conversation or loaded project.
function showView(viewName, updateHash = true) {
    const target = appViews.find(view => view.dataset.viewPanel === viewName) || appViews[0];
    if (!target) return;

    appViews.forEach(view => view.classList.toggle("active", view === target));
    navItems.forEach(item => item.classList.toggle("active", item.dataset.view === target.dataset.viewPanel));

    if (updateHash) history.replaceState(null, "", `#${target.dataset.viewPanel}`);
    if (target.dataset.viewPanel === "projects") refreshProjectStatus();
    if (target.dataset.viewPanel === "tasks") {
        refreshTasks();
        refreshDags();
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function setupViewNavigation() {
    navItems.forEach(item => item.addEventListener("click", () => showView(item.dataset.view)));
    document.querySelectorAll("[data-go-view]").forEach(item => {
        item.addEventListener("click", () => showView(item.dataset.goView));
    });
    showView(window.location.hash.replace("#", "") || "workshop", false);
}

function updateWorkshopModeSummary() {
    if (!workshopModeSummary) return;
    const modes = [];
    if (projectModeToggle && projectModeToggle.checked) modes.push("Project context on");
    if (taskModeToggle && taskModeToggle.checked) modes.push("Task extraction on");
    workshopModeSummary.textContent = modes.length ? modes.join(" • ") : "Standard conversation";
}

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
            populateNarratorVoices();
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

// Populate the Story Mode narrator voice dropdown (English voices, deep/narrator
// styles surfaced first as sensible defaults).
function populateNarratorVoices() {
    if (!narratorVoiceSelect) return;
    const english = state.voices.filter(v => v.Language.startsWith("en"));
    english.sort((a, b) => a.FriendlyName.localeCompare(b.FriendlyName));

    narratorVoiceSelect.innerHTML = "";
    english.forEach(v => {
        const option = document.createElement("option");
        option.value = v.ShortName;
        option.textContent = `${v.FriendlyName} (${v.Gender})`;
        narratorVoiceSelect.appendChild(option);
    });

    // Prefer a warm, narrator-ish default if available.
    const preferred = ["en-GB-RyanNeural", "en-US-GuyNeural", "en-US-BrianNeural", "en-US-AndrewNeural"];
    for (const pref of preferred) {
        if (english.some(v => v.ShortName === pref)) {
            narratorVoiceSelect.value = pref;
            return;
        }
    }
    if (english.length > 0) narratorVoiceSelect.value = english[0].ShortName;
}

// ============================================================
//  Project Mode: clone/upload a codebase and load a review crew
// ============================================================
function escapeHtml(str) {
    return String(str == null ? "" : str)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

async function refreshProjectStatus() {
    try {
        const res = await fetch("/api/project/status");
        if (res.ok) renderProjectStatus(await res.json());
    } catch (e) {
        console.error("Project status check failed:", e);
    }
}

function renderProjectStatus(summary) {
    state.projectLoaded = !!(summary && summary.loaded);
    if (!projectStatusEl) return;
    if (state.projectLoaded) {
        const treePreview = (summary.tree || "").split("\n").slice(0, 14).join("\n");
        const more = summary.file_count > 14 ? "\n…" : "";
        projectStatusEl.innerHTML =
            `<strong>${escapeHtml(summary.name)}</strong> — ${summary.file_count} files indexed`
            + `<div class="project-source">${escapeHtml(summary.source || "")}</div>`
            + `<pre class="project-tree">${escapeHtml(treePreview + more)}</pre>`;
    } else {
        projectStatusEl.textContent = "No project loaded. Clone a repo or upload files to begin.";
    }
}

function setProjectBusy(msg) {
    if (projectStatusEl) {
        projectStatusEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${escapeHtml(msg)}`;
    }
}

async function loadProjectRepo() {
    const url = projectRepoUrl.value.trim();
    if (!url) { alert("Enter a GitHub repository URL first."); return; }
    setProjectBusy(`Cloning ${url} … (this can take a minute)`);
    projectLoadRepoBtn.disabled = true;
    try {
        const res = await fetch("/api/project/load_repo", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ repo_url: url })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Clone failed");
        renderProjectStatus(data);
        onProjectLoaded(data);
    } catch (e) {
        projectStatusEl.textContent = `Error: ${e.message}`;
    } finally {
        projectLoadRepoBtn.disabled = false;
    }
}

async function uploadProjectFiles() {
    const files = projectFileInput.files;
    if (!files || files.length === 0) { alert("Choose a .zip or project files to upload first."); return; }
    const form = new FormData();
    for (const f of files) form.append("files", f);
    setProjectBusy(`Uploading ${files.length} item(s) …`);
    projectUploadBtn.disabled = true;
    try {
        const res = await fetch("/api/project/upload", { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Upload failed");
        renderProjectStatus(data);
        onProjectLoaded(data);
    } catch (e) {
        projectStatusEl.textContent = `Error: ${e.message}`;
    } finally {
        projectUploadBtn.disabled = false;
    }
}

async function clearProject() {
    try { await fetch("/api/project/clear", { method: "POST" }); } catch (e) {}
    state.projectLoaded = false;
    state.projectTurn = 0;
    renderProjectStatus({ loaded: false });
}

// When a project loads: reset file rotation, ensure Project Mode is on, and
// steer the topic toward a review unless the user set their own.
function onProjectLoaded(summary) {
    state.projectTurn = 0;
    if (projectModeToggle && !projectModeToggle.checked) {
        projectModeToggle.checked = true;
    }
    updateWorkshopModeSummary();
    const DEFAULT_TOPIC = "Explain why space exploration is essential to human survival.";
    const current = chatTopicInput.value.trim();
    if (!current || current === DEFAULT_TOPIC) {
        chatTopicInput.value = `Review the "${summary.name}" project: where it can improve, where the gaps are, and how to monetize it.`;
    }
}

// One-click: replace the panel with the 5-persona project Review Crew.
function loadReviewCrew() {
    if (state.personas.length > 0 &&
        !confirm("Replace the current panel with the 5-persona Review Crew (Architect, Product, Security, UX, Monetization)?")) {
        return;
    }
    state.personas = REVIEW_CREW_KEYS.map(key => {
        const p = PRESETS[key];
        return {
            id: `review_${key}`,
            name: p.name,
            emoji: p.emoji,
            color: p.color,
            model: modelSelect.value || "llama3.2:latest",
            voice: matchVoiceForPreset(p),
            prompt: p.prompt,
            temp: p.temp
        };
    });
    savePersonasToStorage();
    updatePersonaListUI();
    updateControlsStatus();
}

// Resolve a preset's preferred voice against the loaded voice list, falling back
// to any English voice of the right gender.
function matchVoiceForPreset(preset) {
    const exact = state.voices.find(v => v.ShortName === preset.voice);
    if (exact) return exact.ShortName;
    const byGender = state.voices.find(v => v.Language.startsWith("en") && v.Gender === (preset.gender || "Male"));
    return byGender ? byGender.ShortName : preset.voice;
}

// ============================================================
//  Task Mode: extraction queue, approvals, DAG viewer, execution
//  (Decoupled — the UI only calls endpoints; no persona executes anything.)
// ============================================================
const MODEL_FOR_TASKS = () => modelSelect.value || "llama3.2:latest";

async function refreshTasks() {
    try {
        const data = await (await fetch("/api/tasks")).json();
        renderTasks(data.tasks || []);
    } catch (e) {
        console.error("refreshTasks failed:", e);
    }
}

function renderTasks(tasks) {
    const pending = [];
    const human = [];
    tasks.forEach(t => {
        if (t.status === "rejected") return;
        if (t.type === "HUMAN_CENTRIC" && (t.status === "approved" || t.status === "completed")) {
            human.push(t);
        } else if (t.status !== "completed") {
            pending.push(t); // pending tasks + approved AI tasks awaiting a DAG
        }
    });

    pendingTasksList.innerHTML = "";
    if (!pending.length) {
        pendingTasksList.innerHTML = `<p class="tasks-empty">No pending tasks.</p>`;
    } else {
        pending.forEach(t => pendingTasksList.appendChild(buildTaskCard(t)));
    }

    humanTasksList.innerHTML = "";
    if (!human.length) {
        humanTasksList.innerHTML = `<p class="tasks-empty">No human reminders.</p>`;
    } else {
        human.forEach(t => humanTasksList.appendChild(buildHumanCard(t)));
    }
}

function taskActionBtn(label, icon, kind, onClick) {
    const b = document.createElement("button");
    b.className = `task-btn task-btn-${kind}`;
    b.innerHTML = `<i class="fa-solid ${icon}"></i> ${label}`;
    b.addEventListener("click", onClick);
    return b;
}

function buildTaskCard(t) {
    const card = document.createElement("div");
    card.className = `task-card ${t.type === "AI_CENTRIC" ? "task-ai" : "task-human"}`;
    const typeLabel = t.type === "AI_CENTRIC" ? "AI" : "HUMAN";
    card.innerHTML =
        `<div class="task-meta">
            <span class="task-type-badge">${typeLabel}</span>
            <span class="task-persona"><i class="fa-solid fa-user"></i> ${escapeHtml(t.source_persona)}</span>
            <span class="task-conf">conf ${Math.round((t.confidence || 0) * 100)}%</span>
            ${t.status === "approved" ? '<span class="task-approved">approved</span>' : ""}
        </div>
        <div class="task-desc">${escapeHtml(t.description)}</div>
        <div class="task-assign">
            <i class="fa-solid fa-user-tag"></i>
            ${escapeHtml(t.assigned_by || "—")} <i class="fa-solid fa-arrow-right-long"></i>
            <strong>${escapeHtml(t.assigned_to || "—")}</strong>
            <span class="assign-type">${escapeHtml(t.assignment_type || "")}</span>
        </div>
        <div class="task-actions"></div>`;
    const actions = card.querySelector(".task-actions");
    if (t.status === "pending") {
        actions.appendChild(taskActionBtn("Approve", "fa-check", "approve", () => approveTask(t.id, "approve")));
        actions.appendChild(taskActionBtn("Reject", "fa-xmark", "reject", () => approveTask(t.id, "reject")));
        actions.appendChild(taskActionBtn("Modify", "fa-pen", "modify", () => modifyTask(t)));
    } else if (t.status === "approved" && t.type === "AI_CENTRIC") {
        actions.appendChild(taskActionBtn("Build DAG", "fa-sitemap", "build", () => buildDag(t.id)));
    }
    return card;
}

function buildHumanCard(t) {
    const card = document.createElement("div");
    card.className = `task-card task-human ${t.status === "completed" ? "task-done" : ""}`;
    card.innerHTML =
        `<div class="task-meta">
            <span class="task-type-badge">HUMAN</span>
            <span class="task-persona"><i class="fa-solid fa-user"></i> ${escapeHtml(t.source_persona)}</span>
        </div>
        <div class="task-desc">${escapeHtml(t.description)}</div>
        <div class="task-assign">
            <i class="fa-solid fa-user-tag"></i>
            ${escapeHtml(t.assigned_by || "—")} <i class="fa-solid fa-arrow-right-long"></i>
            <strong>${escapeHtml(t.assigned_to || "—")}</strong>
            <span class="assign-type">${escapeHtml(t.assignment_type || "")}</span>
        </div>
        <div class="task-actions"></div>`;
    const actions = card.querySelector(".task-actions");
    if (t.status !== "completed") {
        actions.appendChild(taskActionBtn("Mark Complete", "fa-check-double", "done", () => completeTask(t.id)));
    } else {
        actions.innerHTML = `<span class="task-approved">completed</span>`;
    }
    return card;
}

async function approveTask(id, decision, description) {
    try {
        await fetch("/api/tasks/approve", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ task_id: id, decision, description })
        });
        refreshTasks();
    } catch (e) {
        console.error("approveTask failed:", e);
    }
}

function modifyTask(t) {
    const next = prompt("Edit task description (it will be re-classified):", t.description);
    if (next === null) return;
    approveTask(t.id, "modify", next);
}

async function completeTask(id) {
    try {
        await fetch("/api/tasks/complete", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ task_id: id })
        });
        refreshTasks();
    } catch (e) {
        console.error("completeTask failed:", e);
    }
}

async function buildDag(taskId) {
    try {
        const res = await fetch("/api/dag/create", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ task_id: taskId })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "DAG create failed");
        refreshTasks();
        refreshDags();
    } catch (e) {
        alert(e.message);
    }
}

async function refreshDags() {
    try {
        const data = await (await fetch("/api/dags")).json();
        renderDags(data.dags || []);
    } catch (e) {
        console.error("refreshDags failed:", e);
    }
}

function renderDags(dags) {
    if (!dags.length) {
        dagList.innerHTML = `<p class="tasks-empty">Approve an AI task and click <strong>Build DAG</strong> to create an execution plan.</p>`;
        return;
    }
    dagList.innerHTML = "";
    dags.forEach(dag => dagList.appendChild(buildDagCard(dag)));
}

function buildDagCard(dag) {
    const card = document.createElement("div");
    card.className = "dag-card";

    const header = document.createElement("div");
    header.className = "dag-header";
    header.innerHTML =
        `<div class="dag-goal"><i class="fa-solid fa-bullseye"></i> ${escapeHtml(dag.goal)}</div>
         <span class="dag-status dag-status-${dag.status}">${dag.status}</span>`;
    card.appendChild(header);

    const controls = document.createElement("div");
    controls.className = "dag-controls";
    const finished = dag.status === "complete" || dag.status === "cancelled";
    const runBtn = taskActionBtn("Run Next Step", "fa-forward-step", "run", () => executeDag(dag.id));
    runBtn.disabled = finished;
    controls.appendChild(runBtn);
    const cancelBtn = taskActionBtn("Cancel", "fa-ban", "cancel", () => cancelDag(dag.id));
    cancelBtn.disabled = finished;
    controls.appendChild(cancelBtn);
    card.appendChild(controls);

    const tree = document.createElement("div");
    tree.className = "dag-tree";
    const byId = {};
    dag.nodes.forEach(n => { byId[n.id] = n; });
    renderDagNode(dag, dag.root_id, byId, tree, 0, new Set());
    card.appendChild(tree);

    return card;
}

function dagMiniBtn(label, icon, onClick) {
    const b = document.createElement("button");
    b.className = "dag-mini-btn";
    b.title = label;
    b.innerHTML = `<i class="fa-solid ${icon}"></i>`;
    b.addEventListener("click", onClick);
    return b;
}

function renderDagNode(dag, nodeId, byId, container, depth, seen) {
    const n = byId[nodeId];
    if (!n || seen.has(nodeId)) return; // guard against cycles (shouldn't happen)
    seen.add(nodeId);

    const row = document.createElement("div");
    row.className = `dag-node dag-node-${n.status}`;
    row.style.marginLeft = `${depth * 1.1}rem`;
    const depNote = n.dependencies.length ? `<span class="dag-dep">⏳ ${n.dependencies.length} dep</span>` : "";
    const ownerTag = n.owner ? `<span class="dag-node-owner"><i class="fa-solid fa-user-tag"></i> ${escapeHtml(n.owner)}</span>` : "";
    row.innerHTML =
        `<span class="dag-node-dot"></span>
         <span class="dag-node-action">${escapeHtml(n.action)}</span>
         ${ownerTag}
         <span class="dag-node-handler">${escapeHtml(n.handler)}</span>
         ${depNote}
         <span class="dag-node-btns"></span>`;
    const btns = row.querySelector(".dag-node-btns");
    const active = dag.status !== "cancelled" && dag.status !== "complete";
    if (!n.children.length && n.type === "atomic" && active) {
        btns.appendChild(dagMiniBtn("Expand into sub-steps", "fa-code-fork", () => expandNode(dag.id, n.id)));
        if (n.status === "pending") {
            btns.appendChild(dagMiniBtn("Run this node", "fa-play", () => executeDag(dag.id, n.id)));
        }
    }
    container.appendChild(row);

    if (n.result) {
        const res = document.createElement("pre");
        res.className = "dag-node-result";
        res.style.marginLeft = `${(depth + 1) * 1.1}rem`;
        res.textContent = n.result.length > 700 ? n.result.slice(0, 700) + "…" : n.result;
        container.appendChild(res);
    }

    n.children.forEach(cid => renderDagNode(dag, cid, byId, container, depth + 1, seen));
}

async function expandNode(dagId, nodeId) {
    try {
        const res = await fetch("/api/dag/expand", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dag_id: dagId, node_id: nodeId, model: MODEL_FOR_TASKS() })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Expand failed");
        refreshDags();
    } catch (e) {
        alert(e.message);
    }
}

async function executeDag(dagId, nodeId) {
    try {
        const body = { dag_id: dagId, model: MODEL_FOR_TASKS() };
        if (nodeId) body.node_id = nodeId;
        const res = await fetch("/api/dag/execute", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Execute failed");
        if (data.executed && data.result) {
            injectExecutionResult(data.executed, data.result);
        } else if (data.blocked) {
            alert("The next step is blocked by unmet dependencies. Run or expand its prerequisites first.");
        } else if (data.done) {
            alert("DAG complete — all nodes have executed.");
        }
        refreshDags();
    } catch (e) {
        alert(e.message);
    }
}

async function cancelDag(dagId) {
    try {
        await fetch("/api/dag/cancel", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dag_id: dagId })
        });
        refreshDags();
    } catch (e) {
        console.error("cancelDag failed:", e);
    }
}

// Inject an executed node's result back into the conversation (spec 6.2).
function injectExecutionResult(node, result) {
    const welcomeEl = chatFeedEl.querySelector(".chat-feed-welcome");
    if (welcomeEl) welcomeEl.remove();
    const msg = {
        sender: node.owner ? `Execution · ${node.owner}` : "Execution",
        content: `[${node.handler}] ${node.action}\n\n${result}`,
        is_user: false,
        color: "#22c55e",
        emoji: "⚙️",
        model: "DAG"
    };
    state.chatHistory.push(msg);
    renderMessageBubble(msg);
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

    // Story Mode toggle — reveal the narrator voice picker when enabled
    storyModeToggle.addEventListener("change", () => {
        narratorVoiceWrap.style.display = storyModeToggle.checked ? "" : "none";
    });

    // Project Mode toggle — reveal the project ingest panel when enabled
    projectModeToggle.addEventListener("change", () => {
        if (projectModeToggle.checked) refreshProjectStatus();
        updateWorkshopModeSummary();
    });

    projectLoadRepoBtn.addEventListener("click", loadProjectRepo);
    projectUploadBtn.addEventListener("click", uploadProjectFiles);
    projectClearBtn.addEventListener("click", clearProject);
    loadReviewCrewBtn.addEventListener("click", loadReviewCrew);

    // Task Mode toggle — reveal the Tasks & Execution panel and load current state
    taskModeToggle.addEventListener("change", () => {
        if (taskModeToggle.checked) { refreshTasks(); refreshDags(); }
        updateWorkshopModeSummary();
    });
    tasksRefreshBtn.addEventListener("click", () => { refreshTasks(); refreshDags(); });
    settingsRefreshModelsBtn.addEventListener("click", fetchOllamaModels);
    settingsRefreshVoicesBtn.addEventListener("click", fetchVoices);

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

    // NOTE: audio sequencing is handled per-clip by playClip() (promise-based),
    // so we no longer wire a persistent "ended" -> advance listener here.
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
    state.stopRequested = false;
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
    state.stopRequested = true;

    // Cancel any pending next-turn timer and stop current audio so an in-flight
    // turn unblocks promptly (playClip resolves on the audio "pause" event).
    if (state.turnTimer) {
        clearTimeout(state.turnTimer);
        state.turnTimer = null;
    }
    try { globalAudio.pause(); } catch (e) {}

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
    state.stopRequested = false; // an explicit manual turn should run to completion

    // Clear welcome
    const welcomeEl = chatFeedEl.querySelector(".chat-feed-welcome");
    if (welcomeEl) welcomeEl.remove();

    await processSpeakerTurn(persona);
    finishTurnCleanup();
}

// Main turn advancing logic
async function triggerNextTurn(isSingleStep = false) {
    if (state.audioPlaying) return;
    if (!state.isRunning && !isSingleStep) return;

    // A manual single step should run even if a pause was previously requested.
    if (isSingleStep) state.stopRequested = false;

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
    finishTurnCleanup();

    // Auto-advance to the next speaker unless this was a one-off step, the user
    // paused, or an error handler stopped the session.
    if (state.isRunning && !isSingleStep && !state.stopRequested) {
        state.turnTimer = setTimeout(() => triggerNextTurn(), 1200); // breathing room
    }
}

// Process a single speaker's turn. In Story Mode this is a sequence:
//   narrator "before" beat  ->  the character's spoken line  ->  narrator "after" beat
// each one voiced and awaited in order. With Story Mode off it's just the line.
async function processSpeakerTurn(speaker) {
    state.audioPlaying = true;
    highlightActiveSpeaker(speaker.id);

    const storyOn = storyModeToggle && storyModeToggle.checked;
    const narratorVoice = narratorVoiceSelect ? narratorVoiceSelect.value : null;

    try {
        // 1. Narrator "before" beat — sets the scene and leads into the line.
        if (storyOn && !state.stopRequested) {
            setTurnStatus(`Narrator sets the scene for ${speaker.name}...`, true);
            const before = await fetchNarration(speaker, "before", narratorVoice);
            if (before && before.text) {
                pushNarration(before);
                renderNarratorBubble(before);
                await playClip(before.audio_url, before.text);
            }
        }
        if (state.stopRequested) return;

        // 2. The character's spoken line.
        setTurnStatus(`${speaker.name} is thinking...`, true);
        const data = await fetchSpeakerLine(speaker);

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
        renderMessageBubble(msgObject);

        // Task Mode: the server already extracted tasks from this reply; refresh the panel.
        if (taskModeToggle && taskModeToggle.checked) refreshTasks();

        setTurnStatus(`${speaker.name} is speaking...`, false);
        applySpeakingVisuals(speaker);
        await playClip(data.audio_url, data.text);
        clearSpeakingVisuals();
        if (state.stopRequested) return;

        // 3. Narrator "after" beat — the character's reaction once they finish.
        if (storyOn && !state.stopRequested) {
            setTurnStatus(`Narrator follows ${speaker.name}'s reaction...`, true);
            const after = await fetchNarration(speaker, "after", narratorVoice);
            if (after && after.text) {
                pushNarration(after);
                renderNarratorBubble(after);
                await playClip(after.audio_url, after.text);
            }
        }
    } catch (error) {
        handleTurnError(speaker, error);
    } finally {
        state.audioPlaying = false;
    }
}

// Bounded recent-history payload shared by speaker lines and narration, so
// requests stay small over very long sessions (full transcript stays on screen).
function recentHistoryPayload() {
    return state.chatHistory.slice(-HISTORY_WINDOW).map(h => ({
        sender: h.sender,
        content: h.content,
        is_user: h.is_user
    }));
}

// Request one persona's spoken line from the backend. Throws on failure so the
// turn's error handler can count it toward the consecutive-error breaker.
async function fetchSpeakerLine(speaker) {
    const otherNames = state.personas.filter(p => p.id !== speaker.id).map(p => p.name);
    const topic = chatTopicInput.value.trim() || "A casual chat.";

    // Project Mode: prepend the rotating review context (digest + a window of
    // files that advances each turn) and steer the persona toward critique.
    let projectBlock = "";
    if (projectModeToggle && projectModeToggle.checked && state.projectLoaded) {
        try {
            const res = await fetch(`/api/project/context?turn=${state.projectTurn}`);
            if (res.ok) {
                const data = await res.json();
                if (data.context) {
                    projectBlock =
                        `\n\n--- PROJECT UNDER REVIEW ---\n${data.context}\n--- END PROJECT CONTEXT ---\n\n` +
                        `As ${speaker.name}, analyze this project from your role. Give concrete, specific feedback: ` +
                        `improvements, gaps or risks, and how it could be monetized. Reference actual file names when you can.`;
                }
            }
        } catch (e) {
            console.error("Project context fetch failed:", e);
        }
    }
    state.projectTurn++; // rotate the reviewed files for the next turn

    const fullSystemPrompt = `${speaker.prompt}\n\nThe current discussion topic is: "${topic}".${projectBlock} Make sure to address this topic or comment on what other panelists have said.`;

    const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model: speaker.model,
            persona_name: speaker.name,
            system_prompt: fullSystemPrompt,
            other_participants: otherNames,
            messages: recentHistoryPayload(),
            voice: speaker.voice,
            temperature: speaker.temp,
            extract_tasks: !!(taskModeToggle && taskModeToggle.checked)
        })
    });
    if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || "Server error");
    }
    return await response.json();
}

// Request a narrator stage direction. Best-effort: on any failure we return null
// and simply skip the beat, so narration problems never break the discussion.
async function fetchNarration(speaker, phase, narratorVoice) {
    try {
        const topic = chatTopicInput.value.trim() || "A casual chat.";
        const response = await fetch("/api/narrate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: speaker.model,
                character: speaker.name,
                phase: phase,
                topic: topic,
                participants: state.personas.map(p => p.name),
                messages: recentHistoryPayload(),
                voice: narratorVoice || null,
                temperature: 0.9
            })
        });
        if (!response.ok) return null;
        return await response.json();
    } catch (e) {
        console.error("Narration failed:", e);
        return null;
    }
}

// Record a narrator beat in history so the personas are aware of the staged
// action (they'll see e.g. "Narrator: Alex glares at Tom" and can react to it).
function pushNarration(narr) {
    state.chatHistory.push({
        sender: "Narrator",
        content: narr.text,
        is_user: false,
        isNarrator: true,
        audioUrl: narr.audio_url
    });
}

// Play one audio clip to completion. Resolves on "ended"/"error", and also on
// "pause" so a user pause unblocks the turn immediately. With no URL it falls
// back to a timed reading delay.
function playClip(url, fallbackText) {
    return new Promise((resolve) => {
        if (!url) { readingDelay(fallbackText).then(resolve); return; }
        let settled = false;
        const done = () => {
            if (settled) return;
            settled = true;
            globalAudio.removeEventListener("ended", done);
            globalAudio.removeEventListener("error", done);
            globalAudio.removeEventListener("pause", done);
            resolve();
        };
        globalAudio.addEventListener("ended", done);
        globalAudio.addEventListener("error", done);
        globalAudio.addEventListener("pause", done);
        globalAudio.src = url;
        const p = globalAudio.play();
        if (p && p.catch) p.catch(() => done());
    });
}

// Timed delay used when there's no audio (TTS offline). Resolves early if the
// user pauses so the session stops responsively.
function readingDelay(text) {
    const total = Math.max(2500, (text ? text.length : 0) * 45);
    const start = Date.now();
    return new Promise(resolve => {
        const tick = () => {
            if (state.stopRequested || Date.now() - start >= total) { resolve(); return; }
            setTimeout(tick, 150);
        };
        tick();
    });
}

// Status line helper
function setTurnStatus(msg, spinnerOn) {
    const statusMsgEl = activeSpeakerStatusEl.querySelector(".status-msg");
    const spinner = activeSpeakerStatusEl.querySelector(".status-spinner");
    if (statusMsgEl) statusMsgEl.textContent = msg;
    if (spinner) spinner.classList.toggle("hidden", !spinnerOn);
}

// Speaking visuals on the active message bubble + sidebar waveform
function applySpeakingVisuals(speaker) {
    const messageCards = document.querySelectorAll(".message-card");
    const lastCard = messageCards[messageCards.length - 1];
    if (lastCard) {
        lastCard.classList.add("speaking-bubble");
        lastCard.style.setProperty("--speaker-glow", `${speaker.color}35`);
        lastCard.style.setProperty("--speaker-border", speaker.color);
    }
    const activeCard = document.getElementById(`persona-card-${speaker.id}`);
    if (activeCard) {
        const w = activeCard.querySelector(".waveform-container");
        if (w) w.classList.remove("hidden");
    }
}

function clearSpeakingVisuals() {
    document.querySelectorAll(".message-card").forEach(c => c.classList.remove("speaking-bubble"));
    document.querySelectorAll(".persona-card").forEach(c => {
        const w = c.querySelector(".waveform-container");
        if (w) w.classList.add("hidden");
    });
}

// Per-turn cleanup run by the loop after a turn fully resolves.
function finishTurnCleanup() {
    clearSpeakingVisuals();
    if (state.isRunning) setTurnStatus("Waiting...", false);
}

// Centralized turn error handling: skip transient failures to keep a marathon
// run alive; stop only after too many failures in a row.
function handleTurnError(speaker, error) {
    console.error("Error processing speaker turn:", error);
    state.consecutiveErrors++;

    if (state.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        setTurnStatus(`Stopped after ${state.consecutiveErrors} errors: ${error.message}`, false);
        renderSystemErrorMsg(`System: Paused after ${state.consecutiveErrors} consecutive failures. Last error from ${speaker.name}: ${error.message}`);
        pauseDiscussion();
        return;
    }
    setTurnStatus(`${speaker.name} stumbled, skipping... (${error.message})`, false);
    renderSystemErrorMsg(`System: ${speaker.name} failed this turn (${error.message}). Skipping ahead.`);
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

// Render a Story Mode narrator stage direction in the feed (italic, full-width).
function renderNarratorBubble(narr) {
    const el = document.createElement("div");
    el.className = "narrator-direction";

    const icon = document.createElement("i");
    icon.className = "fa-solid fa-clapperboard narrator-icon";

    const text = document.createElement("span");
    text.className = "narrator-text";
    text.textContent = narr.text;

    el.appendChild(icon);
    el.appendChild(text);

    if (narr.audio_url) {
        const btn = document.createElement("button");
        btn.className = "narrator-replay";
        btn.title = "Replay narration";
        btn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
        btn.addEventListener("click", () => {
            globalAudio.pause();
            globalAudio.src = narr.audio_url;
            globalAudio.play();
        });
        el.appendChild(btn);
    }

    chatFeedEl.appendChild(el);
    chatFeedEl.scrollTop = chatFeedEl.scrollHeight;
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
