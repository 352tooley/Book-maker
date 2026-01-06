/* ===========================
   Book Maker – app.js
   Browser-safe build
   =========================== */

const STATE_KEY = "bookmaker_state_v10";

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
  const list = $("chapterList");
  list.innerHTML = state.chapters.map(c => `
    <div class="chapter ${c.id === state.currentChapterId ? "active" : ""}" data-id="${c.id}">
      <strong>${escapeHtml(c.title)}</strong><br>
      <small>${c.wordCount || 0} words</small>
    </div>
  `).join("");

  Sortable.create(list, {
    animation: 150,
    onEnd: () => {
      const ids = [...list.children].map(el => el.dataset.id);
      state.chapters = ids.map(id => state.chapters.find(c => c.id === id));
      saveState();
    }
  });

  [...list.children].forEach(el => {
    el.onclick = () => switchChapter(el.dataset.id);
  });
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

  updateWordCounts();
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

/* ---------- Word Count ---------- */
function updateWordCounts() {
  const total = state.chapters.reduce((s, c) => s + (c.wordCount || 0), 0);
  $("totalWords").textContent = total.toLocaleString();
}

/* ---------- Undo ---------- */
let undoStack = [];
function saveUndoPoint() {
  const ch = state.chapters.find(c => c.id === state.currentChapterId);
  if (!ch) return;
  undoStack.push({ id: ch.id, content: ch.content });
  if (undoStack.length > 20) undoStack.shift();
}
function undo() {
  const last = undoStack.pop();
  if (!last) return alert("Nothing to undo");
  const ch = state.chapters.find(c => c.id === last.id);
  if (!ch) return;
  ch.content = last.content;
  $("editor").innerHTML = ch.content;
  saveState();
}

/* ---------- Scene Break ---------- */
function insertSceneBreak() {
  document.execCommand("insertHTML", false, `<hr class="scene-break">`);
  saveCurrentChapter();
}

/* ---------- DOCX IMPORT ---------- */
function wireDocxInput() {
  const input = document.getElementById("docxInput");
  if (!input) {
    console.error("docxInput not found");
    return;
  }

  input.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    console.log("DOCX PICKED:", file);
    if (!file) return;

    if (!confirm("Importing will REPLACE all chapters. Continue?")) return;

    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer });

    importHtmlAsChapters(result.value);
    e.target.value = "";
  });

  console.log("DOCX import wired");
}

function importHtmlAsChapters(html) {
  const container = document.createElement("div");
  container.innerHTML = html;
  const nodes = [...container.childNodes];

  let chapters = [];
  let current = null;

  function flush() {
    if (current) {
      current.content = current.content.join("");
      current.wordCount = countWords(current.content);
      chapters.push(current);
    }
  }

  for (const node of nodes) {
    if (node.nodeType === 1 && /^H[1-3]$/i.test(node.tagName)) {
      flush();
      current = { id: uid(), title: node.innerText.trim() || "Untitled", content: [], wordCount: 0 };
    } else {
      if (!current) current = { id: uid(), title: "Introduction", content: [], wordCount: 0 };
      current.content.push(node.outerHTML || node.textContent);
    }
  }
  flush();

  if (!chapters.length) return alert("No headings found in document.");

  state.chapters = chapters;
  state.currentChapterId = chapters[0].id;
  saveState();
  renderChapters();
  switchChapter(state.currentChapterId);
  alert("Imported " + chapters.length + " chapters.");
}

/* ---------- AI (simple non-stream diff) ---------- */
let aiSession = { active: false };

function buildInlineDiffHtml(beforeText, afterText) {
  const dmp = new diff_match_patch();
  const diffs = dmp.diff_main(beforeText, afterText);
  dmp.diff_cleanupSemantic(diffs);

  let html = "";
  for (const [op, data] of diffs) {
    const safe = escapeHtml(data);
    if (op === 0) html += safe;
    if (op === 1) html += `<ins>${safe}</ins>`;
    if (op === -1) html += `<del>${safe}</del>`;
  }
  return html;
}

async function runAI(mode) {
  const endpoint = state.settings.aiEndpoint;
  const token = state.settings.aiToken;
  if (!endpoint || !token) return alert("Configure AI settings first.");

  saveCurrentChapter();
  saveUndoPoint();

  const editor = $("editor");
  const text = editor.innerText.trim();
  if (!text) return alert("Editor is empty.");

  aiSession = {
    active: true,
    originalHtml: editor.innerHTML,
    originalText: editor.innerText
  };

  const instruction =
    mode === "rewrite" ? "Rewrite this text to improve clarity and style." :
    mode === "expand" ? "Expand this text with more detail." :
    mode === "summarize" ? "Summarize this text." :
    "Continue writing from here.";

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-BookMaker-Token": token
    },
    body: JSON.stringify({ mode, instruction, text })
  });

  if (!resp.ok) return alert("AI error " + resp.status);

  const data = await resp.json();
  const outText =
    data.text ||
    data.output ||
    data.choices?.[0]?.message?.content ||
    "";

  const diffHtml = buildInlineDiffHtml(aiSession.originalText, outText);
  editor.innerHTML = diffHtml;
}

function aiRewrite() { runAI("rewrite"); }
function aiExpand() { runAI("expand"); }
function aiSummarize() { runAI("summarize"); }
function aiContinue() { runAI("continue"); }

function aiApply() {
  if (!aiSession.active) return;
  const editor = $("editor");
  const clean = editor.innerText;
  editor.innerHTML = `<p>${escapeHtml(clean).replace(/\n/g, "</p><p>")}</p>`;
  aiSession.active = false;
  saveCurrentChapter();
}

function aiReject() {
  if (!aiSession.active) return;
  $("editor").innerHTML = aiSession.originalHtml;
  aiSession.active = false;
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
