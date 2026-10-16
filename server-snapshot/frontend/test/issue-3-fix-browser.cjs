'use strict';
// Synthetic local browser test: in-memory fixture, loopback proxy, isolated Chrome.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createServer:netServer}=require('node:net');
const http=require('node:http');
const {mkdirSync,mkdtempSync,writeFileSync}=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../../..');
const scratch=process.env.CFIN_PROBE_SCRATCH;
assert(scratch&&path.isAbsolute(scratch));
const output=path.join(root,'docs/ISSUE3_FIX_EVIDENCE');
const frontend=path.join(scratch,'frontend');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const port=()=>new Promise((resolve,reject)=>{const s=netServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const n=s.address().port;s.close(()=>resolve(n));});});
class CDP {
  constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data),p=this.pending.get(m.id);if(p){this.pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}};}
  send(method,params={},sessionId){const id=++this.id;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));setTimeout(()=>{if(this.pending.delete(id))reject(Error(`${method} timeout`));},15000);});}
}
const contrast=(a,b)=>{const rgb=s=>[...s.matchAll(/\d+/g)].slice(0,3).map(m=>Number(m[0])/255);const lum=s=>rgb(s).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((n,x,i)=>n+x*[.2126,.7152,.0722][i],0);const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
async function main(){
  mkdirSync(output,{recursive:true});
  const mockPort=await port(),proxyPort=await port(),chromePort=await port();
  const upstream=`http://127.0.0.1:${mockPort}`,origin=`http://127.0.0.1:${proxyPort}`;
  const mock=spawn(process.execPath,[path.join(frontend,'test/issue-3-mock-server.cjs')],{cwd:frontend,env:{...process.env,CFIN_MOCK_PORT:String(mockPort),CFIN_MOCK_TODAY:'2026-10-17'},stdio:['ignore','pipe','pipe']});
  const browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',[`--remote-debugging-port=${chromePort}`,'--remote-debugging-address=127.0.0.1',`--user-data-dir=${mkdtempSync(path.join(scratch,'chrome-fix-'))}`,'--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--window-size=1440,900','about:blank'],{stdio:['ignore','pipe','pipe']});
  mock.stdout.on('data',d=>process.stdout.write(`MOCK ${d}`));mock.stderr.on('data',d=>process.stderr.write(`MOCK_ERROR ${d}`));
  const timing=[],events=[],colors=[];let ws,proxy,mode={old:0,next:0,error:null},passed=false;
  const record=(name,data)=>{events.push({name,data});console.log(name,JSON.stringify(data));};
  try{
    proxy=http.createServer((req,res)=>{
      const url=new URL(req.url,upstream),date=url.searchParams.get('date'),target=url.pathname==='/api/entries'&&req.method==='GET';
      const kind=date==='2026-10-03'?'old':date==='2026-10-17'?'next':null;
      const delay=target&&kind?mode[kind]:0,fail=target&&kind===mode.error;
      const event={kind,method:req.method,url:url.pathname+url.search,delay,fail,start:performance.now()};timing.push(event);
      setTimeout(()=>{if(fail){event.status=503;event.end=performance.now();res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Синтетическая ошибка загрузки'}));return;}
        const headers={...req.headers,host:`127.0.0.1:${mockPort}`};if(headers.origin===origin)headers.origin=upstream;
        const outbound=http.request(upstream+req.url,{method:req.method,headers},up=>{event.status=up.statusCode;res.writeHead(up.statusCode,up.headers);up.pipe(res);up.once('end',()=>event.end=performance.now());});
        outbound.on('error',e=>{event.error=e.message;if(!res.headersSent){res.writeHead(502);res.end();}});req.pipe(outbound);
      },delay);
    });
    await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.listen(proxyPort,'127.0.0.1',resolve);});
    const ready=async(url,child)=>{for(let n=0;n<120;n++){if(child.exitCode!==null)throw Error(`child exited ${child.exitCode}`);try{const r=await fetch(url);if(r.ok)return r.json();}catch{}await sleep(100);}throw Error(`timeout ${url}`);};
    await ready(origin+'/api/auth/me',mock);
    const info=await ready(`http://127.0.0.1:${chromePort}/json/version`,browser);
    ws=new WebSocket(info.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
    const cdp=new CDP(ws);
    for(const {label,day} of [{label:'weekday',day:'2026-10-15'},{label:'saturday',day:'2026-10-17'},{label:'sunday',day:'2026-10-18'}]){
      const {targetId}=await cdp.send('Target.createTarget',{url:'about:blank'}),{sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:true});
      const send=(method,params)=>cdp.send(method,params,sessionId);
      await send('Page.enable');await send('Runtime.enable');await send('Emulation.setTimezoneOverride',{timezoneId:'Asia/Novosibirsk'});
      await send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const D=Date,fixed=${JSON.stringify(day+'T12:00:00+07:00')};class FixedDate extends D{constructor(...args){super(...(args.length?args:[fixed]));}static now(){return new D(fixed).valueOf();}}Object.setPrototypeOf(FixedDate,D);window.Date=FixedDate;})();`});
      const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
      const wait=async(expression,ms=8000)=>{const start=performance.now();while(performance.now()-start<ms){if(await evaluate(expression))return;await sleep(15);}throw Error(`timeout: ${expression}`);};
      const shot=async name=>{const {data}=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(path.join(output,name+'.png'),Buffer.from(data,'base64'));};
      await send('Page.navigate',{url:origin+'/'});await wait("document.querySelectorAll('tr.income td.amount').length>0");
      const color=await evaluate(`(()=>{const th=document.querySelectorAll('thead th')[${Number(day.slice(-2))}],num=th.querySelector('.dnum'),s=getComputedStyle(th);th.scrollIntoView({inline:'center'});return {classes:th.className,foreground:getComputedStyle(num).color,background:s.backgroundColor,gradient:s.backgroundImage,day:num.textContent}})()`);
      if(label==='weekday'){assert.equal(color.foreground,'rgb(8, 15, 25)');assert.match(color.gradient,/gradient/);}else{assert.match(color.classes,/weekend/);assert.equal(color.foreground,'rgb(232, 241, 245)');assert.equal(color.background,'rgb(39, 58, 80)');}
      color.ratio=color.gradient==='none'?contrast(color.foreground,color.background):null;
      color.gradientEndpointRatios=color.gradient==='none'?null:[...color.gradient.matchAll(/rgb\(\d+, \d+, \d+\)/g)].map(m=>contrast(color.foreground,m[0]));
      assert((color.ratio??Math.min(...color.gradientEndpointRatios))>=4.5);
      colors.push({label,day,...color});record('COLOR',colors.at(-1));await shot(`today-${label}`);
      if(label==='saturday'){
        const old="document.querySelector('tr.income').children[3]",next="document.querySelectorAll('tr.expense')[1].children[17]";
        const state=()=>evaluate("(()=>{const m=document.querySelector('.overlay .modal');return {heading:m?.querySelector('p.muted')?.innerText||null,text:m?.innerText||null,rows:[...document.querySelectorAll('.overlay .modal .entry')].map(e=>e.innerText),oldEdit:!!document.querySelector('.overlay .modal .entry button.secondary'),oldDelete:!!document.querySelector('.overlay .modal .entry button.danger'),loading:!!document.querySelector('.overlay .modal [role=status]'),error:document.querySelector('.overlay .modal [role=alert]')?.innerText||null,editValue:document.querySelector('.overlay .modal input[inputmode=decimal]')?.value||null,deleteConfirm:!!document.querySelector('.catmodal')}})()");
        const click=async expression=>{await evaluate(`${expression}.click()`);await wait("document.querySelector('.overlay .modal')!==null");};
        const close=async()=>{await evaluate("document.querySelector('.overlay .modal .row button').click()");await wait("!document.querySelector('.overlay .modal')");};
        const oldReady=async()=>{await click(old);await wait("document.querySelectorAll('.overlay .modal .entry').length===2");};
        const nextReady=async()=>{await wait("document.querySelectorAll('.overlay .modal .entry').length===1 && !document.querySelector('.overlay .modal [role=status]')");};
        const pending=async (name,day='2026-10-17')=>{const s=await state();record(name,s);assert(s.heading?.includes(day));assert(s.loading);assert.equal(s.rows.length,0);assert.equal(s.oldEdit,false);assert.equal(s.oldDelete,false);assert.equal(s.editValue,null);await shot(name);};
        const baseline={old:await (await fetch(origin+'/api/entries?date=2026-10-03&categoryId=33333333-3333-4333-8333-333333333333&direction=income')).json(),next:await (await fetch(origin+'/api/entries?date=2026-10-17&categoryId=44444444-4444-4444-8444-444444444444&direction=expense')).json()};
        mode={old:0,next:1200,error:null};await oldReady();await evaluate("document.querySelector('.overlay .modal .entry button.secondary').click()");assert.equal((await state()).editValue,'100.00');await click(next);await pending('old-edit-reset');await nextReady();await close();
        await oldReady();await evaluate("document.querySelector('.overlay .modal .entry button.danger').click()");assert((await state()).deleteConfirm);await click(next);await pending('old-delete-reset');assert.equal((await state()).deleteConfirm,false);await nextReady();await close();
        for(const delay of [75,1200]){
          mode={old:0,next:delay,error:null};await oldReady();await close();await click(next);await pending(`pending-${delay}`);await nextReady();const s=await state();assert.match(s.heading,/2026-10-17/);assert.equal(s.rows.length,1);assert.match(s.rows[0],/6/);record(`settled-${delay}`,s);await close();
        }
        // Slow old success and old failure must not replace a newer cell's rows or clear its loading.
        for(const error of [null,'old']){
          mode={old:1200,next:75,error};await click(old);await pending(`pending-old-${error||'success'}`,'2026-10-03');await click(next);await pending(`out-of-order-${error||'success'}`);await nextReady();await sleep(1350);const s=await state();assert.match(s.heading,/2026-10-17/);assert.equal(s.rows.length,1);assert.equal(s.error,null);record(`late-old-${error||'success'}`,s);await close();
        }
        // Close before response and reopen the very same cell; old request identity must be invalid.
        mode={old:0,next:1200,error:null};await click(next);await pending('before-close');await close();mode.next=75;await click(next);await pending('same-cell-reopened');await nextReady();await sleep(1300);let s=await state();assert.equal(s.rows.length,1);assert.equal(s.error,null);record('same-cell-after-late-response',s);await close();
        mode={old:0,next:1200,error:'next'};await click(next);await pending('before-close-error');await close();mode.next=75;mode.error=null;await click(next);await pending('same-cell-reopened-error');await nextReady();await sleep(1300);s=await state();assert.equal(s.rows.length,1);assert.equal(s.error,null);assert.equal(s.loading,false);record('same-cell-after-late-error',s);await close();
        // Current request failure must leave an actionable retry, and retry must restore rows.
        mode={old:0,next:75,error:'next'};await click(next);await wait("!!document.querySelector('.overlay .modal [role=alert]')");s=await state();assert.equal(s.rows.length,0);assert.equal(s.loading,false);assert.match(s.error,/Синтетическая ошибка/);record('current-error',s);await shot('current-error');mode.error=null;
        await evaluate("[...document.querySelectorAll('.overlay .modal button')].find(b=>b.textContent==='Повторить').click()");await pending('retry-loading');await nextReady();s=await state();assert.equal(s.error,null);assert.equal(s.rows.length,1);record('recovered',s);await shot('recovered');await close();
        const after={old:await (await fetch(origin+'/api/entries?date=2026-10-03&categoryId=33333333-3333-4333-8333-333333333333&direction=income')).json(),next:await (await fetch(origin+'/api/entries?date=2026-10-17&categoryId=44444444-4444-4444-8444-444444444444&direction=expense')).json()};assert.deepEqual(after,baseline);record('DATA_UNCHANGED',{baseline,after});
      }
      await cdp.send('Target.closeTarget',{targetId});
    }
    writeFileSync(path.join(output,'results.json'),JSON.stringify({colors,events,timing,passed:true},null,2));passed=true;
  }finally{
    if(ws)ws.close();if(proxy)await new Promise(r=>proxy.close(r));
    for(const child of [browser,mock])if(child.exitCode===null){child.kill();await Promise.race([new Promise(r=>child.once('exit',r)),sleep(5000)]);}
    for(const [label,n] of [['mock',mockPort],['proxy',proxyPort],['chrome',chromePort]]){const released=await new Promise(r=>{const s=netServer();s.once('error',()=>r(false));s.listen(n,'127.0.0.1',()=>s.close(()=>r(true)));});record('PORT_RELEASE',{label,n,released});assert(released);}
    record('RUN_STATUS',{passed});
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});