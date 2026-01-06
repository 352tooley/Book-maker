/* ===========================
   Book Maker – app.js (PHASE 2: DIFF VIEW)
   - AI Preview panel + Diff tab
   - Word/phrase diff highlighting via diff-match-patch
   - Apply/Reject
   - Undo-safe AI apply
   =========================== */

const STATE_KEY = "bookmaker_state_v5";
const BACKUP_KEY = "bookmaker_backup_v5";

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
  if (window.DOMPurify) return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  return html;
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[c]));
}

function setSaveStatus(text) {
  if ($("saveStatus")) $("saveStatus").textContent = text;
}

function setAiStatus(text, tone = "idle") {
  const pill = $("aiStatusPill");
  if (!pill) return;
  pill.textContent = text;
  pill.className = "pill brand";
  if (tone === "warn") pill.className = "pill warn";
}

/* ---------- Tabs ---------- */
function aiShowTab(which) {
  const prevBtn = $("tabPreview");
  const diffBtn = $("tabDiff");
  const prev = $("aiPreview");
  const diff = $("aiDiff");

  if (!prevBtn || !diffBtn || !prev || !diff) return;

  if (which === "diff") {
    prevBtn.classList.remove("active");
    diffBtn.classList.add("active");
    prev.classList.remove("active");
    diff.classList.add("active");
  } else {
    diffBtn.classList.remove("active");
    prevBtn.classList.add("active");
    diff.classList.remove("active");
    prev.classList.add("active");
  }
}

/* ---------- Persistence ---------- */
function saveState(showStatus = true) {
  if (showStatus) setSaveStatus("Saving…");
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
  if (showStatus) setTimeout(() => setSaveStatus("Saved ✓"), 250);
}

function loadState() {
  const raw = localStorage.getItem(STATE_KEY);
  if (raw) state = { ...state, ...JSON.parse(raw) };

  if (!state.chapters.length) addChapter("Chapter 1", true);

  if ($("aiEndpoint")) $("aiEndpoint").value = state.settings.aiEndpoint || "";
  if ($("aiToken")) $("aiToken").value = state.settings.aiToken || "";
  if ($("aiMode")) $("aiMode").value = state.settings.mode || "rewrite";
  if ($("aiTemplate")) $("aiTemplate").value = state.settings.template || "default";
  if ($("aiModel")) $("aiModel").value = state.settings.model || "gpt-4o-mini";
  if ($("aiStream")) $("aiStream").checked = !!state.settings.stream;

  renderChapters();
  switchChapter(state.currentChapterId || state.chapters[0].id);
  updateWordCounts();
  setSaveStatus("Saved ✓");
}

/* Auto-backup */
setInterval(() => localStorage.setItem(BACKUP_KEY, JSON.stringify(state)), 5 * 60 * 1000);

/* ---------- Chapters ---------- */
function addChapter(title = "New Chapter", silent = false) {
  const chapter = { id: uid(), title, content: "", wordCount: 0 };
  state.chapters.push(chapter);
  state.currentChapterId = chapter.id;
  renderChapters();
  switchChapter(chapter.id);
  saveState(!silent);
}

function deleteChapter(id) {
  if (!confirm("Delete this chapter? This cannot be undone.")) return;
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
      <strong>${escapeHtml(c.title)}</strong><br>
      <small>${c.wordCount} words</small>
      <button onclick="event.stopPropagation();deleteChapter('${c.id}')">✕</button>
    </div>
  `).join("");
}

function switchChapter(id) {
  saveCurrentChapter(false);
  const ch = state.chapters.find(c => c.id === id);
  if (!ch) return;
  state.currentChapterId = id;
  if ($("chapterTitle")) $("chapterTitle").value = ch.title;
  if ($("editor")) $("editor").innerHTML = ch.content || "";
  renderChapters();
  updateWordCounts();
}

/* ---------- Editor ---------- */
function saveCurrentChapter(showStatus = true) {
  const ch = state.chapters.find(c => c.id === state.currentChapterId);
  if (!ch || !$("editor")) return;

  const clean = sanitize($("editor").innerHTML);
  ch.title = ($("chapterTitle")?.value || "Untitled").trim() || "Untitled";
  ch.content = clean;
  ch.wordCount = countWords(clean);

  updateWordCounts();
  saveState(showStatus);
}

if ($("editor")) {
  $("editor").addEventListener("input", () => {
    setSaveStatus("Typing…");
    clearTimeout(window._saveTimer);
    window._saveTimer = setTimeout(() => saveCurrentChapter(), 550);
  });

  $("editor").addEventListener("paste", (e) => {
    e.preventDefault();
    document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
  });
}

if ($("chapterTitle")) {
  $("chapterTitle").addEventListener("input", () => {
    setSaveStatus("Typing…");
    clearTimeout(window._saveTimer);
    window._saveTimer = setTimeout(() => saveCurrentChapter(), 550);
  });
}

/* ---------- Word Counts ---------- */
function countWords(html) {
  return html.replace(/<[^>]+>/g, "").trim().split(/\s+/).filter(Boolean).length;
}

function updateWordCounts() {
  const total = state.chapters.reduce((s, c) => s + (c.wordCount || 0), 0);
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
  if (undoStack.length > 20) undoStack.shift();
}

function undo() {
  const last = undoStack.pop();
  if (!last) return alert("Nothing to undo");
  const ch = state.chapters.find(c => c.id === last.chapterId);
  if (!ch) return;
  ch.content = last.content;
  ch.wordCount = countWords(last.content);
  switchChapter(ch.id);
  saveState();
}

/* ---------- Settings ---------- */
function saveSettings() {
  state.settings.aiEndpoint = ($("aiEndpoint")?.value || "").trim();
  state.settings.aiToken = ($("aiToken")?.value || "").trim();
  state.settings.mode = $("aiMode")?.value || "rewrite";
  state.settings.template = $("aiTemplate")?.value || "default";
  state.settings.model = $("aiModel")?.value || "gpt-4o-mini";
  state.settings.stream = !!$("aiStream")?.checked;

  saveState();
  if (window.closeSettings) window.closeSettings();
  alert("Settings saved!");
}

/* Sync state with toolbar */
["aiMode", "aiTemplate", "aiModel", "aiStream"].forEach(id => {
  const el = $(id);
  if (!el) return;
  el.addEventListener("change", () => {
    state.settings.mode = $("aiMode")?.value || state.settings.mode;
    state.settings.template = $("aiTemplate")?.value || state.settings.template;
    state.settings.model = $("aiModel")?.value || state.settings.model;
    state.settings.stream = !!$("aiStream")?.checked;
    saveState(false);
  });
});

/* ---------- AI Session ---------- */
let aiSession = {
  active: false,
  target: "none",         // "selection" | "chapter" | "append"
  selectionText: "",
  selectionRange: null,
  sourceText: "",         // what we diff against
  outputText: "",         // what AI produced (plain)
  outputHtml: "",         // what we apply (html)
  mode: "rewrite",
  template: "default",
  model: "gpt-4o-mini"
};

function aiResetPanel() {
  aiSession.active = false;
  aiSession.target = "none";
  aiSession.selectionText = "";
  aiSession.selectionRange = null;
  aiSession.sourceText = "";
  aiSession.outputText = "";
  aiSession.outputHtml = "";

  if ($("aiPreview")) $("aiPreview").innerHTML = `<div class="placeholder">Run an AI action to preview changes here. Then click <b>Apply</b> or <b>Reject</b>.</div>`;
  if ($("aiDiff")) $("aiDiff").innerHTML = `<div class="placeholder">Diff will appear here after the preview is ready.</div>`;

  if ($("aiApplyBtn")) $("aiApplyBtn").disabled = true;
  if ($("aiRejectBtn")) $("aiRejectBtn").disabled = true;

  if ($("aiTargetLabel")) $("aiTargetLabel").textContent = "No request yet";
  if ($("aiWherePill")) $("aiWherePill").textContent = "Target: —";
  if ($("aiModePill")) $("aiModePill").textContent = "Mode: —";

  setAiStatus("Idle");
  aiShowTab("preview");
}

function aiSetPanelMeta() {
  if ($("aiTargetLabel")) {
    $("aiTargetLabel").textContent =
      aiSession.target === "selection" ? "Editing selection" :
      aiSession.target === "chapter" ? "Editing entire chapter" :
      aiSession.target === "append" ? "Appending to chapter" : "—";
  }
  if ($("aiWherePill")) $("aiWherePill").textContent = `Target: ${aiSession.target}`;
  if ($("aiModePill")) $("aiModePill").textContent = `Mode: ${aiSession.mode}`;
}

function aiReject() {
  aiResetPanel();
  setSaveStatus("Saved ✓");
}

function aiApply() {
  if (!aiSession.outputHtml || !aiSession.outputHtml.trim()) {
    alert("Nothing to apply.");
    return;
  }

  saveUndoPoint();

  if (aiSession.target === "append") {
    $("editor").insertAdjacentHTML("beforeend", aiSession.outputHtml);
  } else if (aiSession.target === "selection" && aiSession.selectionRange) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(aiSession.selectionRange);
    document.execCommand("insertHTML", false, aiSession.outputHtml);
  } else {
    $("editor").innerHTML = aiSession.outputHtml;
  }

  saveCurrentChapter();
  setAiStatus("Applied ✓");
  if ($("aiApplyBtn")) $("aiApplyBtn").disabled = true;
  if ($("aiRejectBtn")) $("aiRejectBtn").disabled = true;
}

/* ---------- AI Actions ---------- */
function aiRewrite() { state.settings.mode = "rewrite"; syncToolbarMode(); aiRun(); }
function aiExpand() { state.settings.mode = "expand"; syncToolbarMode(); aiRun(); }
function aiSummarize() { state.settings.mode = "summarize"; syncToolbarMode(); aiRun(); }
function aiContinue() { state.settings.mode = "continue"; syncToolbarMode(); aiRun(); }

function syncToolbarMode() {
  if ($("aiMode")) $("aiMode").value = state.settings.mode;
  saveState(false);
}

function captureSelectionRange() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);

  const editor = $("editor");
  if (!editor) return null;

  const common = range.commonAncestorContainer;
  const node = common.nodeType === 3 ? common.parentNode : common;
  if (!editor.contains(node)) return null;

  return range.cloneRange();
}

function getSelectedText(range) {
  if (!range) return "";
  return range.toString() || "";
}

/* Convert plain text to safe HTML paragraphs for applying */
function textToHtmlParagraphs(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const blocks = [];
  let buf = [];
  for (const line of lines) {
    if (!line.trim()) {
      if (buf.length) {
        blocks.push(`<p>${escapeHtml(buf.join(" ").trim())}</p>`);
        buf = [];
      }
      continue;
    }
    buf.push(line.trim());
  }
  if (buf.length) blocks.push(`<p>${escapeHtml(buf.join(" ").trim())}</p>`);
  return blocks.join("");
}

/* Robustly normalize worker outputs */
function normalizeWorkerText(data) {
  if (data && typeof data.text === "string") return data.text;
  const maybe = data?.choices?.[0]?.message?.content;
  if (typeof maybe === "string") return maybe;
  if (typeof data?.output === "string") return data.output;
  return typeof data === "string" ? data : JSON.stringify(data);
}

/* ---------- Diff Rendering ---------- */
function buildDiffHtml(beforeText, afterText) {
  if (!window.diff_match_patch) {
    return `<div class="placeholder">Diff library not loaded.</div>`;
  }
  const dmp = new diff_match_patch();
  const diffs = dmp.diff_main(beforeText || "", afterText || "");
  dmp.diff_cleanupSemantic(diffs);

  // Render as HTML with <ins> and <del>
  let html = `<div class="diffWrap">`;
  for (const [op, data] of diffs) {
    const safe = escapeHtml(data);
    if (op === 0) html += safe;
    if (op === 1) html += `<ins>${safe}</ins>`;
    if (op === -1) html += `<del>${safe}</del>`;
  }
  html += `</div>`;

  return sanitize(html);
}

function renderPreview(outText) {
  if (!$("aiPreview")) return;
  const html = sanitize(textToHtmlParagraphs(outText));
  $("aiPreview").innerHTML = html || `<div class="placeholder">No output.</div>`;
}

function renderDiff(beforeText, afterText) {
  if (!$("aiDiff")) return;
  if (!beforeText && !afterText) {
    $("aiDiff").innerHTML = `<div class="placeholder">Diff will appear here after the preview is ready.</div>`;
    return;
  }
  $("aiDiff").innerHTML = buildDiffHtml(beforeText, afterText);
}

/* ---------- Core AI Runner (Preview-first + Diff) ---------- */
async function aiRun() {
  const endpoint = (state.settings.aiEndpoint || "").trim();
  const token = (state.settings.aiToken || "").trim();
  if (!endpoint || !token) return alert("Configure AI settings first (⚙ Settings).");
  if (!$("editor")) return alert("Editor not found.");

  // Save current edits first
  saveCurrentChapter(false);

  aiResetPanel();

  aiSession.mode = state.settings.mode || "rewrite";
  aiSession.template = state.settings.template || "default";
  aiSession.model = state.settings.model || "gpt-4o-mini";

  const selRange = captureSelectionRange();
  const selText = getSelectedText(selRange);

  if (aiSession.mode === "continue") {
    aiSession.target = "append";
  } else if (selText && selText.trim()) {
    aiSession.target = "selection";
    aiSession.selectionRange = selRange;
    aiSession.selectionText = selText;
  } else {
    aiSession.target = "chapter";
  }

  aiSetPanelMeta();

  const chapterText = $("editor").innerText || "";
  const text = aiSession.target === "selection" ? aiSession.selectionText : chapterText;
  if (!text.trim()) return alert("Editor is empty.");

  // What we diff against:
  aiSession.sourceText = (aiSession.target === "append") ? "" : text;

  const instruction =
    aiSession.mode === "rewrite" ? "Rewrite this text to improve clarity, flow, and style." :
    aiSession.mode === "expand" ? "Expand this text with more sensory detail, vivid description, and specificity." :
    aiSession.mode === "summarize" ? "Summarize this text while preserving key facts and tone." :
    "Continue writing from where this text ends, matching the voice and pacing.";

  setAiStatus("Generating…");
  if ($("aiPreview")) $("aiPreview").innerHTML = `<div class="placeholder">Generating preview…</div>`;
  if ($("aiDiff")) $("aiDiff").innerHTML = `<div class="placeholder">Diff will appear here after the preview is ready.</div>`;

  const payload = {
    instruction,
    text,
    mode: aiSession.mode,
    template: aiSession.template,
    model: aiSession.model,
    chapter: chapterText,
    stream: !!state.settings.stream
  };

  try {
    if (!state.settings.stream) {
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-BookMaker-Token": token },
        body: JSON.stringify(payload)
      });

      if (resp.status === 401) throw new Error("Unauthorized (check BOOKMAKER_TOKEN).");
      if (resp.status === 429) throw new Error("Daily limit reached.");
      if (!resp.ok) throw new Error(`AI request failed: ${resp.status} ${await resp.text()}`);

      const data = await resp.json();
      const outText = normalizeWorkerText(data);

      aiSession.outputText = outText;

      // Apply content rules:
      // - append: output becomes paragraphs to append
      // - else: output becomes replacement html
      const outHtml = sanitize(textToHtmlParagraphs(outText));
      aiSession.outputHtml = outHtml;

      renderPreview(outText);
      renderDiff(aiSession.sourceText, outText);
      enableApplyReject();
      setAiStatus("Preview ready");
      return;
    }

    // STREAMING
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BookMaker-Token": token,
        "Accept": "text/event-stream"
      },
      body: JSON.stringify(payload)
    });

    if (resp.status === 401) throw new Error("Unauthorized (check BOOKMAKER_TOKEN).");
    if (resp.status === 429) throw new Error("Daily limit reached.");
    if (!resp.ok) throw new Error(`AI request failed: ${resp.status} ${await resp.text()}`);
    if (!resp.body) throw new Error("Streaming not supported by this response.");

    setAiStatus("Streaming…");
    await streamToPreview(resp.body);

    // After streaming completes, build diff + enable apply
    renderDiff(aiSession.sourceText, aiSession.outputText);
    enableApplyReject();
    setAiStatus("Preview ready");

  } catch (err) {
    setAiStatus("Error", "warn");
    if ($("aiPreview")) $("aiPreview").innerHTML = `<div class="placeholder"><b>Error:</b> ${escapeHtml(err.message)}</div>`;
    if ($("aiDiff")) $("aiDiff").innerHTML = `<div class="placeholder">Diff unavailable due to error.</div>`;
  }
}

function enableApplyReject() {
  if ($("aiApplyBtn")) $("aiApplyBtn").disabled = false;
  if ($("aiRejectBtn")) $("aiRejectBtn").disabled = false;
}

/* Stream handler: data: {"delta":"..."} */
async function streamToPreview(readable) {
  const reader = readable.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let assembled = "";

  // Live preview as plain text while streaming
  if ($("aiPreview")) $("aiPreview").innerHTML = "";
  const outEl = $("aiPreview");

  const live = document.createElement("div");
  live.style.whiteSpace = "pre-wrap";
  live.style.wordWrap = "break-word";
  live.style.fontFamily = "ui-serif, Georgia, 'Times New Roman', serif";
  live.style.lineHeight = "1.65";
  outEl.appendChild(live);

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
      if (!payload || payload === "[DONE]") continue;

      let evt;
      try { evt = JSON.parse(payload); } catch { continue; }

      if (typeof evt.delta === "string") {
        assembled += evt.delta;
        live.textContent = assembled;
      } else if (typeof evt.text === "string") {
        assembled = evt.text;
        live.textContent = assembled;
      }
    }
  }

  aiSession.outputText = assembled;
  aiSession.outputHtml = sanitize(textToHtmlParagraphs(assembled));

  // Finalize preview into paragraphs
  renderPreview(assembled);
}

/* ---------- Init ---------- */
window.onload = () => {
  loadState();
  aiResetPanel();
  window.aiShowTab = aiShowTab; // ensure global for onclick
};

window.onbeforeunload = () => {
  saveCurrentChapter(false);
};
