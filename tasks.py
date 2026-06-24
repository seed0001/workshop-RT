"""
Task Extraction + DAG Execution System
======================================

A decoupled subsystem layered on top of the conversation engine. It observes
persona output, extracts CLEAR actionable tasks, classifies them (human vs AI),
and — for approved AI tasks — builds a lazily-expanded DAG that the user drives
step by step. Nothing here runs autonomously: every execution is user-triggered.

Layers (kept separate from the conversation layer in main.py):
  - extraction  : extract_from_text()           -> PENDING_TASKS
  - queue       : PENDING_TASKS
  - approval    : /api/tasks/approve
  - dag builder : /api/dag/create, /api/dag/expand  (lazy expansion)
  - execution   : /api/dag/execute                  (explicit handlers only)
"""

import os
import re
import json
import uuid
import logging
from typing import List, Dict, Any, Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger("persona-workshop.tasks")
router = APIRouter()

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
DAG_OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "workspace", "dag_output")

# ---------------------------------------------------------------------------
# In-memory stores (single-user local app). Future: persistence.
# ---------------------------------------------------------------------------
PENDING_TASKS: List[Dict[str, Any]] = []
DAGS: Dict[str, Dict[str, Any]] = {}

# Explicit handler set — node.handler must be one of these. No free-form exec.
ALLOWED_HANDLERS = {"generate_code", "create_files", "analyze_repo", "run_report", "research"}

# ---------------------------------------------------------------------------
# Extraction + classification (rule-based: only explicit intent, no inference)
# ---------------------------------------------------------------------------
# Strong multi-word intent markers (high confidence).
STRONG_TRIGGERS = [
    r"\bwe should\b", r"\bwe need to\b", r"\bwe have to\b", r"\bwe must\b",
    r"\bwe could\b", r"\bwe ought to\b", r"\blet'?s\b", r"\blet us\b", r"\bi suggest\b",
    r"\bi propose\b", r"\bi recommend\b", r"\byou should\b",
]
# Imperative verbs at the start of a sentence (medium confidence).
IMPERATIVE_START = re.compile(
    r"^(run|create|build|analyze|generate|implement|write|refactor|add|fix|design|"
    r"set up|review|research|test|deploy|draft|document|investigate|optimize)\b",
    re.IGNORECASE,
)

AI_KEYWORDS = {
    "code", "file", "files", "script", "function", "refactor", "implement", "generate",
    "analyze", "repo", "repository", "report", "api", "database", "db", "test", "tests",
    "build", "compile", "deploy", "class", "module", "endpoint", "schema", "parse",
    "data", "algorithm", "document", "readme", "config", "diagram", "dataset", "query",
    "regex", "json", "csv", "model", "prompt", "scrape", "summarize", "benchmark",
}
HUMAN_KEYWORDS = {
    "call", "email", "e-mail", "meet", "meeting", "hire", "buy", "purchase", "sign",
    "visit", "travel", "fly", "drive", "phone", "contact", "interview", "negotiate",
    "pay", "invest", "reach out", "talk to", "speak with", "speak to", "in person",
    "schedule a", "book a", "physically", "go to", "attend", "mail", "deliver",
}


def _classify(desc: str) -> str:
    low = desc.lower()
    has_human = any(k in low for k in HUMAN_KEYWORDS)
    has_ai = any(k in low for k in AI_KEYWORDS)
    if has_ai and not has_human:
        return "AI_CENTRIC"
    if has_human and not has_ai:
        return "HUMAN_CENTRIC"
    # Ambiguous or unknown -> default to HUMAN_CENTRIC (never auto-executable).
    return "HUMAN_CENTRIC"


# ---------------------------------------------------------------------------
# Assignment / ownership (additive — never blocks a task)
# ---------------------------------------------------------------------------
# Role aliases -> canonical owner label. Longer phrases are matched first.
ROLE_ALIASES = {
    "tech support": "Tech Support", "support": "Tech Support",
    "senior architect": "Senior Architect", "architect": "Senior Architect",
    "product strategist": "Product Strategist", "product": "Product Strategist",
    "security auditor": "Security Auditor", "security": "Security Auditor",
    "ux critic": "UX Critic", "ux": "UX Critic",
    "monetization strategist": "Monetization Strategist", "monetization": "Monetization Strategist",
    "growth": "Monetization Strategist",
    "backend engineer": "Backend Engineer", "backend": "Backend Engineer",
    "frontend engineer": "Frontend Engineer", "frontend": "Frontend Engineer",
    "hr director": "HR Director", "hr": "HR Director",
    "legal counsel": "Legal Counsel", "legal": "Legal Counsel",
    "sales director": "Sales Director", "sales": "Sales Director",
    "cto": "CTO", "ceo": "CEO", "cfo": "CFO", "cmo": "CMO", "coo": "COO",
}
_ROLE_ALT = "|".join(re.escape(a) for a in sorted(ROLE_ALIASES, key=len, reverse=True))
_ASSIGN_PATTERNS = [
    re.compile(rf"\b(?:need|needs|want|wants|have|get|tell|ask|asks|assign|assigns)\s+(?:the\s+)?({_ROLE_ALT})\b", re.IGNORECASE),
    re.compile(rf"\b({_ROLE_ALT})\s*,", re.IGNORECASE),
    re.compile(rf"\b({_ROLE_ALT})\s+(?:should|will|can|must|handle|handles|take|takes|own|owns)\b", re.IGNORECASE),
]


# Direct-instruction cues ("I need you to…", "can you…") that signal an
# actionable, assigned task even without one of the standard intent triggers.
_DIRECT_CUES = [
    re.compile(r"\b(?:i|we)\s+(?:need|want|would like|'d like)\s+(?:you|the\s+\w+|\w+)\s+to\b", re.IGNORECASE),
    re.compile(r"\bcan you\b", re.IGNORECASE),
]


def _has_assignment_cue(sentence: str) -> bool:
    """True if the sentence is phrased as an assignment/instruction, even if it
    lacks a standard intent trigger. Lets 'CTO, handle this' get extracted."""
    return (any(p.search(sentence) for p in _ASSIGN_PATTERNS) or
            any(p.search(sentence) for p in _DIRECT_CUES))


def _detect_assignment(sentence: str, source_persona: str):
    """Return (assigned_to, assignment_type). Explicit if another role is named
    in an assignment context; otherwise (None, 'inferred')."""
    for pat in _ASSIGN_PATTERNS:
        m = pat.search(sentence)
        if m:
            canon = ROLE_ALIASES.get(m.group(1).lower())
            if canon and canon.lower() != (source_persona or "").lower():
                return canon, "explicit"
    return None, "inferred"


def _infer_assignee(desc: str) -> str:
    """Default assignment when no explicit target. Always returns an owner."""
    low = desc.lower()
    if "analyze repo" in low or "analyse repo" in low or "review the repo" in low or "audit the code" in low:
        return "CTO"
    if re.search(r"\b(code|api|backend|endpoint|database|server|function|script)\b", low):
        return "Backend Engineer"
    if re.search(r"\b(ui|frontend|css|layout|interface|screen|button)\b", low):
        return "Frontend Engineer"
    if re.search(r"\b(report|finance|financial|budget|revenue|cost|pricing)\b", low):
        return "CFO"
    return "CTO"  # fallback


def _actionable(sentence: str):
    """Return (is_actionable, base_confidence) for a sentence."""
    if any(re.search(p, sentence, re.IGNORECASE) for p in STRONG_TRIGGERS):
        return True, 0.8
    if IMPERATIVE_START.match(sentence.strip()):
        return True, 0.65
    return False, 0.0


def extract_from_text(text: str, source_persona: str) -> List[Dict[str, Any]]:
    """Extract actionable tasks from a single message. Appends to PENDING_TASKS
    and returns the newly added tasks. Only explicit intent is captured."""
    new_tasks: List[Dict[str, Any]] = []
    if not text:
        return new_tasks

    sentences = re.split(r"(?<=[.!?])\s+|\n+", text)
    for raw in sentences:
        s = raw.strip().strip("-*•").strip()
        if len(s) < 8 or len(s) > 300:
            continue
        ok, conf = _actionable(s)
        if not ok and _has_assignment_cue(s):
            ok, conf = True, 0.7   # assignment-phrased instruction is actionable too
        if not ok:
            continue
        # Skip exact duplicates that are still pending (light guard, not full dedup).
        if any(t["description"].lower() == s.lower() and t["status"] == "pending" for t in PENDING_TASKS):
            continue
        assigned_to, assignment_type = _detect_assignment(s, source_persona)
        if assigned_to is None:
            assigned_to = _infer_assignee(s)        # always fall back, never blocks
            assignment_type = "inferred"
        task = {
            "id": "task_" + uuid.uuid4().hex[:8],
            "description": s,
            "source_persona": source_persona,
            "assigned_by": source_persona,
            "assigned_to": assigned_to,
            "assignment_type": assignment_type,
            "type": _classify(s),
            "confidence": round(conf, 2),
            "status": "pending",
        }
        PENDING_TASKS.append(task)
        new_tasks.append(task)

    if new_tasks:
        logger.info(f"Extracted {len(new_tasks)} task(s) from {source_persona}")
    return new_tasks


def _find_task(task_id: str) -> Optional[Dict[str, Any]]:
    return next((t for t in PENDING_TASKS if t["id"] == task_id), None)


# ---------------------------------------------------------------------------
# API: task queue + approval
# ---------------------------------------------------------------------------
@router.get("/api/tasks")
def list_tasks():
    return {"tasks": PENDING_TASKS}


class ApproveReq(BaseModel):
    task_id: str
    decision: str                      # "approve" | "reject" | "modify"
    description: Optional[str] = None   # new text when decision == "modify"


@router.post("/api/tasks/approve")
def approve_task(req: ApproveReq):
    task = _find_task(req.task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")
    decision = req.decision.lower()
    if decision == "approve":
        task["status"] = "approved"
    elif decision == "reject":
        task["status"] = "rejected"
    elif decision == "modify":
        if req.description:
            task["description"] = req.description.strip()
            task["type"] = _classify(task["description"])  # re-classify edited text
            at, atype = _detect_assignment(task["description"], task["source_persona"])
            if at is None:
                at, atype = _infer_assignee(task["description"]), "inferred"
            task["assigned_to"] = at
            task["assignment_type"] = atype
        task["status"] = "pending"
    else:
        raise HTTPException(status_code=400, detail="decision must be approve, reject, or modify.")
    return task


class TaskIdReq(BaseModel):
    task_id: str


@router.post("/api/tasks/complete")
def complete_task(req: TaskIdReq):
    """Mark a (typically HUMAN_CENTRIC) task done."""
    task = _find_task(req.task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")
    task["status"] = "completed"
    return task


# ---------------------------------------------------------------------------
# DAG builder (AI_CENTRIC only) with lazy expansion
# ---------------------------------------------------------------------------
def _infer_handler(action: str) -> str:
    low = action.lower()
    if any(k in low for k in ("create file", "write file", "save", "scaffold", "create files", "new file")):
        return "create_files"
    if any(k in low for k in ("analyze repo", "review the code", "analyze the project", "audit", "inspect the code", "review repo")):
        return "analyze_repo"
    if any(k in low for k in ("report", "summary", "summarize", "metrics", "benchmark")):
        return "run_report"
    if any(k in low for k in ("research", "look up", "find out", "investigate", "compare options")):
        return "research"
    return "generate_code"


def _make_node(action: str, handler: Optional[str] = None, deps: Optional[List[str]] = None,
               owner: Optional[str] = None) -> Dict[str, Any]:
    h = handler if handler in ALLOWED_HANDLERS else _infer_handler(action)
    return {
        "id": "node_" + uuid.uuid4().hex[:8],
        "action": action.strip(),
        "handler": h,
        "status": "pending",
        "dependencies": deps or [],
        "children": [],
        "type": "atomic",
        "owner": owner,            # inherited from the DAG's assigned_to
        "result": None,
    }


def _get_dag(dag_id: str) -> Dict[str, Any]:
    dag = DAGS.get(dag_id)
    if not dag:
        raise HTTPException(status_code=404, detail="DAG not found.")
    return dag


def _node_by_id(dag: Dict[str, Any], node_id: str) -> Optional[Dict[str, Any]]:
    return next((n for n in dag["nodes"] if n["id"] == node_id), None)


def _refresh_dag_status(dag: Dict[str, Any]) -> None:
    nodes = dag["nodes"]
    by_id = {n["id"]: n for n in nodes}
    # Parent (subdag) nodes complete when all their children complete.
    for _ in range(len(nodes)):
        changed = False
        for n in nodes:
            if n["children"]:
                child_states = [by_id[c]["status"] for c in n["children"] if c in by_id]
                if child_states and all(s == "complete" for s in child_states) and n["status"] != "complete":
                    n["status"] = "complete"
                    changed = True
        if not changed:
            break
    if all(n["status"] == "complete" for n in nodes):
        dag["status"] = "complete"
    elif any(n["status"] in ("running", "complete") for n in nodes):
        dag["status"] = "running"


class DagCreateReq(BaseModel):
    task_id: str


@router.post("/api/dag/create")
def dag_create(req: DagCreateReq):
    task = _find_task(req.task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")
    if task["type"] != "AI_CENTRIC":
        raise HTTPException(status_code=400, detail="Only AI_CENTRIC tasks can become DAGs.")
    if task["status"] != "approved":
        raise HTTPException(status_code=400, detail="Approve the task before building a DAG.")

    owner = task.get("assigned_to")
    root = _make_node(task["description"], owner=owner)
    dag = {
        "id": "dag_" + uuid.uuid4().hex[:8],
        "goal": task["description"],
        "status": "pending",
        "task_id": task["id"],
        "assigned_to": owner,
        "assigned_by": task.get("assigned_by"),
        "nodes": [root],
        "root_id": root["id"],
    }
    DAGS[dag["id"]] = dag
    return dag


async def _ollama_chat(messages: List[Dict[str, str]], model: str, temperature: float = 0.4) -> str:
    async with httpx.AsyncClient(timeout=90.0) as client:
        payload = {"model": model, "messages": messages, "options": {"temperature": temperature}, "stream": False}
        res = await client.post(f"{OLLAMA_URL}/api/chat", json=payload)
        if res.status_code != 200:
            raise HTTPException(status_code=res.status_code, detail=f"Ollama error: {res.text[:200]}")
        return res.json().get("message", {}).get("content", "").strip()


def _parse_json_steps(text: str) -> List[Dict[str, str]]:
    """Best-effort parse of a JSON array of {action, handler} from model output."""
    match = re.search(r"\[.*\]", text, re.DOTALL)
    if match:
        try:
            data = json.loads(match.group(0))
            steps = []
            for item in data:
                if isinstance(item, dict) and item.get("action"):
                    steps.append({
                        "action": str(item["action"]).strip(),
                        "handler": str(item.get("handler", "")).strip(),
                    })
                elif isinstance(item, str) and item.strip():
                    steps.append({"action": item.strip(), "handler": ""})
            if steps:
                return steps[:6]
        except Exception:
            pass
    # Fallback: split numbered/bulleted lines.
    steps = []
    for line in text.splitlines():
        line = re.sub(r"^\s*(\d+[\.\)]|[-*•])\s*", "", line).strip()
        if len(line) > 4:
            steps.append({"action": line, "handler": ""})
    return steps[:6]


class DagExpandReq(BaseModel):
    dag_id: str
    node_id: str
    model: str


@router.post("/api/dag/expand")
async def dag_expand(req: DagExpandReq):
    """Lazily expand a single node into an ordered chain of child sub-steps."""
    dag = _get_dag(req.dag_id)
    node = _node_by_id(dag, req.node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found.")
    if node["children"]:
        raise HTTPException(status_code=400, detail="Node is already expanded.")

    system = (
        "You are a planning engine. Break the given task into 2-5 concrete, ordered, "
        "atomic sub-steps that a local automation system can perform. "
        "Respond ONLY with a JSON array, no prose. Each element has: "
        '"action" = a short human-readable imperative describing the step, and '
        '"handler" = exactly one of: generate_code, create_files, analyze_repo, run_report, research.\n'
        'Example for "Build a Redis caching layer":\n'
        '[{"action":"Research Redis client libraries for our stack","handler":"research"},'
        '{"action":"Generate the cache wrapper module","handler":"generate_code"},'
        '{"action":"Write the cache module to a file","handler":"create_files"}]'
    )
    try:
        raw = await _ollama_chat(
            [{"role": "system", "content": system},
             {"role": "user", "content": f"Task to decompose: {node['action']}"}],
            req.model,
        )
        steps = _parse_json_steps(raw)
    except HTTPException:
        steps = []

    if not steps:
        # Graceful fallback so the UI still gets a usable sub-DAG.
        steps = [{"action": f"Execute: {node['action']}", "handler": node["handler"]}]

    children: List[str] = []
    prev_id: Optional[str] = None
    for st in steps:
        child = _make_node(st["action"], st.get("handler") or None,
                           deps=[prev_id] if prev_id else [],
                           owner=node.get("owner"))  # inherit ownership down the DAG
        prev_id = child["id"]
        dag["nodes"].append(child)
        children.append(child["id"])

    node["children"] = children
    node["type"] = "subdag"
    _refresh_dag_status(dag)
    return dag


# ---------------------------------------------------------------------------
# Execution engine — explicit handlers only, one step at a time
# ---------------------------------------------------------------------------
def _deps_met(dag: Dict[str, Any], node: Dict[str, Any]) -> bool:
    by_id = {n["id"]: n for n in dag["nodes"]}
    return all(by_id.get(d, {}).get("status") == "complete" for d in node["dependencies"])


def _next_executable(dag: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    for n in dag["nodes"]:
        if n["status"] == "pending" and not n["children"] and _deps_met(dag, n):
            return n
    return None


def _sanitize_filename(name: str) -> str:
    name = os.path.basename(name.strip().replace("\\", "/").split("/")[-1])
    name = re.sub(r"[^A-Za-z0-9_.\-]", "_", name)
    return name or "output.txt"


def _actor_prefix(context: Optional[Dict[str, Any]]) -> str:
    """Role-aware preamble built from the execution context (node owner)."""
    actor = (context or {}).get("actor")
    return f"You are acting as the {actor}. " if actor else ""


async def _handler_generate_code(node, dag, model, context=None) -> str:
    return await _ollama_chat(
        [{"role": "system", "content": _actor_prefix(context) + "You are a senior engineer. Produce the code for the requested step with a one-line explanation. Be concise."},
         {"role": "user", "content": node["action"]}],
        model, temperature=0.3,
    )


async def _handler_analyze_repo(node, dag, model, context=None) -> str:
    # Read-only: reuse the loaded Project Mode context if present.
    proj_ctx = ""
    try:
        import main  # lazy import avoids circular import at module load
        proj_ctx = main._project_context(0)
    except Exception:
        proj_ctx = ""
    if not proj_ctx:
        return "No project is loaded in Project Mode, so there is nothing to analyze. Load a repo first."
    return await _ollama_chat(
        [{"role": "system", "content": _actor_prefix(context) + "You are a code reviewer. Analyze the project context for the requested step. Cite files. Be concise."},
         {"role": "user", "content": f"{proj_ctx}\n\nStep: {node['action']}"}],
        model, temperature=0.3,
    )


async def _handler_run_report(node, dag, model, context=None) -> str:
    return await _ollama_chat(
        [{"role": "system", "content": _actor_prefix(context) + "You are an analyst. Produce a short structured report for the requested step. No code execution."},
         {"role": "user", "content": node["action"]}],
        model, temperature=0.4,
    )


async def _handler_research(node, dag, model, context=None) -> str:
    return await _ollama_chat(
        [{"role": "system", "content": _actor_prefix(context) + "You are a research assistant. Answer the research question from your knowledge. State assumptions. Be concise. (No live internet access.)"},
         {"role": "user", "content": node["action"]}],
        model, temperature=0.5,
    )


async def _handler_create_files(node, dag, model, context=None) -> str:
    # Generate a single file's content, then write it ONLY inside the sandboxed
    # per-DAG output directory (path-sanitized). Contained, never arbitrary.
    raw = await _ollama_chat(
        [{"role": "system", "content": _actor_prefix(context) + (
            "Produce one file to satisfy the step. Respond ONLY as JSON: "
            '{"filename": "<name.ext>", "content": "<file contents>"}.')},
         {"role": "user", "content": node["action"]}],
        model, temperature=0.3,
    )
    filename, content = "output.txt", raw
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if m:
        try:
            data = json.loads(m.group(0))
            filename = _sanitize_filename(str(data.get("filename", "output.txt")))
            content = str(data.get("content", ""))
        except Exception:
            pass
    out_dir = os.path.join(DAG_OUTPUT_DIR, dag["id"])
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, filename)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    rel = os.path.relpath(path, os.path.dirname(__file__)).replace("\\", "/")
    preview = content[:400] + ("…" if len(content) > 400 else "")
    return f"Wrote file: {rel}\n\n{preview}"


_HANDLERS = {
    "generate_code": _handler_generate_code,
    "create_files": _handler_create_files,
    "analyze_repo": _handler_analyze_repo,
    "run_report": _handler_run_report,
    "research": _handler_research,
}


class DagExecuteReq(BaseModel):
    dag_id: str
    model: str
    node_id: Optional[str] = None   # execute a specific node, else the next ready one


@router.post("/api/dag/execute")
async def dag_execute(req: DagExecuteReq):
    dag = _get_dag(req.dag_id)
    if dag["status"] == "cancelled":
        raise HTTPException(status_code=400, detail="This DAG was cancelled.")

    if req.node_id:
        node = _node_by_id(dag, req.node_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found.")
        if node["children"]:
            raise HTTPException(status_code=400, detail="That node is a sub-DAG; execute its children.")
        if node["status"] == "complete":
            raise HTTPException(status_code=400, detail="Node already complete.")
        if not _deps_met(dag, node):
            raise HTTPException(status_code=400, detail="Node has unmet dependencies.")
    else:
        node = _next_executable(dag)

    if not node:
        pending = [n for n in dag["nodes"] if n["status"] == "pending" and not n["children"]]
        _refresh_dag_status(dag)
        return {"executed": None, "blocked": bool(pending), "done": not pending, "dag": dag}

    handler = _HANDLERS.get(node["handler"], _handler_generate_code)
    node["status"] = "running"
    # Execution context — lets handlers be role-aware without changing call sites.
    context = {"actor": node.get("owner"), "task_goal": dag.get("goal")}
    try:
        result = await handler(node, dag, req.model, context)
    except HTTPException as e:
        node["status"] = "pending"
        raise e
    except Exception as e:
        node["status"] = "pending"
        logger.error(f"Node execution failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    node["result"] = result
    node["status"] = "complete"
    _refresh_dag_status(dag)
    return {"executed": node, "result": result, "dag": dag}


@router.get("/api/dags")
def list_dags():
    return {"dags": list(DAGS.values())}


@router.get("/api/dag/{dag_id}")
def get_dag(dag_id: str):
    return _get_dag(dag_id)


class DagIdReq(BaseModel):
    dag_id: str


@router.post("/api/dag/cancel")
def dag_cancel(req: DagIdReq):
    dag = _get_dag(req.dag_id)
    dag["status"] = "cancelled"
    return dag
