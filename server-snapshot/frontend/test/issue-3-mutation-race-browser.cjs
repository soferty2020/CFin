'use strict';
// Loopback-only delayed synthetic mutation acknowledgements; GET data is never mutated.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createServer:netServer}=require('node:net');
const http=require('node:http');
const {mkdirSync,mkdtempSync,writeFileSync}=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../../..'),scratch=process.env.CFIN_PROBE_SCRATCH;
assert(scratch&&path.isAbsolute(scratch));
const output=path.join(root,'docs/ISSUE3_MUTATION_FIX_EVIDENCE'),frontend=path.join(scratch,'frontend');
mkdirSync(output,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const port=()=>new Promise((resolve,reject)=>{const s=netServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const n=s.address().port;s.close(()=>resolve(n));});});
class CDP {constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data),p=this.pending.get(m.id);if(p){this.pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}};}send(method,params={},sessionId){const id=++this.id;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));setTimeout(()=>{if(this.pending.delete(id))reject(Error(`${method} timeout`));},15000);});}}
async function main(){
  const mockPort=await port(),proxyPort=await port(),chromePort=await port(),upstream=`http://127.0.0.1:${mockPort}`,origin=`http://127.0.0.1:${proxyPort}`;
  const mock=spawn(process.execPath,[path.join(frontend,'test/issue-3-mock-server.cjs')],{cwd:frontend,env:{...process.env,CFIN_MOCK_PORT:String(mockPort),CFIN_MOCK_TODAY:'2026-10-17'},stdio:['ignore','pipe','pipe']});
  const browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',[`--remote-debugging-port=${chromePort}`,'--remote-debugging-address=127.0.0.1',`--user-data-dir=${mkdtempSync(path.join(scratch,'chrome-mutation-'))}`,'--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--window-size=1440,900','about:blank'],{stdio:['ignore','pipe','pipe']});
  mock.stdout.on('data',d=>process.stdout.write(`MOCK ${d}`));mock.stderr.on('data',d=>process.stderr.write(`MOCK_ERROR ${d}`));
  let ws,proxy,gate=null,passed=false;const events=[];
  const record=(name,data)=>{events.push({name,data});console.log(name,JSON.stringify(data));};
  try{
    proxy=http.createServer((req,res)=>{
      const url=new URL(req.url,upstream),mutation=/^\/api\/entries(?:\/[^/]+)?$/.test(url.pathname)&&['POST','PATCH','DELETE'].includes(req.method);
      const chosen=mutation?gate:null;
      if(chosen){gate=null;chosen.seen=true;record('MUTATION_RECEIVED',{method:req.method,path:url.pathname,fail:chosen.fail});}
      const forward=()=>{
        if(chosen?.fail){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Синтетическая ошибка изменения'}));chosen.done=true;return;}
        if(chosen){res.writeHead(req.method==='DELETE'?204:200,{'Content-Type':'application/json'});res.end(req.method==='DELETE'?undefined:JSON.stringify({id:'synthetic-ack'}));chosen.done=true;return;}
        const headers={...req.headers,host:`127.0.0.1:${mockPort}`};if(headers.origin===origin)headers.origin=upstream;
        const outbound=http.request(upstream+req.url,{method:req.method,headers},up=>{res.writeHead(up.statusCode,up.headers);up.pipe(res);up.once('end',()=>{if(chosen)chosen.done=true;});});
        outbound.on('error',e=>{if(!res.headersSent){res.writeHead(502);res.end(e.message);}});req.pipe(outbound);
      };
      if(chosen)setTimeout(forward,chosen.delay);else forward();
    });
    await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.listen(proxyPort,'127.0.0.1',resolve);});
    const ready=async(url,child)=>{for(let n=0;n<120;n++){if(child.exitCode!==null)throw Error(`child exited ${child.exitCode}`);try{const r=await fetch(url);if(r.ok)return r.json();}catch{}await sleep(100);}throw Error(`timeout ${url}`);};
    await ready(origin+'/api/auth/me',mock);
    const info=await ready(`http://127.0.0.1:${chromePort}/json/version`,browser);
    ws=new WebSocket(info.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
    const cdp=new CDP(ws),{targetId}=await cdp.send('Target.createTarget',{url:'about:blank'}),{sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:true});
    const send=(method,params)=>cdp.send(method,params,sessionId);
    await send('Page.enable');await send('Runtime.enable');await send('Emulation.setTimezoneOverride',{timezoneId:'Asia/Novosibirsk'});
    await send('Page.addScriptToEvaluateOnNewDocument',{source:"(()=>{const D=Date,fixed='2026-10-17T12:00:00+07:00';class FixedDate extends D{constructor(...args){super(...(args.length?args:[fixed]));}static now(){return new D(fixed).valueOf();}}Object.setPrototypeOf(FixedDate,D);window.Date=FixedDate;})();"});
    const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
    const wait=async(expression,ms=8000)=>{const start=performance.now();while(performance.now()-start<ms){if(await evaluate(expression))return;await sleep(15);}throw Error(`timeout: ${expression}`);};
    const old="document.querySelector('tr.income').children[3]",next="document.querySelectorAll('tr.expense')[1].children[17]";
    const state=()=>evaluate("(()=>{const m=document.querySelector('.overlay .modal');return {heading:m?.querySelector('p.muted')?.innerText||null,rows:[...document.querySelectorAll('.overlay .modal .entry')].map(e=>e.innerText),editing:document.querySelector('.overlay .modal input[inputmode=decimal]')?.value||null,confirm:!!document.querySelector('.catmodal'),error:document.querySelector('main > .error')?.innerText||null,modalError:document.querySelector('.catmodal .error')?.innerText||null,loading:!!document.querySelector('.overlay .modal [role=status]')}})()");
    const click=async expression=>{await evaluate(`${expression}.click()`);await wait("document.querySelector('.overlay .modal')!==null");};
    const close=async()=>{await evaluate("document.querySelector('.overlay .modal .row button').click()");await wait("!document.querySelector('.overlay .modal')");};
    const openOld=async()=>{await click(old);await wait("document.querySelectorAll('.overlay .modal .entry').length>=2");};
    const openNext=async()=>{await click(next);await wait("document.querySelectorAll('.overlay .modal .entry').length===1");};
    const mutation=async(method,fail,transition)=>{
      await openOld();
      if(method==='PATCH')await evaluate("document.querySelector('.overlay .modal .entry button.secondary').click()");
      if(method==='DELETE')await evaluate("document.querySelector('.overlay .modal .entry button.danger').click()");
      if(method==='POST')await evaluate("(()=>{const i=document.querySelector('.overlay .modal input[inputmode=decimal]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'7.00');i.dispatchEvent(new Event('input',{bubbles:true}));})()");
      gate={delay:1100,fail,seen:false,done:false};const issued=gate;
      if(method==='DELETE')await evaluate("document.querySelector('.catmodal button:not(.secondary)').click()");
      else await evaluate("[...document.querySelectorAll('.overlay .modal button')].find(b=>b.textContent.includes('Сохранить')||b.textContent.includes('Добавить')).click()");
      for(let n=0;n<100&&!issued.seen;n++)await sleep(10);assert(issued.seen,`${method} not sent`);
      if(transition==='switch')await openNext();
      else if(transition==='close')await close();
      else if(transition==='reopen'){await close();await openOld();}
      else if(transition==='new-confirm'){await evaluate("document.querySelector('.catmodal button.secondary').click()");await evaluate("document.querySelectorAll('.overlay .modal .entry button.danger')[1].click()");await wait("!!document.querySelector('.catmodal')");}
      await sleep(1350);
      const s=await state();record(`${method}-${fail?'failure':'success'}-${transition}`,s);
      if(transition==='switch') {assert.match(s.heading,/2026-10-17/);assert.equal(s.rows.length,1);assert.match(s.rows[0],/6/);assert.equal(s.editing,null);assert.equal(s.confirm,false);assert.equal(s.error,null);assert.equal(s.modalError,null);}
      if(transition==='close')assert.equal(s.heading,null);
      if(transition==='reopen'){assert.match(s.heading,/2026-10-03/);assert.equal(s.error,null);assert.equal(s.modalError,null);}
      if(transition==='new-confirm'){assert.equal(s.confirm,true);assert.equal(s.modalError,null);}
      if(transition==='current'){if(fail)assert(s.error||s.modalError);else {assert.equal(s.error,null);assert.equal(s.modalError,null);}}
      if(transition==='new-confirm')await evaluate("document.querySelector('.catmodal button.secondary').click()");
      if(transition!=='close')await close();
    };
    await send('Page.navigate',{url:origin+'/'});await wait("document.querySelectorAll('tr.income td.amount').length>0");
    // Delayed proxy acknowledgements are controlled, not real database mutations.
    for(const method of ['POST','PATCH','DELETE'])for(const fail of [false,true])for(const transition of ['switch','close','reopen'])await mutation(method,fail,transition);
    await mutation('DELETE',false,'new-confirm');await mutation('DELETE',true,'current');await mutation('POST',false,'current');await mutation('PATCH',true,'current');
    const {data}=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(path.join(output,'final.png'),Buffer.from(data,'base64'));
    await cdp.send('Target.closeTarget',{targetId});
    writeFileSync(path.join(output,'results.json'),JSON.stringify({events,passed:true},null,2));passed=true;
  }finally{
    if(ws)ws.close();if(proxy)await new Promise(r=>proxy.close(r));
    for(const child of [browser,mock])if(child.exitCode===null){child.kill();await Promise.race([new Promise(r=>child.once('exit',r)),sleep(5000)]);}
    for(const [label,n] of [['mock',mockPort],['proxy',proxyPort],['chrome',chromePort]]){const released=await new Promise(r=>{const s=netServer();s.once('error',()=>r(false));s.listen(n,'127.0.0.1',()=>s.close(()=>r(true)));});record('PORT_RELEASE',{label,n,released});assert(released);}
    record('RUN_STATUS',{passed});
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
