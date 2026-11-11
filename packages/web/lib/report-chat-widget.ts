// The ask-the-report drawer, appended to the report page by the web route
// (app/reports/[id]/route.ts). It lives here rather than in the CLI renderer
// so the CLI report stays standalone. Plain inline CSS + JS: the report page
// CSP allows inline script and same-origin fetch only.
//
// Uses the report's own tokens (--paper, --ink, --accent, ...), which the CLI
// renderer defines on :root.

export function reportChatEnabled(): boolean {
  return Boolean(process.env.OPENAI_API_KEY) && process.env.REPORT_CHAT_DISABLED !== "1";
}

export const STARTER_QUESTIONS = [
  "How did we do?",
  "What should we do first to close the gaps?",
  "Which brands do the AIs recommend that we don't track?",
  "Which sites do the AIs rely on for these questions?",
];

/** JSON safe to embed inside a <script> element. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll(" ", "\\u2028")
    .replaceAll(" ", "\\u2029");
}

export function renderReportChatWidget(args: {
  jobId: string;
  brandName: string;
  questions: { ref: string; text: string }[];
}): string {
  const data = scriptJson({
    jobId: args.jobId,
    brand: args.brandName,
    questions: args.questions,
    starters: STARTER_QUESTIONS,
  });
  return `<div id="olr-chat" class="olr-chat">
<button type="button" class="olr-launch" id="olr-launch" aria-expanded="false" aria-controls="olr-panel"><span class="olr-dot" aria-hidden="true"></span>Ask about this report</button>
<section class="olr-panel" id="olr-panel" role="dialog" aria-modal="false" aria-labelledby="olr-title" hidden>
<header class="olr-head"><div><span class="kicker">Ask the report</span><h2 id="olr-title">Questions about this run</h2></div><div class="olr-head-actions"><button type="button" class="olr-icon" id="olr-clear" title="Start over" aria-label="Start a new conversation">↺</button><button type="button" class="olr-icon" id="olr-close" aria-label="Close">×</button></div></header>
<div class="olr-thread" id="olr-thread" aria-live="polite"></div>
<div class="olr-starters" id="olr-starters" role="group" aria-label="Suggested questions"></div>
<form class="olr-form" id="olr-form"><label class="olr-sr" for="olr-input">Your question</label><textarea id="olr-input" rows="2" maxlength="1000" placeholder="Ask anything about this report…"></textarea><button type="submit" id="olr-send" class="olr-send">Ask</button></form>
<p class="olr-note" id="olr-note">Answers come from this report’s data and can be wrong. Check the linked evidence.</p>
</section>
<script type="application/json" id="olr-chat-data">${data}</script>
</div>
<style>
.olr-chat{--olr-w:440px}
.olr-launch{position:fixed;right:calc(20px + env(safe-area-inset-right,0px));bottom:calc(20px + env(safe-area-inset-bottom,0px));z-index:40;display:inline-flex;align-items:center;gap:10px;min-height:48px;padding:12px 20px;border:0;border-radius:999px;background:var(--accent);color:#fff;font:600 15px "DM Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;box-shadow:0 6px 24px rgba(36,31,25,.18)}
.olr-launch:hover{background:#2c5a4c}.olr-launch:focus-visible{outline:2px solid var(--ink);outline-offset:3px}
.olr-dot{width:8px;height:8px;border-radius:50%;background:#dbe7de}
.olr-open .olr-launch{display:none}
.olr-panel{position:fixed;top:0;right:0;bottom:0;z-index:50;width:var(--olr-w);max-width:100vw;display:flex;flex-direction:column;background:var(--paper);border-left:1px solid var(--line);box-shadow:-10px 0 40px rgba(36,31,25,.08);padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) 0}
.olr-panel[hidden]{display:none}
.olr-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:20px 20px 16px;border-bottom:1px solid var(--line)}
.olr-head h2{font:500 22px/1.15 "Fraunces",Georgia,"Times New Roman",serif;margin:6px 0 0}
.olr-head-actions{display:flex;gap:4px}
.olr-icon{width:40px;height:40px;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--muted);font-size:22px;line-height:1;cursor:pointer}
.olr-icon:hover{border-color:var(--line);color:var(--ink)}.olr-icon:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.olr-thread{flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:18px;overscroll-behavior:contain}
.olr-empty{color:var(--muted);font-size:15px;line-height:1.55}
.olr-empty strong{color:var(--ink);font-weight:600}
.olr-user{align-self:flex-end;max-width:88%;background:var(--soft);border-radius:12px 12px 3px 12px;padding:10px 14px;font-weight:500;white-space:pre-wrap;overflow-wrap:anywhere}
.olr-ai{font-size:15px;line-height:1.62;overflow-wrap:anywhere}
.olr-ai p{margin:0 0 10px}.olr-ai p:last-child{margin-bottom:0}
.olr-ai ul,.olr-ai ol{margin:0 0 10px;padding-left:20px}.olr-ai li{margin:0 0 6px}
.olr-ai strong{font-weight:600}
.olr-ai a{color:var(--accent);text-decoration:underline;text-underline-offset:2px}
.olr-ref{display:inline-flex;align-items:center;gap:4px;margin:0 2px;padding:1px 7px;border:1px solid var(--line);border-radius:4px;background:#fffaf1;color:var(--accent);font:600 12px/1.6 "DM Sans",sans-serif;cursor:pointer;vertical-align:1px;white-space:nowrap}
.olr-ref:hover{border-color:var(--accent)}.olr-ref:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.olr-error{color:var(--loss);font-size:14px}
.olr-typing{display:inline-flex;gap:4px;padding:6px 0}.olr-typing i{width:6px;height:6px;border-radius:50%;background:var(--muted);opacity:.35;animation:olr-pulse 1s infinite}.olr-typing i:nth-child(2){animation-delay:.15s}.olr-typing i:nth-child(3){animation-delay:.3s}
@keyframes olr-pulse{50%{opacity:1}}
.olr-starters{display:flex;flex-wrap:wrap;gap:8px;padding:0 20px 14px}
.olr-starters[hidden]{display:none}
.olr-starter{font:500 14px/1.3 "DM Sans",sans-serif;text-align:left;padding:8px 13px;border:1px solid var(--line);border-radius:999px;background:#fffaf1;color:var(--ink);cursor:pointer}
.olr-starter:hover{border-color:var(--accent);color:var(--accent)}.olr-starter:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.olr-form{display:flex;gap:8px;align-items:flex-end;padding:14px 20px 8px;border-top:1px solid var(--line)}
.olr-form textarea{flex:1;min-width:0;resize:none;min-height:46px;max-height:160px;font:15px/1.45 "DM Sans",sans-serif;color:var(--ink);background:#fffaf1;border:1px solid var(--line);border-radius:7px;padding:11px 12px}
.olr-form textarea:focus-visible{outline:2px solid var(--accent);outline-offset:0;border-color:var(--accent)}
.olr-send{min-height:46px;padding:0 18px;border:0;border-radius:7px;background:var(--accent);color:#fff;font:600 15px "DM Sans",sans-serif;cursor:pointer}
.olr-send:disabled{opacity:.5;cursor:default}.olr-send:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
.olr-note{margin:0;padding:0 20px 14px;font-size:12px;color:var(--muted)}
.olr-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
.olr-flash{animation:olr-flash 2.2s ease}
@keyframes olr-flash{0%,40%{box-shadow:inset 4px 0 0 var(--accent);background:#eef4ef}100%{box-shadow:inset 4px 0 0 transparent}}
@media(min-width:1180px){html.olr-open body{padding-right:var(--olr-w)}}
@media(max-width:620px){.olr-panel{width:100vw;border-left:0}.olr-launch{left:calc(16px + env(safe-area-inset-left,0px));right:calc(16px + env(safe-area-inset-right,0px));justify-content:center}}
@media(prefers-reduced-motion:reduce){.olr-typing i,.olr-flash{animation:none}}
@media print{.olr-chat{display:none}}
</style>
<script>
(function(){
var root=document.getElementById("olr-chat");if(!root)return;
var cfg=JSON.parse(document.getElementById("olr-chat-data").textContent);
var $=function(id){return document.getElementById(id);};
var launch=$("olr-launch"),panel=$("olr-panel"),thread=$("olr-thread"),starters=$("olr-starters"),form=$("olr-form"),input=$("olr-input"),send=$("olr-send"),note=$("olr-note");
var token=new URLSearchParams(location.search).get("t");
var key="olr-chat:"+cfg.jobId;
var names={openai:"ChatGPT",anthropic:"Claude",google:"Gemini",gemini:"Gemini",perplexity:"Perplexity",xai:"Grok"};
var questionByRef={};cfg.questions.forEach(function(q){questionByRef[q.ref]=q.text;});
var history=[];var busy=false;
try{var saved=JSON.parse(sessionStorage.getItem(key)||"[]");if(Array.isArray(saved))history=saved;}catch(e){}
function save(){try{sessionStorage.setItem(key,JSON.stringify(history.slice(-20)));}catch(e){}}
function esc(s){return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
function inline(s){
  s=esc(s);
  s=s.replace(/\\*\\*([^*]+)\\*\\*/g,"<strong>$1</strong>");
  s=s.replace(/\\[(Q\\d+)(?:\\s*[\\/·|]\\s*([a-z]+))?\\]/gi,function(m,ref,prov){
    ref=ref.toUpperCase();if(!questionByRef[ref])return m;
    var p=prov?prov.toLowerCase():"";var label=ref+(p?" · "+(names[p]||p):"");
    return '<button type="button" class="olr-ref" data-ref="'+ref+'" data-provider="'+esc(p)+'" title="'+esc(questionByRef[ref])+'">'+esc(label)+'</button>';
  });
  s=s.replace(/(^|[\\s(])(https?:\\/\\/[^\\s<)"]+[^\\s<)".,;:!?])/g,function(m,pre,url){return pre+'<a href="'+url+'" target="_blank" rel="noopener noreferrer nofollow">'+url+'</a>';});
  return s;
}
function markdown(text){
  var out=[],list=null;
  function close(){if(list){out.push("</"+list+">");list=null;}}
  text.split(/\\n/).forEach(function(line){
    var t=line.trim();var m;
    if(!t){close();return;}
    if((m=t.match(/^[-*•]\\s+(.*)$/))){if(list!=="ul"){close();out.push("<ul>");list="ul";}out.push("<li>"+inline(m[1])+"</li>");return;}
    if((m=t.match(/^\\d+[.)]\\s+(.*)$/))){if(list!=="ol"){close();out.push("<ol>");list="ol";}out.push("<li>"+inline(m[1])+"</li>");return;}
    close();out.push("<p>"+inline(t.replace(/^#+\\s*/,""))+"</p>");
  });
  close();return out.join("");
}
function bubble(role,html){var el=document.createElement("div");el.className=role==="user"?"olr-user":"olr-ai";el.innerHTML=html;thread.appendChild(el);return el;}
function scrollEnd(){thread.scrollTop=thread.scrollHeight;}
function renderAll(){
  thread.innerHTML="";
  if(history.length===0){bubble("ai",'<p class="olr-empty">Ask how <strong>'+esc(cfg.brand)+'</strong> did, why a competitor wins a question, or what to do next. Answers quote this report and link to the evidence.</p>');}
  history.forEach(function(turn){turn.role==="user"?bubble("user",esc(turn.content)):bubble("ai",markdown(turn.content));});
  starters.hidden=history.length>0;scrollEnd();
}
cfg.starters.forEach(function(q){var b=document.createElement("button");b.type="button";b.className="olr-starter";b.textContent=q;b.addEventListener("click",function(){ask(q);});starters.appendChild(b);});
function setOpen(open){
  panel.hidden=!open;launch.setAttribute("aria-expanded",String(open));
  root.classList.toggle("olr-open",open);document.documentElement.classList.toggle("olr-open",open);
  if(open){renderAll();setTimeout(function(){input.focus();},0);}else{launch.focus();}
}
launch.addEventListener("click",function(){setOpen(true);});
$("olr-close").addEventListener("click",function(){setOpen(false);});
$("olr-clear").addEventListener("click",function(){if(busy)return;history=[];save();renderAll();input.focus();});
document.addEventListener("keydown",function(e){if(e.key==="Escape"&&!panel.hidden)setOpen(false);});
input.addEventListener("keydown",function(e){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();form.requestSubmit();}});
form.addEventListener("submit",function(e){e.preventDefault();ask(input.value);});
thread.addEventListener("click",function(e){var b=e.target.closest(".olr-ref");if(b)showEvidence(b.dataset.ref,b.dataset.provider);});
function showEvidence(ref,provider){
  var text=questionByRef[ref];if(!text)return;
  var rows=Array.prototype.slice.call(document.querySelectorAll(".evidence-row")).filter(function(row){
    var q=row.querySelector(".question-text");return q&&q.textContent.trim()===text&&(!provider||row.dataset.provider===provider);
  });
  var row=rows[0];if(!row)return;
  if(row.hidden)row.hidden=false;
  if(row.tagName==="DETAILS")row.open=true;
  if(window.matchMedia("(max-width:1179px)").matches)setOpen(false);
  row.scrollIntoView({behavior:window.matchMedia("(prefers-reduced-motion:reduce)").matches?"auto":"smooth",block:"start"});
  var target=row.querySelector("summary")||row;target.classList.remove("olr-flash");void target.offsetWidth;target.classList.add("olr-flash");
}
function ask(raw){
  var question=(raw||"").trim();if(!question||busy)return;
  busy=true;send.disabled=true;input.value="";starters.hidden=true;
  if(history.length===0)thread.innerHTML="";
  bubble("user",esc(question));
  var out=bubble("ai",'<span class="olr-typing" aria-label="Thinking"><i></i><i></i><i></i></span>');scrollEnd();
  var answer="",failed=null;
  fetch("/api/reports/"+cfg.jobId+"/ask",{method:"POST",headers:{"content-type":"application/json"},credentials:"same-origin",body:JSON.stringify({question:question,token:token,history:history.slice(-10)})})
  .then(function(res){
    if(!res.ok||!res.body){return res.json().catch(function(){return {};}).then(function(b){failed=b.error||"Something went wrong. Try again.";});}
    var reader=res.body.getReader(),decoder=new TextDecoder(),buf="";
    function handle(line){if(!line.trim())return;var ev;try{ev=JSON.parse(line);}catch(e){return;}
      if(ev.type==="delta"){answer+=ev.text;out.innerHTML=markdown(answer);scrollEnd();}
      else if(ev.type==="error"){failed=ev.message;}
      else if(ev.type==="done"&&typeof ev.remaining==="number"&&ev.remaining<=5){note.textContent=ev.remaining+" question"+(ev.remaining===1?"":"s")+" left on this report today. Answers come from this report’s data and can be wrong.";}}
    function pump(){return reader.read().then(function(r){
      if(r.done){handle(buf);return;}
      buf+=decoder.decode(r.value,{stream:true});var lines=buf.split("\\n");buf=lines.pop();lines.forEach(handle);return pump();});}
    return pump();
  })
  .catch(function(){failed="Could not reach the server. Check your connection and try again.";})
  .then(function(){
    if(answer){history.push({role:"user",content:question});history.push({role:"assistant",content:answer});save();}
    if(failed){var err=document.createElement("p");err.className="olr-error";err.textContent=failed;if(!answer)out.innerHTML="";out.appendChild(err);}
    busy=false;send.disabled=false;input.focus();scrollEnd();
  });
}
})();
</script>`;
}
