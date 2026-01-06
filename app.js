/* ===========================
   Book Maker – app.js
   =========================== */

const STATE_KEY = "bookmaker_state_v2";
const BACKUP_KEY = "bookmaker_backup_v2";

let state = {
  chapters: [],
  currentChapterId: null,
  lastTotalWords: 0,
  today: new Date().toDateString(),
  todayWords: 0,
  settings: {
    aiEndpoint: "",
    aiToken: ""
  }
};

/* ---------- Utils ---------- */
const $ = (id) => document.getElementById(id);
const uid = () => crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random();

function sanitize(html) {
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}

/* ---------- Persistence ---------- */
function saveState(showStatus = true) {
  if (showStatus) setSaveStatus("Saving…");
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
  if (showStatus) setTimeout(() => setSaveStatus("Saved ✓"), 300);
}

function loadState() {
  const raw = localStorage.getItem(STATE_KEY);
  if (raw) state = JSON.parse(raw);

  if (!state.chapters.length) {
    addChapter("Chapter 1", true);
  }

  renderChapters();
  switchChapter(state.currentChapterId || state.chapters[0].id);

  // Load settings if present
  if (state.settings && state.settings.aiEndpoint) {
    $("aiEndpoint").value = state.settings.aiEndpoint;
    $("aiToken").value = state.settings.aiToken;
  }
}

/* Auto-backup every 5 minutes */
setInterval(() => {
  localStorage.setItem(BACKUP_KEY, JSON.stringify(state));
}, 5 * 60 * 1000);

/* ---------- Save Indicator ---------- */
function setSaveStatus(text) {
  $("saveStatus").textContent = text;
}

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
  if (!confirm("Delete this chapter? This cannot be undone.")) return;
  state.chapters = state.chapters.filter(c => c.id !== id);
  state.currentChapterId = state.chapters[0]?.id || null;
  renderChapters();
  if (state.currentChapterId) switchChapter(state.currentChapterId);
  saveState();
}

function renderChapters() {
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
  $("chapterTitle").value = ch.title;
  $("editor").innerHTML = ch.content;
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

$("editor").addEventListener("input", () => {
  setSaveStatus("Typing…");
  clearTimeout(window._saveTimer);
  window._saveTimer = setTimeout(() => saveCurrentChapter(), 600);
});

$("chapterTitle").addEventListener("input", () => {
  setSaveStatus("Typing…");
  clearTimeout(window._saveTimer);
  window._saveTimer = setTimeout(() => saveCurrentChapter(), 600);
});

/* Paste as plain text */
$("editor").addEventListener("paste", e => {
  e.preventDefault();
  document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
});

/* ---------- Word Counts ---------- */
function countWords(html) {
  return html.replace(/<[^>]+>/g, "").trim().split(/\s+/).filter(Boolean).length;
}

function updateWordCounts() {
  const total = state.chapters.reduce((s, c) => s + c.wordCount, 0);
  $("totalWords").textContent = total.toLocaleString();

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

/* ---------- Scene Break ---------- */
function insertSceneBreak() {
  document.execCommand("insertHTML", false, `<hr class="scene-break">`);
  saveCurrentChapter();
}

/* ---------- Search & Replace ---------- */
function openSearch() {
  $("searchModal").classList.add("active");
}

function closeSearch() {
  $("searchModal").classList.remove("active");
}

function runReplace(all = false) {
  const find = $("searchFind").value;
  const replace = $("searchReplace").value;
  if (!find) return;

  if (all && !confirm("Replace ALL occurrences in ALL chapters?")) return;

  state.chapters.forEach(ch => {
    if (!all && ch.id !== state.currentChapterId) return;
    ch.content = ch.content.split(find).join(replace);
    ch.wordCount = countWords(ch.content);
  });

  switchChapter(state.currentChapterId);
  saveState();
  closeSearch();
}

/* ---------- AI Settings ---------- */
function openSettings() {
  $("settingsModal").classList.add("active");
}

function closeSettings() {
  $("settingsModal").classList.remove("active");
}

function saveSettings() {
  state.settings.aiEndpoint = $("aiEndpoint").value;
  state.settings.aiToken = $("aiToken").value;
  saveState();
  closeSettings();
  alert("Settings saved!");
}

/* ---------- AI Actions ---------- */
async function aiRewrite() {
  await aiAction("Rewrite this text to improve clarity and flow", false);
}

async function aiExpand() {
  await aiAction("Expand this text with more detail and description", false);
}

async function aiContinue() {
  await aiAction("Continue writing from where this text ends", true);
}

async function aiAction(instruction, append = false) {
  const endpoint = state.settings.aiEndpoint;
  const token = state.settings.aiToken;

  if (!endpoint || !token) {
    alert("Please configure AI settings first (click ⚙ Settings)");
    return;
  }

  const selection = window.getSelection();
  const text = selection.toString() || $("editor").innerText;

  if (!text.trim()) {
    alert("No text selected or editor is empty");
    return;
  }

  // Save undo point
  saveUndoPoint();

  setSaveStatus("AI processing…");

  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BookMaker-Token": token
      },
      body: JSON.stringify({ instruction, text })
    });

    if (resp.status === 401) {
      alert("AI not authorized. Check your token.");
      setSaveStatus("Saved ✓");
      return;
    }

    if (resp.status === 429) {
      alert("Daily AI limit reached (30 requests/day)");
      setSaveStatus("Saved ✓");
      return;
    }

    if (!resp.ok) {
      throw new Error(`AI request failed: ${resp.status}`);
    }

    const data = await resp.json();
    const clean = sanitize(data.text || "");

    if (append) {
      document.execCommand("insertHTML", false, `<p>${clean}</p>`);
    } else if (selection.toString()) {
      document.execCommand("insertHTML", false, clean);
    } else {
      $("editor").innerHTML += `<p>${clean}</p>`;
    }

    saveCurrentChapter();
  } catch (err) {
    alert("AI error: " + err.message);
    setSaveStatus("Saved ✓");
  }
}

/* ---------- Undo History ---------- */
let undoStack = [];

function saveUndoPoint() {
  const ch = state.chapters.find(c => c.id === state.currentChapterId);
  if (!ch) return;

  undoStack.push({
    chapterId: ch.id,
    content: ch.content
  });

  // Keep only last 10 undo points
  if (undoStack.length > 10) undoStack.shift();
}

function undo() {
  if (undoStack.length === 0) {
    alert("No undo history");
    return;
  }

  const lastState = undoStack.pop();
  const ch = state.chapters.find(c => c.id === lastState.chapterId);

  if (ch) {
    ch.content = lastState.content;
    ch.wordCount = countWords(lastState.content);
    switchChapter(ch.id);
    saveState();
  }
}

/* ---------- Export JSON ---------- */
function exportJSON() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  saveAs(blob, "book-backup.json");
}

/* ---------- Export EPUB ---------- */
function exportEPUB() {
  const bookTitle = prompt("Book title:", "My Book");
  if (!bookTitle) return;

  const author = prompt("Author name:", "Anonymous");
  if (!author) return;

  // Create EPUB structure
  const uuid = uid();
  const timestamp = new Date().toISOString();

  // Container
  const container = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

  // Content OPF
  const manifestItems = state.chapters.map((ch, i) =>
    `    <item id="chapter${i+1}" href="chapter${i+1}.xhtml" media-type="application/xhtml+xml"/>`
  ).join('\n');

  const spineItems = state.chapters.map((ch, i) =>
    `    <itemref idref="chapter${i+1}"/>`
  ).join('\n');

  const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:${uuid}</dc:identifier>
    <dc:title>${escapeXml(bookTitle)}</dc:title>
    <dc:creator>${escapeXml(author)}</dc:creator>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">${timestamp}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="stylesheet" href="stylesheet.css" media-type="text/css"/>
${manifestItems}
  </manifest>
  <spine>
${spineItems}
  </spine>
</package>`;

  // Navigation
  const navItems = state.chapters.map((ch, i) =>
    `        <li><a href="chapter${i+1}.xhtml">${escapeXml(ch.title)}</a></li>`
  ).join('\n');

  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>Navigation</title>
</head>
<body>
  <nav epub:type="toc">
    <h1>Table of Contents</h1>
    <ol>
${navItems}
    </ol>
  </nav>
</body>
</html>`;

  // Stylesheet
  const stylesheet = `body {
  font-family: Georgia, serif;
  line-height: 1.6;
  margin: 2em;
}
h1 {
  font-size: 2em;
  margin: 1em 0 0.5em;
}
p {
  margin: 1em 0;
  text-indent: 1.5em;
}
hr.scene-break {
  border: none;
  text-align: center;
  margin: 2em 0;
}
hr.scene-break::after {
  content: "* * *";
}`;

  // Create ZIP
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file("META-INF/container.xml", container);
  zip.file("OEBPS/content.opf", contentOpf);
  zip.file("OEBPS/nav.xhtml", nav);
  zip.file("OEBPS/stylesheet.css", stylesheet);

  // Add chapters
  state.chapters.forEach((ch, i) => {
    const content = ch.content.replace(/<hr class="scene-break">/g, '<hr class="scene-break"/>');

    const chapter = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>${escapeXml(ch.title)}</title>
  <link rel="stylesheet" href="stylesheet.css"/>
</head>
<body>
  <h1>${escapeXml(ch.title)}</h1>
  ${content}
</body>
</html>`;

    zip.file(`OEBPS/chapter${i+1}.xhtml`, chapter);
  });

  // Generate and download
  zip.generateAsync({ type: "blob" }).then(blob => {
    saveAs(blob, `${bookTitle}.epub`);
  });
}

function escapeXml(str) {
  return str.replace(/[<>&'"]/g, c => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    "'": '&apos;',
    '"': '&quot;'
  })[c]);
}

/* ---------- Export PDF ---------- */
async function exportPDF() {
  const bookTitle = prompt("Book title:", "My Book");
  if (!bookTitle) return;

  // Build HTML for Paged.js
  let html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${bookTitle}</title>
  <script src="https://unpkg.com/pagedjs@0.4.3/dist/paged.polyfill.js"></script>
  <style>
    @page {
      size: 6in 9in;
      margin: 0.75in;
    }
    body {
      font-family: Georgia, serif;
      font-size: 12pt;
      line-height: 1.6;
    }
    h1 {
      font-size: 20pt;
      page-break-before: always;
      margin-top: 0;
    }
    h1:first-of-type {
      page-break-before: avoid;
    }
    p {
      margin: 0 0 1em 0;
      text-indent: 1.5em;
    }
    hr.scene-break {
      border: none;
      text-align: center;
      margin: 2em 0;
    }
    hr.scene-break::after {
      content: "* * *";
    }
  </style>
</head>
<body>`;

  state.chapters.forEach(ch => {
    html += `\n  <h1>${ch.title}</h1>\n  ${ch.content}\n`;
  });

  html += `</body>
</html>`;

  // Open in new window for print
  const win = window.open();
  win.document.write(html);
  win.document.close();

  setTimeout(() => {
    alert("PDF preview opened. Use your browser's Print → Save as PDF");
  }, 1000);
}

/* ---------- Init ---------- */
window.onload = loadState;
window.onbeforeunload = () => saveCurrentChapter(false);
