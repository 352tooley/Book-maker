/* ===========================
   Book Maker – app.js
   Final Stable Build
   =========================== */

const STATE_KEY = "bookmaker_state_vFINAL";

let state = {
  chapters: [],
  currentChapterId: null,
  settings: { aiEndpoint: "", aiToken: "" }
};

const $ = (id) => document.getElementById(id);
const uid = () => crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random();

function sanitize(html) {
  return window.DOMPurify ? DOMPurify.sanitize(html) : html;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;"
  }[c]));
}

/* ---------- Persistence ---------- */
function saveState() {
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}
function loadState() {
  const raw = localStorage.getItem(STATE_KEY);
  if (raw) state = { ...state, ...JSON.parse(raw) };

  if (!state.chapters.length) addChapter("Chapter 1", true);

  $("aiEndpoint").value = state.settings.aiEndpoint || "";
  $("aiToken").value = state.settings.aiToken || "";

  renderChapters();
  switchChapter(state.currentChapterId || state.chapters[0].id);
}

/* ---------- Chapters ---------- */
function addChapter(title = "New Chapter", silent = false) {
  const ch = { id: uid(), title, content: "", wordCount: 0 };
  state.chapters.push(ch);
  state.currentChapterId = ch.id;
  renderChapters();
  switchChapter(ch.id);
  if (!silent) saveState();
}

function renderChapters() {
  $("chapterList").innerHTML = state.chapters.map(c => `
    <div class="chapter ${c.id === state.currentChapterId ? "active" : ""}" onclick="switchChapter('${c.id}')">
      <strong>${escapeHtml(c.title)}</strong><br>
      <small>${c.wordCount || 0} words</small>
    </div>
  `).join("");
}

function switchChapter(id) {
  saveCurrentChapter();
  const ch = state.chapters.find(c => c.id === id);
  if (!ch) return;
  state.currentChapterId = id;
  $("chapterTitle").value = ch.title;
  $("editor").innerHTML = ch.content || "";
  renderChapters();
}

/* ---------- Editor ---------- */
function countWords(html) {
  return html.replace(/<[^>]+>/g, "").trim().split(/\s+/).filter(Boolean).length;
}

function saveCurrentChapter() {
  const ch = state.chapters.find(c => c.id === state.currentChapterId);
  if (!ch) return;

  const clean = sanitize($("editor").innerHTML);
  ch.title = $("chapterTitle").value || "Untitled";
  ch.content = clean;
  ch.wordCount = countWords(clean);

  saveState();
}

$("editor").addEventListener("input", () => {
  clearTimeout(window._saveTimer);
  window._saveTimer = setTimeout(saveCurrentChapter, 400);
});
$("chapterTitle").addEventListener("input", () => {
  clearTimeout(window._saveTimer);
  window._saveTimer = setTimeout(saveCurrentChapter, 400);
});

/* ---------- Undo ---------- */
let undoStack = [];
function saveUndoPoint() {
  const ch = state.chapters.find(c => c.id === state.currentChapterId);
  if (!ch) return;
  undoStack.push(ch.content);
  if (undoStack.length > 20) undoStack.shift();
}
function undo() {
  const prev = undoStack.pop();
  if (!prev) return alert("Nothing to undo");
  $("editor").innerHTML = prev;
  saveCurrentChapter();
}

/* ---------- Scene Break ---------- */
function insertSceneBreak() {
  document.execCommand("insertHTML", false, `<hr class="scene-break">`);
  saveCurrentChapter();
}

/* ---------- DOCX IMPORT ---------- */
function wireDocxInput() {
  const input = $("docxInput");
  input.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    console.log("DOCX PICKED:", file);
    if (!file) return;

    if (!confirm("This will REPLACE all chapters. Continue?")) return;

    const buf = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer: buf });

    importHtmlAsChapters(result.value);
    e.target.value = "";
  });

  console.log("DOCX import wired");
}

/* === SMART CHAPTER DETECTOR === */
function importHtmlAsChapters(html) {
  const container = document.createElement("div");
  container.innerHTML = html;

  const blocks = Array.from(container.querySelectorAll("p, h1, h2, h3, h4, h5, h6"));

  let chapters = [];
  let current = null;

  function isChapterTitle(text) {
    const t = text.trim();
    if (!t) return false;

    return (
      /^chapter\s+\d+/i.test(t) ||
      /^chapter\s+[ivxlcdm]+/i.test(t) ||
      /^chapter\s+\w+/i.test(t) ||
      /^part\s+[ivxlcdm\d]+/i.test(t) ||
      /^(prologue|epilogue)$/i.test(t) ||
      (
        t.length < 80 &&
        /^[A-Z0-9\s:'"“”‘’.,!?-]+$/.test(t) &&
        t.split(" ").length <= 10
      )
    );
  }

  function flush() {
    if (current) {
      current.content = current.content.join("");
      current.wordCount = countWords(current.content);
      chapters.push(current);
    }
  }

  for (const el of blocks) {
    const text = el.innerText.trim();

    if (isChapterTitle(text)) {
      flush();
      current = {
        id: uid(),
        title: text,
        content: [],
        wordCount: 0
      };
    } else {
      if (!current) {
        current = {
          id: uid(),
          title: "Introduction",
          content: [],
          wordCount: 0
        };
      }
      current.content.push(el.outerHTML);
    }
  }
  flush();

  if (!chapters.length) {
    alert("Could not detect chapters in this DOCX.");
    return;
  }

  state.chapters = chapters;
  state.currentChapterId = chapters[0].id;
  saveState();
  renderChapters();
  switchChapter(state.currentChapterId);

  alert(`Imported ${chapters.length} chapters.`);
}

/* ---------- AI (Diff Mode) ---------- */
let aiSession = null;

function buildDiffHtml(a, b) {
  const dmp = new diff_match_patch();
  const diffs = dmp.diff_main(a, b);
  dmp.diff_cleanupSemantic(diffs);

  let out = "";
  for (const [op, data] of diffs) {
    const safe = escapeHtml(data);
    if (op === 0) out += safe;
    if (op === 1) out += `<ins>${safe}</ins>`;
    if (op === -1) out += `<del>${safe}</del>`;
  }
  return out;
}

async function runAI(mode) {
  const ep = state.settings.aiEndpoint;
  const tk = state.settings.aiToken;
  if (!ep || !tk) return alert("Configure AI in Settings first.");

  saveCurrentChapter();
  saveUndoPoint();

  const text = $("editor").innerText.trim();
  if (!text) return alert("Editor is empty.");

  aiSession = {
    originalHtml: $("editor").innerHTML,
    originalText: text
  };

  const resp = await fetch(ep, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-BookMaker-Token": tk
    },
    body: JSON.stringify({ mode, text })
  });

  if (!resp.ok) return alert("AI error " + resp.status);

  const data = await resp.json();
  const out =
    data.text ||
    data.output ||
    data.choices?.[0]?.message?.content ||
    "";

  $("editor").innerHTML = buildDiffHtml(text, out);
}

function aiRewrite() { runAI("rewrite"); }
function aiExpand() { runAI("expand"); }
function aiSummarize() { runAI("summarize"); }
function aiContinue() { runAI("continue"); }

function aiApply() {
  if (!aiSession) return;
  const text = $("editor").innerText;
  $("editor").innerHTML = `<p>${escapeHtml(text).replace(/\n/g, "</p><p>")}</p>`;
  aiSession = null;
  saveCurrentChapter();
}

function aiReject() {
  if (!aiSession) return;
  $("editor").innerHTML = aiSession.originalHtml;
  aiSession = null;
}

/* ---------- Settings ---------- */
function saveSettings() {
  state.settings.aiEndpoint = $("aiEndpoint").value.trim();
  state.settings.aiToken = $("aiToken").value.trim();
  saveState();
  closeSettings();
  alert("Settings saved!");
}

/* ---------- Init ---------- */
window.onload = () => {
  loadState();
  wireDocxInput();
};
window.onbeforeunload = () => saveCurrentChapter();
