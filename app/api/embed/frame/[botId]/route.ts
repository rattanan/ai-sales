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
    : "#4f46e5";
  const headerColor = /^#[0-9a-f]{6}$/i.test(bot.headerColor)
    ? bot.headerColor
    : "#312e81";
  const bubbleColor = /^#[0-9a-f]{6}$/i.test(bot.chatBubbleColor)
    ? bot.chatBubbleColor
    : "#eef2ff";
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
    "img-src 'self' data:",
    `frame-ancestors ${origins.length ? origins.join(" ") : "'none'"}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  const body = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(bot.name)}</title>
<style nonce="${nonce}">
:root{color-scheme:light;font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#172033;background:#fff}*{box-sizing:border-box}body{margin:0;height:100dvh}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.app{display:grid;grid-template-rows:auto 1fr auto;height:100%;border:1px solid #dfe4ee;border-radius:18px;overflow:hidden;background:#fff}.head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;color:#fff;background:linear-gradient(135deg,#3730a3,#6366f1)}.head h1{margin:0;font-size:16px}.head p{margin:2px 0 0;font-size:12px;opacity:.85}.close{width:44px;height:44px;border:0;border-radius:12px;background:#ffffff20;color:#fff;font-size:24px;cursor:pointer}.messages{overflow:auto;padding:16px;background:#f8fafc}.message{max-width:88%;margin:0 0 12px;padding:10px 12px;border-radius:14px;white-space:pre-wrap;font-size:14px;line-height:1.45}.user{margin-left:auto;background:#4f46e5;color:#fff;border-bottom-right-radius:4px}.assistant{background:#fff;border:1px solid #e2e8f0;border-bottom-left-radius:4px}.status{padding:8px 16px;font-size:12px;color:#64748b;background:#f8fafc}.composer{display:grid;grid-template-columns:1fr auto;gap:8px;padding:12px;border-top:1px solid #e2e8f0}.composer input{min-width:0;min-height:44px;border:1px solid #cbd5e1;border-radius:12px;padding:0 12px;font:inherit}.composer button{min-width:72px;min-height:44px;border:0;border-radius:12px;background:#4f46e5;color:#fff;font-weight:700;cursor:pointer}.composer button:disabled{opacity:.55}.suggestions{display:flex;gap:8px;overflow:auto;padding:0 12px 12px}.suggestions button{min-height:38px;flex:none;border:1px solid #c7d2fe;border-radius:999px;background:#eef2ff;color:#3730a3;padding:0 12px}@media(max-width:520px){.app{border:0;border-radius:0}.message{max-width:94%}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
:root{font-family:${fontFamily}}.head{background:${headerColor}}.user,.composer button{background:${primaryColor}}.assistant,.suggestions button{background:${bubbleColor}}.suggestions button{border-color:${primaryColor}}${avatarRule}${bot.brandingEnabled ? "" : ".head p{display:none}"}${colorModeRules}
</style></head><body><main class="app" aria-label="${html(bot.name)} chat"><header class="head"><div><h1>${html(bot.name)}</h1><p>InsightKM secure knowledge assistant</p></div><button class="close" id="close" aria-label="Close chat">×</button></header><div><div id="messages" class="messages" role="log" aria-live="polite" aria-relevant="additions"></div><div id="suggestions" class="suggestions"></div><p id="status" class="status" role="status">Waiting for secure host authentication…</p></div><form id="composer" class="composer"><label class="sr-only" for="message">Message</label><input id="message" maxlength="8000" placeholder="Ask about your knowledge…" autocomplete="off" disabled><button id="send" disabled>Send</button></form></main>
<script nonce="${nonce}">
(()=>{'use strict';const BOT_ID=${JSON.stringify(bot.id)};const WELCOME=${JSON.stringify(bot.welcomeMessage)};const SUGGESTIONS=${JSON.stringify(Array.isArray(bot.suggestedQuestions) ? bot.suggestedQuestions.filter((item): item is string => typeof item === "string") : [])};let token=null,hostOrigin=null;const messages=document.getElementById('messages'),status=document.getElementById('status'),input=document.getElementById('message'),send=document.getElementById('send'),suggestions=document.getElementById('suggestions'),closeButton=document.getElementById('close');function add(role,content){const item=document.createElement('div');item.className='message '+(role==='USER'?'user':'assistant');item.textContent=content;messages.appendChild(item);messages.scrollTop=messages.scrollHeight}function setReady(ready,text){input.disabled=!ready;send.disabled=!ready;status.textContent=text;if(ready)input.focus()}function close(){if(hostOrigin)parent.postMessage({type:'insightkm:close',botId:BOT_ID},hostOrigin)}async function history(){const response=await fetch('/api/embed/history/'+encodeURIComponent(BOT_ID),{headers:{authorization:'Bearer '+token},cache:'no-store'});if(!response.ok)return;const data=await response.json();messages.replaceChildren();if(!data.messages.length)add('ASSISTANT',WELCOME);else data.messages.forEach(item=>add(item.role,item.content))}window.addEventListener('message',async event=>{const data=event.data;if(!data||data.type!=='insightkm:init'||data.botId!==BOT_ID)return;if(event.source!==parent||event.origin!==data.hostOrigin)return;hostOrigin=data.hostOrigin;setReady(false,'Authenticating…');try{const response=await fetch('/api/embed/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({botId:BOT_ID,hostOrigin:data.hostOrigin,payload:data.payload,signature:data.signature,token:data.token})});const result=await response.json();if(!response.ok)throw new Error(result.error||'AUTH_FAILED');token=result.accessToken;await history();setReady(true,'Secure session ready')}catch(error){setReady(false,'Authentication failed. Refresh the host page to try again.')}});document.getElementById('composer').addEventListener('submit',async event=>{event.preventDefault();const message=input.value.trim();if(!message||!token)return;add('USER',message);input.value='';setReady(false,'Thinking…');try{const response=await fetch('/api/embed/chat/'+encodeURIComponent(BOT_ID),{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({message})});const result=await response.json();if(!response.ok)throw new Error(result.message||result.error);add('ASSISTANT',result.assistantMessage.content);setReady(true,'Secure session ready')}catch(error){add('ASSISTANT',error.message||'Unable to send message.');setReady(true,'Message failed')}});SUGGESTIONS.forEach(question=>{const button=document.createElement('button');button.type='button';button.textContent=question;button.addEventListener('click',()=>{input.value=question;input.focus()});suggestions.appendChild(button)});closeButton.addEventListener('click',close);document.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close();return}if(event.key!=='Tab')return;const focusable=[closeButton,...suggestions.querySelectorAll('button'),input,send].filter(item=>!item.disabled);if(!focusable.length)return;const first=focusable[0],last=focusable[focusable.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}});parent.postMessage({type:'insightkm:ready',botId:BOT_ID},'*')})();
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
