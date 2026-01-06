/* ===========================
   Book Maker – app.js
   PHASE 2: INLINE DIFF IN EDITOR
   =========================== */

const STATE_KEY = "bookmaker_state_v6";

let state = {
  chapters: [],
  currentChapterId: null,
  settings: {
    aiEndpoint: "",
    aiToken: "",
    mode: "rewrite",
    template: "default",
    model: "gpt-4o-mini",
    stream: true
  }
};

const $ = (id) => document.getElementById(id);
const uid = () => crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random();

function sanitize(html) {
  return window.DOMPurify ? DOMPurify.sanitize(html, { USE_PROFILES: { html: true } }) : html;
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
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

  if ($("aiEndpoint")) $("aiEndpoint").value = state.settings.aiEndpoint || "";
  if ($("aiToken")) $("aiToken").value = state.settings.aiToken || "";

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
    <div class="chapter ${c.id === state.currentChapterId ? "active" : ""}"
      onclick="switchChapter('${c.id}')">
      <strong>${escapeHtml(c.title)}</strong><br>
      <small>${c.wordCount || 0} words</small>
    </div>
  `).join("");
}

function switchChapter(id) {
  saveCurrentChapter(false);
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
  window._saveTimer = setTimeout(saveCurrentChapter, 500);
});

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

/* ---------- AI SESSION ---------- */
let aiSession = {
  active: false,
  originalHtml: "",
  originalText: "",
  outputText: "",
  target: "chapter", // or selection or append
  selectionRange: null
};

/* ---------- Diff Engine ---------- */
function buildInlineDiffHtml(beforeText, afterText) {
  const dmp = new diff_match_patch();
  const diffs = dmp.diff_main(beforeText, afterText);
  dmp.diff_cleanupSemantic(diffs);

  let html = "";
  for (const [op, data] of diffs) {
    const safe = escapeHtml(data);
    if (op === 0) html += safe;
    if (op === 1) html += `<ins style="background:#d1fae5;">${safe}</ins>`;
    if (op === -1) html += `<del style="background:#fee2e2;">${safe}</del>`;
  }
  return html;
}

/* ---------- Selection Helpers ---------- */
function captureSelectionRange() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!$("editor").contains(range.commonAncestorContainer)) return null;
  return range.cloneRange();
}

/* ---------- AI ---------- */
function aiRewrite(){ runAI("rewrite"); }
function aiExpand(){ runAI("expand"); }
function aiSummarize(){ runAI("summarize"); }
function aiContinue(){ runAI("continue"); }

async function runAI(mode) {
  const endpoint = state.settings.aiEndpoint;
  const token = state.settings.aiToken;
  if (!endpoint || !token) return alert("Set AI settings first.");

  saveCurrentChapter();
  saveUndoPoint();

  aiSession = { active: true };

  const selRange = captureSelectionRange();
  let text = "";
  let target = "chapter";

  if (mode === "continue") {
    text = $("editor").innerText;
    target = "append";
  } else if (selRange && selRange.toString().trim()) {
    text = selRange.toString();
    target = "selection";
    aiSession.selectionRange = selRange;
  } else {
    text = $("editor").innerText;
  }

  if (!text.trim()) return alert("Nothing to send to AI.");

  aiSession.target = target;
  aiSession.originalHtml = $("editor").innerHTML;
  aiSession.originalText = $("editor").innerText;

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
    body: JSON.stringify({ instruction, text, mode })
  });

  if (!resp.ok) return alert("AI error");

  const data = await resp.json();
  const outText = data.text || data.output || data.choices?.[0]?.message?.content || "";
  aiSession.outputText = outText;

  applyInlineDiff();
}

/* ---------- INLINE DIFF APPLY ---------- */
function applyInlineDiff() {
  if (aiSession.target === "append") {
    const diffHtml = `<ins style="background:#d1fae5;">${escapeHtml(aiSession.outputText)}</ins>`;
    $("editor").insertAdjacentHTML("beforeend", diffHtml);
    return;
  }

  if (aiSession.target === "selection" && aiSession.selectionRange) {
    const range = aiSession.selectionRange;
    const before = range.toString();
    const diffHtml = buildInlineDiffHtml(before, aiSession.outputText);

    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand("insertHTML", false, diffHtml);
    return;
  }

  // Whole chapter
  const diffHtml = buildInlineDiffHtml(aiSession.originalText, aiSession.outputText);
  $("editor").innerHTML = diffHtml;
}

/* ---------- Apply / Reject ---------- */
function aiApply() {
  if (!aiSession.active) return;

  if (aiSession.target === "append") {
    $("editor").innerHTML = aiSession.originalHtml + sanitize(`<p>${escapeHtml(aiSession.outputText)}</p>`);
  } else {
    $("editor").innerHTML = sanitize(`<p>${escapeHtml(aiSession.outputText).replace(/\n/g,"</p><p>")}</p>`);
  }

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
  alert("Settings saved");
}

/* ---------- Init ---------- */
window.onload = loadState;
window.onbeforeunload = () => saveCurrentChapter();
