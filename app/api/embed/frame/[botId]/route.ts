import { randomBytes } from "node:crypto";
import { db } from "@/server/db";
import { isStandardBotIconPath } from "@/lib/bot-icons";

function html(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
}

function foregroundFor(background: string) {
  const [red, green, blue] = background
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => Number.parseInt(channel, 16));
  return (red * 299 + green * 587 + blue * 114) / 1000 >= 150
    ? "#24221c"
    : "#ffffff";
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ botId: string }> },
) {
  const { botId } = await params;
  const bot = await db.bot.findFirst({
    where: { id: botId, active: true },
    include: {
      organization: {
        include: {
          authenticationPolicy: { include: { embeddedConfig: true } },
        },
      },
    },
  });
  const policy = bot?.organization.authenticationPolicy;
  const config = policy?.embeddedConfig;
  if (!bot || !policy?.embeddedEnabled || !config?.active)
    return new Response("Widget unavailable", { status: 404 });
  const origins = config.allowedOrigins.map((origin) => new URL(origin).origin);
  const primaryColor = /^#[0-9a-f]{6}$/i.test(bot.primaryColor)
    ? bot.primaryColor
    : "#ffd400";
  const headerColor = /^#[0-9a-f]{6}$/i.test(bot.headerColor)
    ? bot.headerColor
    : "#24221c";
  const bubbleColor = /^#[0-9a-f]{6}$/i.test(bot.chatBubbleColor)
    ? bot.chatBubbleColor
    : "#fff5b8";
  const primaryForeground = foregroundFor(primaryColor);
  const headerForeground = foregroundFor(headerColor);
  const fontFamily =
    {
      system: "Inter,ui-sans-serif,system-ui,sans-serif",
      sans: "Arial,Helvetica,sans-serif",
      serif: "Georgia,serif",
      mono: "ui-monospace,SFMono-Regular,monospace",
    }[bot.fontFamily] ?? "Inter,ui-sans-serif,system-ui,sans-serif";
  const darkRules =
    ".app,.composer{background:#111827;color:#f8fafc;border-color:#334155}.messages,.status,.suggestions{background:#0f172a}.composer input{background:#1e293b;color:#f8fafc;border-color:#475569}";
  const colorModeRules =
    bot.colorMode === "DARK"
      ? darkRules
      : bot.colorMode === "AUTO"
        ? `@media(prefers-color-scheme:dark){${darkRules}}`
        : "";
  const avatarRule = bot.avatarUrl
    ? isStandardBotIconPath(bot.avatarUrl)
      ? `.head:before{content:"";width:40px;height:40px;flex:none;border-radius:12px;background:#ffffff26 url("${html(bot.avatarUrl)}") center/24px 24px no-repeat}`
      : /^\/api\/bots\/[^/]+\/assets\/[a-f0-9-]{36}\.(?:jpg|png|webp)$/.test(
            bot.avatarUrl,
          )
        ? `.head:before{content:"";width:40px;height:40px;flex:none;border-radius:12px;background:url("${html(bot.avatarUrl)}") center/cover no-repeat}`
        : ""
    : "";
  const nonce = randomBytes(18).toString("base64url");
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}'`,
    "connect-src 'self'",
    "img-src 'self' data: blob:",
    `frame-ancestors ${origins.length ? origins.join(" ") : "'none'"}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  const body = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(bot.name)}</title>
<style nonce="${nonce}">
:root{color-scheme:light;font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#24221c;background:#fff}*{box-sizing:border-box}body{margin:0;height:100dvh}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.app{display:grid;grid-template-rows:auto 1fr auto;height:100%;border:1px solid #e7dfc2;border-radius:18px;overflow:hidden;background:#fff}.head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;color:#fff;background:#24221c}.head h1{margin:0;font-size:16px}.head p{margin:2px 0 0;font-size:12px;opacity:.85}.close{width:44px;height:44px;border:0;border-radius:12px;background:#ffffff20;color:inherit;font-size:24px;cursor:pointer}.messages{overflow:auto;padding:16px;background:#fffdf5}.message{max-width:88%;margin:0 0 12px;padding:10px 12px;border-radius:14px;white-space:pre-wrap;font-size:14px;line-height:1.45}.user{margin-left:auto;background:#ffd400;color:#24221c;border-bottom-right-radius:4px}.assistant{background:#fff;border:1px solid #e7dfc2;border-bottom-left-radius:4px}.artifact{margin-top:10px;overflow:hidden;border:1px solid #e7dfc2;border-radius:12px;background:#fff;white-space:normal}.artifact-head{display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid #e7dfc2}.artifact-head strong{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.artifact-head button,.artifact-head a,.artifact-dialog button{display:grid;width:44px;height:44px;place-items:center;border:0;border-radius:9px;background:#f7f3e5;color:#24221c;text-decoration:none;cursor:pointer}.artifact-body{padding:10px}.artifact img{display:block;width:100%;max-height:360px;object-fit:contain;border-radius:9px;background:#f8fafc}.artifact.qr img{max-width:240px;margin:auto;background:#fff}.artifact figcaption{margin-top:8px;color:#696453;font-size:12px}.artifact details{margin-top:8px}.artifact table{width:100%;border-collapse:collapse;font-size:11px}.artifact th,.artifact td{padding:5px;border-bottom:1px solid #e7dfc2;text-align:right}.artifact th:first-child{text-align:left}.artifact-dialog{width:min(94vw,900px);height:min(90dvh,760px);border:1px solid #e7dfc2;border-radius:16px;padding:12px;background:#fff}.artifact-dialog::backdrop{background:#0f172aaa}.artifact-dialog header{display:flex;align-items:center;gap:8px}.artifact-dialog header strong{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.artifact-dialog img{width:100%;height:calc(100% - 54px);object-fit:contain}.status{padding:8px 16px;font-size:12px;color:#696453;background:#fffdf5}.composer{display:grid;grid-template-columns:1fr auto;gap:8px;padding:12px;border-top:1px solid #e7dfc2}.composer input{min-width:0;min-height:44px;border:1px solid #d8cfad;border-radius:12px;padding:0 12px;font:inherit}.composer button{min-width:72px;min-height:44px;border:0;border-radius:12px;background:#ffd400;color:#24221c;font-weight:700;cursor:pointer}.composer button:disabled{opacity:.55}.suggestions{display:flex;gap:8px;overflow:auto;padding:0 12px 12px}.suggestions button{min-height:38px;flex:none;border:1px solid #ffe66b;border-radius:999px;background:#fff5b8;color:#5c4900;padding:0 12px}@media(max-width:520px){.app{border:0;border-radius:0}.message{max-width:94%}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
.artifact-body{margin:0}.artifact-dialog img{max-height:none}
:root{font-family:${fontFamily}}.head{background:${headerColor};color:${headerForeground}}.user,.composer button{background:${primaryColor};color:${primaryForeground}}.assistant,.suggestions button{background:${bubbleColor}}.suggestions button{border-color:${primaryColor}}${avatarRule}${bot.brandingEnabled ? "" : ".head p{display:none}"}${colorModeRules}
</style></head><body><main class="app" aria-label="${html(bot.name)} chat"><header class="head"><div><h1>${html(bot.name)}</h1><p>AI-Sales secure knowledge assistant</p></div><button class="close" id="close" aria-label="Close chat">×</button></header><div><div id="messages" class="messages" role="log" aria-live="polite" aria-relevant="additions"></div><div id="suggestions" class="suggestions"></div><p id="status" class="status" role="status">Waiting for secure host authentication…</p></div><form id="composer" class="composer"><label class="sr-only" for="message">Message</label><input id="message" maxlength="8000" placeholder="Ask about your knowledge…" autocomplete="off" disabled><button id="send" disabled>Send</button></form></main>
<script nonce="${nonce}">
(()=>{'use strict';const BOT_ID=${JSON.stringify(bot.id)};const WELCOME=${JSON.stringify(bot.welcomeMessage)};const SUGGESTIONS=${JSON.stringify(Array.isArray(bot.suggestedQuestions) ? bot.suggestedQuestions.filter((item): item is string => typeof item === "string") : [])};let token=null,hostOrigin=null;const objectUrls=[];const messages=document.getElementById('messages'),status=document.getElementById('status'),input=document.getElementById('message'),send=document.getElementById('send'),suggestions=document.getElementById('suggestions'),closeButton=document.getElementById('close');function labelFor(artifact){return artifact.label||artifact.title||artifact.caption||(artifact.kind==='qr'?'QR code':artifact.kind==='chart'?'Chart':'Image')}function svgSource(svg){return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)}function chartTable(host,artifact){const details=document.createElement('details'),summary=document.createElement('summary'),table=document.createElement('table'),head=document.createElement('thead'),headRow=document.createElement('tr'),category=document.createElement('th'),body=document.createElement('tbody');summary.textContent='Chart data';category.textContent='Category';headRow.appendChild(category);artifact.datasets.forEach((dataset,index)=>{const cell=document.createElement('th');cell.textContent=dataset.label||'Series '+(index+1);headRow.appendChild(cell)});head.appendChild(headRow);artifact.labels.forEach((label,rowIndex)=>{const row=document.createElement('tr'),heading=document.createElement('th');heading.textContent=label;row.appendChild(heading);artifact.datasets.forEach(dataset=>{const cell=document.createElement('td');cell.textContent=String(dataset.data[rowIndex])+(artifact.valueSuffix||'');row.appendChild(cell)});body.appendChild(row)});table.append(head,body);details.append(summary,table);host.appendChild(details)}async function renderArtifact(host,artifact){if(!artifact||!['qr','chart','image'].includes(artifact.kind))return;const card=document.createElement('section'),heading=document.createElement('div'),title=document.createElement('strong'),open=document.createElement('button'),download=document.createElement('a'),body=document.createElement('figure'),image=document.createElement('img'),dialog=document.createElement('dialog'),dialogHead=document.createElement('header'),dialogTitle=document.createElement('strong'),dialogClose=document.createElement('button'),dialogImage=document.createElement('img');card.className='artifact '+artifact.kind;heading.className='artifact-head';body.className='artifact-body';dialog.className='artifact-dialog';title.textContent=labelFor(artifact);open.type='button';open.textContent='↗';open.title='Open full size';open.setAttribute('aria-label','Open full size: '+labelFor(artifact));download.textContent='↓';download.title='Download';download.setAttribute('aria-label','Download: '+labelFor(artifact));download.download=artifact.kind+'-'+artifact.id+(artifact.kind==='image'?'.'+artifact.mediaType.split('/')[1]:'.svg');image.alt=artifact.alt||labelFor(artifact);dialogTitle.textContent=labelFor(artifact);dialogClose.type='button';dialogClose.textContent='×';dialogClose.setAttribute('aria-label','Close');dialogImage.alt=image.alt;heading.append(title,open,download);body.appendChild(image);if(artifact.caption){const caption=document.createElement('figcaption');caption.textContent=artifact.caption;body.appendChild(caption)}if(artifact.kind==='chart')chartTable(body,artifact);dialogHead.append(dialogTitle,dialogClose);dialog.append(dialogHead,dialogImage);card.append(heading,body,dialog);host.appendChild(card);open.addEventListener('click',()=>dialog.showModal());dialogClose.addEventListener('click',()=>dialog.close());let source;if(artifact.kind==='image'){try{const response=await fetch(artifact.src,{headers:{authorization:'Bearer '+token},cache:'no-store'});if(!response.ok)throw new Error('IMAGE_FAILED');source=URL.createObjectURL(await response.blob());objectUrls.push(source)}catch{image.alt='Image unavailable';return}}else source=svgSource(artifact.svg);image.src=source;dialogImage.src=source;download.href=source}function add(role,content,artifacts){const item=document.createElement('div');item.className='message '+(role==='USER'?'user':'assistant');item.textContent=content;messages.appendChild(item);if(role==='ASSISTANT'&&Array.isArray(artifacts))artifacts.forEach(artifact=>void renderArtifact(item,artifact));messages.scrollTop=messages.scrollHeight}function setReady(ready,text){input.disabled=!ready;send.disabled=!ready;status.textContent=text;if(ready)input.focus()}function close(){if(hostOrigin)parent.postMessage({type:'insightkm:close',botId:BOT_ID},hostOrigin)}async function history(){const response=await fetch('/api/embed/history/'+encodeURIComponent(BOT_ID),{headers:{authorization:'Bearer '+token},cache:'no-store'});if(!response.ok)return;const data=await response.json();messages.replaceChildren();if(!data.messages.length)add('ASSISTANT',WELCOME);else data.messages.forEach(item=>add(item.role,item.content,item.artifacts))}window.addEventListener('message',async event=>{const data=event.data;if(!data||data.type!=='insightkm:init'||data.botId!==BOT_ID)return;if(event.source!==parent||event.origin!==data.hostOrigin)return;hostOrigin=data.hostOrigin;setReady(false,'Authenticating…');try{const response=await fetch('/api/embed/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({botId:BOT_ID,hostOrigin:data.hostOrigin,payload:data.payload,signature:data.signature,token:data.token})});const result=await response.json();if(!response.ok)throw new Error(result.error||'AUTH_FAILED');token=result.accessToken;await history();setReady(true,'Secure session ready')}catch(error){setReady(false,'Authentication failed. Refresh the host page to try again.')}});document.getElementById('composer').addEventListener('submit',async event=>{event.preventDefault();const message=input.value.trim();if(!message||!token)return;add('USER',message);input.value='';setReady(false,'Thinking…');try{const response=await fetch('/api/embed/chat/'+encodeURIComponent(BOT_ID),{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({message})});const result=await response.json();if(!response.ok)throw new Error(result.message||result.error);add('ASSISTANT',result.assistantMessage.content,result.assistantMessage.artifacts);setReady(true,'Secure session ready')}catch(error){add('ASSISTANT',error.message||'Unable to send message.');setReady(true,'Message failed')}});SUGGESTIONS.forEach(question=>{const button=document.createElement('button');button.type='button';button.textContent=question;button.addEventListener('click',()=>{input.value=question;input.focus()});suggestions.appendChild(button)});closeButton.addEventListener('click',close);window.addEventListener('pagehide',()=>objectUrls.forEach(url=>URL.revokeObjectURL(url)));document.addEventListener('keydown',event=>{if(event.key==='Escape'&&document.querySelector('dialog[open]'))return;if(event.key==='Escape'){event.preventDefault();close();return}if(event.key!=='Tab')return;const focusable=[closeButton,...suggestions.querySelectorAll('button'),input,send].filter(item=>!item.disabled);if(!focusable.length)return;const first=focusable[0],last=focusable[focusable.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}});parent.postMessage({type:'insightkm:ready',botId:BOT_ID},'*')})();
</script></body></html>`;
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": csp,
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "cross-origin-resource-policy": "cross-origin",
    },
  });
}
