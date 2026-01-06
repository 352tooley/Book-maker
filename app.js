/* ===========================
   Book Maker – app.js (FULL)
   =========================== */

const STATE_KEY = "bookmaker_state_v3";
const BACKUP_KEY = "bookmaker_backup_v3";

let state = {
  chapters: [],
  currentChapterId: null,
  lastTotalWords: 0,
  today: new Date().toDateString(),
  todayWords: 0,
  settings: {
    aiEndpoint: "",
    aiToken: "",
    mode: "rewrite",
    template: "default",
    model: "gpt-4o-mini",
    stream: true
  }
};

/* ---------- Utils ---------- */
const $ = (id) => document.getElementById(id);
const uid = () => crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random();

function sanitize(html) {
  if (window.DOMPurify) {
    return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  }
  return html;
}

/* ---------- Persistence ---------- */
function saveState(showStatus = true) {
  if (showStatus && $("saveStatus")) $("saveStatus").textContent = "Saving…";
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
  if (showStatus && $("saveStatus")) {
    setTimeout(() => $("saveStatus").textContent = "Saved ✓", 300);
  }
}

function loadState() {
  const raw = localStorage.getItem(STATE_KEY);
  if (raw) state = { ...state, ...JSON.parse(raw) };

  if (!state.chapters.length) {
    addChapter("Chapter 1", true);
  }

  renderChapters();
  switchChapter(state.currentChapterId || state.chapters[0].id);

  // Load settings UI if present
  if ($("aiEndpoint")) $("aiEndpoint").value = state.settings.aiEndpoint || "";
  if ($("aiToken")) $("aiToken").value = state.settings.aiToken || "";
  if ($("aiMode")) $("aiMode").value = state.settings.mode || "rewrite";
  if ($("aiTemplate")) $("aiTemplate").value = state.settings.template || "default";
  if ($("aiModel")) $("aiModel").value = state.settings.model || "gpt-4o-mini";
  if ($("aiStream")) $("aiStream").checked = !!state.settings.stream;
}

/* Auto-backup every 5 minutes */
setInterval(() => {
  localStorage.setItem(BACKUP_KEY, JSON.stringify(state));
}, 5 * 60 * 1000);

/* ---------- Chapters ---------- */
function addChapter(title = "New Chapter", silent = false) {
  const chapter = {
    id: uid(),
    title,
    content: "",
    wordCount: 0
  };
  state.chapters.push(chapter);
  state.currentChapterId = chapter.id;
  renderChapters();
  switchChapter(chapter.id);
  saveState(!silent);
}

function deleteChapter(id) {
  if (!confirm("Delete this chapter?")) return;
  state.chapters = state.chapters.filter(c => c.id !== id);
  state.currentChapterId = state.chapters[0]?.id || null;
  renderChapters();
  if (state.currentChapterId) switchChapter(state.currentChapterId);
  saveState();
}

function renderChapters() {
  if (!$("chapterList")) return;
  $("chapterList").innerHTML = state.chapters.map(c => `
    <div class="chapter ${c.id === state.currentChapterId ? "active" : ""}"
      onclick="switchChapter('${c.id}')">
      <strong>${c.title}</strong><br>
      <small>${c.wordCount} words</small>
      <button class="danger" onclick="event.stopPropagation();deleteChapter('${c.id}')">✕</button>
    </div>
  `).join("");
}

function switchChapter(id) {
  saveCurrentChapter(false);
  const ch = state.chapters.find(c => c.id === id);
  if (!ch) return;
  state.currentChapterId = id;
  if ($("chapterTitle")) $("chapterTitle").value = ch.title;
  if ($("editor")) $("editor").innerHTML = ch.content;
  renderChapters();
}

/* ---------- Editor ---------- */
function saveCurrentChapter(showStatus = true) {
  const ch = state.chapters.find(c => c.id === state.currentChapterId);
  if (!ch) return;

  const clean = sanitize($("editor").innerHTML);
  ch.title = $("chapterTitle").value || "Untitled";
  ch.content = clean;
  ch.wordCount = countWords(clean);

  updateWordCounts();
  saveState(showStatus);
}

if ($("editor")) {
  $("editor").addEventListener("input", () => {
    if ($("saveStatus")) $("saveStatus").textContent = "Typing…";
    clearTimeout(window._saveTimer);
    window._saveTimer = setTimeout(() => saveCurrentChapter(), 600);
  });

  $("editor").addEventListener("paste", e => {
    e.preventDefault();
    document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
  });
}

if ($("chapterTitle")) {
  $("chapterTitle").addEventListener("input", () => {
    if ($("saveStatus")) $("saveStatus").textContent = "Typing…";
    clearTimeout(window._saveTimer);
    window._saveTimer = setTimeout(() => saveCurrentChapter(), 600);
  });
}

/* ---------- Word Counts ---------- */
function countWords(html) {
  return html.replace(/<[^>]+>/g, "").trim().split(/\s+/).filter(Boolean).length;
}

function updateWordCounts() {
  const total = state.chapters.reduce((s, c) => s + c.wordCount, 0);
  if ($("totalWords")) $("totalWords").textContent = total.toLocaleString();

  const today = new Date().toDateString();
  if (today !== state.today) {
    state.today = today;
    state.todayWords = 0;
    state.lastTotalWords = total;
  }

  const delta = total - state.lastTotalWords;
  if (delta > 0) state.todayWords += delta;
  state.lastTotalWords = total;
}

/* ---------- Undo ---------- */
let undoStack = [];

function saveUndoPoint() {
  const ch = state.chapters.find(c => c.id === state.currentChapterId);
  if (!ch) return;
  undoStack.push({ chapterId: ch.id, content: ch.content });
  if (undoStack.length > 10) undoStack.shift();
}

function undo() {
  const last = undoStack.pop();
  if (!last) return alert("Nothing to undo");
  const ch = state.chapters.find(c => c.id === last.chapterId);
  if (ch) {
    ch.content = last.content;
    ch.wordCount = countWords(last.content);
    switchChapter(ch.id);
    saveState();
  }
}

/* ---------- Settings ---------- */
function saveSettings() {
  state.settings.aiEndpoint = $("aiEndpoint").value.trim();
  state.settings.aiToken = $("aiToken").value.trim();
  state.settings.mode = $("aiMode").value;
  state.settings.template = $("aiTemplate").value;
  state.settings.model = $("aiModel").value;
  state.settings.stream = $("aiStream").checked;
  saveState();
  alert("Settings saved");
}

/* ---------- AI CORE ---------- */
async function aiRun() {
  const endpoint = state.settings.aiEndpoint;
  const token = state.settings.aiToken;

  if (!endpoint || !token) {
    alert("Configure AI settings first.");
    return;
  }

  // Get text
  const sel = window.getSelection();
  let text = sel ? sel.toString() : "";
  if (!text || !text.trim()) text = $("editor").innerText || "";
  if (!text.trim()) return alert("Editor is empty.");

  saveUndoPoint();

  const mode = state.settings.mode;
  const template = state.settings.template;
  const model = state.settings.model;
  const stream = state.settings.stream;

  const body = {
    instruction: mode === "rewrite" ? "Rewrite this text" :
                 mode === "expand" ? "Expand this text" :
                 mode === "summarize" ? "Summarize this text" :
                 "Continue writing",
    text,
    mode,
    template,
    model,
    chapter: $("editor").innerText,
    stream
  };

  if ($("saveStatus")) $("saveStatus").textContent = "AI working…";

  if (!stream) {
    // Non-streaming
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BookMaker-Token": token
      },
      body: JSON.stringify(body)
    });

    const data = await resp.json();
    const clean = sanitize(data.text || "");

    document.execCommand("insertHTML", false, `<p>${clean}</p>`);
    saveCurrentChapter();
    return;
  }

  // Streaming
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-BookMaker-Token": token,
      "Accept": "text/event-stream"
    },
    body: JSON.stringify(body)
  });

  if (!resp.body) {
    alert("Streaming failed");
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  let insertPos = document.createElement("span");
  insertPos.id = "ai-stream-anchor";
  $("editor").appendChild(insertPos);

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      const line = chunk.split("\n").find(l => l.startsWith("data:"));
      if (!line) continue;

      const payload = line.slice(5).trim();
      if (!payload) continue;

      let evt;
      try { evt = JSON.parse(payload); } catch { continue; }

      if (evt.delta) {
        insertPos.insertAdjacentText("beforebegin", evt.delta);
      }
    }
  }

  insertPos.remove();
  saveCurrentChapter();
}

/* ---------- Button Hooks ---------- */
function aiRewrite() { state.settings.mode = "rewrite"; aiRun(); }
function aiExpand() { state.settings.mode = "expand"; aiRun(); }
function aiSummarize() { state.settings.mode = "summarize"; aiRun(); }
function aiContinue() { state.settings.mode = "continue"; aiRun(); }

/* ---------- Init ---------- */
window.onload = loadState;
window.onbeforeunload = () => saveCurrentChapter(false);
