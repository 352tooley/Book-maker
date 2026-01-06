/* ===========================
   Book Maker – app.js
   - DOCX import with chapter detection
   - Inline diff AI editing
   =========================== */

const STATE_KEY = "bookmaker_state_v7";

let state = {
  chapters: [],
  currentChapterId: null,
  settings: { aiEndpoint:"", aiToken:"" }
};

const $ = (id) => document.getElementById(id);
const uid = () => crypto.randomUUID ? crypto.randomUUID() : Date.now()+"-"+Math.random();

function sanitize(html){ return window.DOMPurify ? DOMPurify.sanitize(html) : html; }
function escapeHtml(str){ return String(str).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c])); }

/* ---------- Persistence ---------- */
function saveState(){ localStorage.setItem(STATE_KEY, JSON.stringify(state)); }
function loadState(){
  const raw = localStorage.getItem(STATE_KEY);
  if(raw) state = {...state, ...JSON.parse(raw)};
  if(!state.chapters.length) addChapter("Chapter 1", true);
  $("aiEndpoint").value = state.settings.aiEndpoint || "";
  $("aiToken").value = state.settings.aiToken || "";
  renderChapters();
  switchChapter(state.currentChapterId || state.chapters[0].id);
}

/* ---------- Chapters ---------- */
function addChapter(title="New Chapter", silent=false){
  const ch={id:uid(), title, content:"", wordCount:0};
  state.chapters.push(ch);
  state.currentChapterId=ch.id;
  renderChapters(); switchChapter(ch.id);
  if(!silent) saveState();
}

function renderChapters(){
  $("chapterList").innerHTML = state.chapters.map(c=>`
    <div class="chapter ${c.id===state.currentChapterId?"active":""}" onclick="switchChapter('${c.id}')">
      <strong>${escapeHtml(c.title)}</strong><br>
      <small>${c.wordCount||0} words</small>
    </div>`).join("");
}

function switchChapter(id){
  saveCurrentChapter();
  const ch = state.chapters.find(c=>c.id===id);
  if(!ch) return;
  state.currentChapterId=id;
  $("chapterTitle").value=ch.title;
  $("editor").innerHTML=ch.content||"";
  renderChapters();
}

/* ---------- Editor ---------- */
function countWords(html){ return html.replace(/<[^>]+>/g,"").trim().split(/\s+/).filter(Boolean).length; }

function saveCurrentChapter(){
  const ch = state.chapters.find(c=>c.id===state.currentChapterId);
  if(!ch) return;
  const clean = sanitize($("editor").innerHTML);
  ch.title = $("chapterTitle").value || "Untitled";
  ch.content = clean;
  ch.wordCount = countWords(clean);
  updateWordCounts();
  saveState();
}

$("editor").addEventListener("input", ()=>{ clearTimeout(window._t); window._t=setTimeout(saveCurrentChapter,400); });

function updateWordCounts(){
  const total = state.chapters.reduce((s,c)=>s+(c.wordCount||0),0);
  $("totalWords").textContent = total;
}

/* ---------- Undo ---------- */
let undoStack=[];
function saveUndoPoint(){
  const ch = state.chapters.find(c=>c.id===state.currentChapterId);
  if(!ch) return;
  undoStack.push({id:ch.id, content:ch.content});
  if(undoStack.length>20) undoStack.shift();
}
function undo(){
  const last = undoStack.pop();
  if(!last) return alert("Nothing to undo");
  const ch = state.chapters.find(c=>c.id===last.id);
  ch.content = last.content;
  $("editor").innerHTML = ch.content;
  saveState();
}

/* ---------- DOCX IMPORT ---------- */
$("docxInput").addEventListener("change", handleDocxUpload);

async function handleDocxUpload(e){
  const file = e.target.files[0];
  if(!file) return;
  if(!confirm("Importing will REPLACE current chapters. Continue?")) return;

  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer });
  importHtmlAsChapters(result.value);
  e.target.value="";
}

function importHtmlAsChapters(html){
  const container = document.createElement("div");
  container.innerHTML = html;
  const nodes = Array.from(container.childNodes);

  let chapters=[];
  let current=null;

  function flush(){
    if(current){
      current.content = current.content.join("");
      current.wordCount = countWords(current.content);
      chapters.push(current);
    }
  }

  for(const node of nodes){
    if(node.nodeType===1 && /^H[1-3]$/i.test(node.tagName)){
      flush();
      current = { id:uid(), title:node.innerText.trim()||"Untitled", content:[], wordCount:0 };
    } else {
      if(!current) current = { id:uid(), title:"Introduction", content:[], wordCount:0 };
      current.content.push(node.outerHTML || node.textContent);
    }
  }
  flush();

  if(!chapters.length) return alert("No headings found in document.");

  state.chapters = chapters;
  state.currentChapterId = chapters[0].id;
  saveState(); renderChapters(); switchChapter(state.currentChapterId);
  alert("Imported "+chapters.length+" chapters.");
}

/* ---------- AI INLINE DIFF ---------- */
let aiSession = { active:false, originalHtml:"", originalText:"", outputText:"", target:"chapter", selectionRange:null };

function buildInlineDiffHtml(beforeText, afterText){
  const dmp = new diff_match_patch();
  const diffs = dmp.diff_main(beforeText, afterText);
  dmp.diff_cleanupSemantic(diffs);
  let html="";
  for(const [op,data] of diffs){
    const safe = escapeHtml(data);
    if(op===0) html+=safe;
    if(op===1) html+=`<ins>${safe}</ins>`;
    if(op===-1) html+=`<del>${safe}</del>`;
  }
  return html;
}

function captureSelectionRange(){
  const sel = window.getSelection();
  if(!sel || sel.rangeCount===0) return null;
  const range = sel.getRangeAt(0);
  if(!$("editor").contains(range.commonAncestorContainer)) return null;
  return range.cloneRange();
}

function aiRewrite(){ runAI("rewrite"); }
function aiExpand(){ runAI("expand"); }
function aiSummarize(){ runAI("summarize"); }
function aiContinue(){ runAI("continue"); }

async function runAI(mode){
  const endpoint = state.settings.aiEndpoint;
  const token = state.settings.aiToken;
  if(!endpoint || !token) return alert("Configure AI settings first.");

  saveCurrentChapter(); saveUndoPoint();

  aiSession={ active:true, originalHtml:$("editor").innerHTML, originalText:$("editor").innerText };

  const selRange = captureSelectionRange();
  let text="", target="chapter";

  if(mode==="continue"){ text=$("editor").innerText; target="append"; }
  else if(selRange && selRange.toString().trim()){ text=selRange.toString(); target="selection"; aiSession.selectionRange=selRange; }
  else text=$("editor").innerText;

  if(!text.trim()) return alert("Nothing to send to AI.");

  aiSession.target=target;

  const instruction =
    mode==="rewrite"?"Rewrite this text to improve clarity and style.":
    mode==="expand"?"Expand this text with more detail.":
    mode==="summarize"?"Summarize this text.":
    "Continue writing from here.";

  const resp = await fetch(endpoint,{ method:"POST", headers:{ "Content-Type":"application/json", "X-BookMaker-Token":token }, body:JSON.stringify({ instruction, text, mode })});
  if(!resp.ok) return alert("AI error");

  const data = await resp.json();
  const outText = data.text || data.output || data.choices?.[0]?.message?.content || "";
  aiSession.outputText = outText;

  applyInlineDiff();
}

function applyInlineDiff(){
  if(aiSession.target==="append"){
    $("editor").insertAdjacentHTML("beforeend", `<ins>${escapeHtml(aiSession.outputText)}</ins>`);
    return;
  }
  if(aiSession.target==="selection" && aiSession.selectionRange){
    const range = aiSession.selectionRange;
    const before = range.toString();
    const diffHtml = buildInlineDiffHtml(before, aiSession.outputText);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    document.execCommand("insertHTML", false, diffHtml);
    return;
  }
  const diffHtml = buildInlineDiffHtml(aiSession.originalText, aiSession.outputText);
  $("editor").innerHTML = diffHtml;
}

function aiApply(){
  if(!aiSession.active) return;
  if(aiSession.target==="append"){
    $("editor").innerHTML = aiSession.originalHtml + `<p>${escapeHtml(aiSession.outputText)}</p>`;
  } else {
    $("editor").innerHTML = `<p>${escapeHtml(aiSession.outputText).replace(/\n/g,"</p><p>")}</p>`;
  }
  aiSession.active=false;
  saveCurrentChapter();
}

function aiReject(){
  if(!aiSession.active) return;
  $("editor").innerHTML = aiSession.originalHtml;
  aiSession.active=false;
}

/* ---------- Settings ---------- */
function saveSettings(){
  state.settings.aiEndpoint = $("aiEndpoint").value.trim();
  state.settings.aiToken = $("aiToken").value.trim();
  saveState();
  closeSettings();
  alert("Settings saved!");
}

/* ---------- Init ---------- */
window.onload = loadState;
window.onbeforeunload = () => saveCurrentChapter();
