const loader = String.raw`(()=>{
  'use strict';
  if(window.InsightKMWidget)return;
  const instances=new Map();
  const sizes={COMPACT:[320,480],STANDARD:[390,650],LARGE:[460,720]};
  function init(options){
    if(!options||!options.botId||!options.apiBase||!options.hostOrigin)throw new Error('InsightKMWidget: botId, apiBase and hostOrigin are required');
    const apiBase=new URL(options.apiBase).origin;
    const hostOrigin=new URL(options.hostOrigin).origin;
    if(hostOrigin!==window.location.origin)throw new Error('InsightKMWidget: hostOrigin must match the current page');
    if(instances.has(options.botId))return instances.get(options.botId);
    const host=document.createElement('div');
    host.dataset.insightkmWidget=options.botId;
    document.body.appendChild(host);
    const root=host.attachShadow({mode:'open'});
    root.innerHTML='<style>:host{all:initial;--ikm-accent:#4f46e5;--ikm-launcher:56px;--ikm-panel-width:390px;--ikm-panel-height:650px}.toggle{position:fixed;bottom:20px;z-index:2147483000;display:grid;place-items:center;width:var(--ikm-launcher);height:var(--ikm-launcher);overflow:hidden;border:0;border-radius:50%;background:var(--ikm-accent);color:#fff;box-shadow:0 12px 30px #0f172a38;font:700 22px system-ui;cursor:pointer}.toggle img{width:100%;height:100%;object-fit:cover}.panel{position:fixed;bottom:calc(var(--ikm-launcher) + 32px);z-index:2147482999;width:min(var(--ikm-panel-width),calc(100vw - 24px));height:min(var(--ikm-panel-height),calc(100dvh - 112px));border:0;border-radius:18px;background:#fff;box-shadow:0 18px 60px #0f172a45}.panel[hidden]{display:none}@media(max-width:520px){.panel{inset:0;width:100vw;height:100dvh;border-radius:0}.toggle{bottom:14px}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}</style><button class="toggle" aria-label="Open InsightKM chat" aria-expanded="false">✦</button><iframe class="panel" title="InsightKM secure chat" hidden></iframe>';
    const button=root.querySelector('.toggle'),frame=root.querySelector('.panel');
    function place(position){
      const left=position==='LEFT'||position==='bottom-left';
      button.style.left=left?'20px':'auto';button.style.right=left?'auto':'20px';
      frame.style.left=left?'20px':'auto';frame.style.right=left?'auto':'20px';
    }
    function apply(config){
      const optionColors={slate:'#0f172a',emerald:'#047857',indigo:'#4f46e5'};
      const accent=optionColors[options.theme]||(/^#[0-9a-f]{6}$/i.test(config.primaryColor||'')?config.primaryColor:'#4f46e5');
      const launcher=Math.max(40,Math.min(80,Number(config.launcherSize)||56));
      const dimensions=sizes[config.widgetSize]||sizes.STANDARD;
      host.style.setProperty('--ikm-accent',accent);
      host.style.setProperty('--ikm-launcher',launcher+'px');
      host.style.setProperty('--ikm-panel-width',dimensions[0]+'px');
      host.style.setProperty('--ikm-panel-height',dimensions[1]+'px');
      place(options.position||config.windowPosition||'RIGHT');
      if(config.launcherIcon){const image=document.createElement('img');image.src=new URL(config.launcherIcon,apiBase).href;image.alt='';button.replaceChildren(image)}
    }
    place(options.position||'RIGHT');
    fetch(apiBase+'/api/embed/config/'+encodeURIComponent(options.botId),{mode:'cors'}).then(response=>response.ok?response.json():Promise.reject()).then(apply).catch(()=>apply({}));
    frame.src=apiBase+'/api/embed/frame/'+encodeURIComponent(options.botId);
    let ready=false;
    function send(){if(!ready)return;frame.contentWindow.postMessage({type:'insightkm:init',botId:options.botId,hostOrigin,payload:options.payload,signature:options.signature,token:options.token},apiBase)}
    function open(){frame.hidden=false;button.setAttribute('aria-expanded','true');button.setAttribute('aria-label','Close InsightKM chat');send();frame.focus()}
    function close(){frame.hidden=true;button.setAttribute('aria-expanded','false');button.setAttribute('aria-label','Open InsightKM chat');button.focus()}
    button.addEventListener('click',()=>frame.hidden?open():close());
    window.addEventListener('message',event=>{if(event.origin!==apiBase||event.source!==frame.contentWindow||!event.data||event.data.botId!==options.botId)return;if(event.data.type==='insightkm:ready'){ready=true;send()}if(event.data.type==='insightkm:close')close()});
    const instance={open,close,destroy(){host.remove();instances.delete(options.botId)}};
    instances.set(options.botId,instance);
    return instance;
  }
  window.InsightKMWidget={init};
})();`;

export async function GET() {
  return new Response(loader, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
      "cross-origin-resource-policy": "cross-origin",
      "x-content-type-options": "nosniff",
    },
  });
}
