'use strict';
// Local synthetic diagnosis only; no external origin or persistent DB.
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {createServer: netServer} = require('node:net');
const http = require('node:http');
const {mkdirSync, mkdtempSync, writeFileSync} = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const scratch = process.env.CFIN_PROBE_SCRATCH;
assert(scratch && path.isAbsolute(scratch));
const frontend = path.join(scratch, 'frontend');
const output = path.join(root, 'docs/ISSUE3_MODAL_DIAGNOSIS');
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const port = () => new Promise((resolve, reject) => {const s=netServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const n=s.address().port;s.close(()=>resolve(n));});});
const log = (label, value) => console.log(label,JSON.stringify(value));
class CDP {
  constructor(ws) {this.ws=ws;this.id=0;this.waiting=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=this.waiting.get(m.id);if(p){this.waiting.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}}};}
  send(method,params={},sessionId) {const id=++this.id;return new Promise((resolve,reject)=>{this.waiting.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));setTimeout(()=>{if(this.waiting.delete(id))reject(Error(`${method} timeout`));},15000);});}
}
async function main() {
  mkdirSync(output,{recursive:true});mkdirSync(scratch,{recursive:true});
  const mockPort=await port(), proxyPort=await port(), debugPort=await port();
  const origin=`http://127.0.0.1:${proxyPort}`, upstream=`http://127.0.0.1:${mockPort}`;
  const profile=mkdtempSync(path.join(scratch,'chrome-modal-'));
  const mock=spawn(process.execPath,[path.join(frontend,'test/issue-3-mock-server.cjs')],{cwd:frontend,env:{...process.env,CFIN_MOCK_PORT:String(mockPort),CFIN_MOCK_TODAY:'2026-10-17'},stdio:['ignore','pipe','pipe']});
  const chromeProcess=spawn(chrome,[`--remote-debugging-port=${debugPort}`,'--remote-debugging-address=127.0.0.1',`--user-data-dir=${profile}`,'--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--window-size=1440,900','about:blank'],{stdio:['ignore','pipe','pipe']});
  mock.stdout.on('data',d=>process.stdout.write(`MOCK ${d}`));mock.stderr.on('data',d=>process.stderr.write(`MOCK_ERROR ${d}`));
  chromeProcess.stderr.on('data',d=>{if(process.env.CFIN_VERBOSE_CHROME)process.stderr.write(`CHROME ${d}`);});
  let ws,proxy,delayed=0,passed=false;
  const timing=[];
  log('CONFIG',{origin,upstream,debugPort,profile,timezone:'Asia/Novosibirsk',fixture:'synthetic',output});
  try {
    proxy=http.createServer((req,res)=>{
      const url=new URL(req.url,upstream),start=performance.now();
      const target=url.pathname==='/api/entries'&&url.searchParams.get('date')==='2026-10-17'&&url.searchParams.get('categoryId')==='44444444-4444-4444-8444-444444444444'&&url.searchParams.get('direction')==='expense';
      const lag=target?delayed:0;
      const seq=timing.length;
      timing.push({seq,method:req.method,path:url.pathname+url.search,startMs:start,lagMs:lag});
      const forward=()=>{
        const headers={...req.headers,host:`127.0.0.1:${mockPort}`};
        if(headers.origin===origin)headers.origin=upstream;
        const outbound=http.request(upstream+req.url,{method:req.method,headers},up=>{timing[seq].responseMs=performance.now();timing[seq].status=up.statusCode;res.writeHead(up.statusCode,up.headers);up.pipe(res);up.once('end',()=>{timing[seq].endMs=performance.now();});});
        outbound.on('error',e=>{timing[seq].error=e.message;if(!res.headersSent){res.writeHead(502);res.end('mock unavailable');}});
        req.pipe(outbound);
      };
      if(lag)setTimeout(forward,lag);else forward();
    });
    await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.listen(proxyPort,'127.0.0.1',resolve);});
    const ready=async(url,child)=>{for(let n=0;n<120;n++){if(child.exitCode!==null)throw Error(`${url} process exit ${child.exitCode}`);try{const r=await fetch(url);if(r.ok)return r.json();}catch{}await sleep(100);}throw Error(`timeout ${url}`);};
    await ready(origin+'/api/auth/me',mock);
    const info=await ready(`http://127.0.0.1:${debugPort}/json/version`,chromeProcess);
    ws=new WebSocket(info.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
    const cdp=new CDP(ws);
    const cases=[{day:'2026-10-15',label:'weekday'},{day:'2026-10-17',label:'saturday'},{day:'2026-10-18',label:'sunday'}];
    const colors=[];
    let trials=[],before,newer,after;
    for(const {day,label} of cases){
      const {targetId}=await cdp.send('Target.createTarget',{url:'about:blank'});
      const {sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:true});
      const send=(method,params)=>cdp.send(method,params,sessionId);
      await send('Page.enable');await send('Runtime.enable');
      await send('Emulation.setTimezoneOverride',{timezoneId:'Asia/Novosibirsk'});
      await send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const D=Date,fixed=${JSON.stringify(day+'T12:00:00+07:00')};class FixedDate extends D{constructor(...args){super(...(args.length?args:[fixed]));}static now(){return new D(fixed).valueOf();}}Object.setPrototypeOf(FixedDate,D);window.Date=FixedDate;})();`});
      const evalJS=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
      const wait=async(expression,timeout=10000)=>{const start=performance.now();while(performance.now()-start<timeout){if(await evalJS(expression))return;await sleep(25);}throw Error(`wait ${expression}`);};
      const shot=async name=>{const {data}=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});const file=path.join(output,name+'.png');writeFileSync(file,Buffer.from(data,'base64'));log('SCREENSHOT',file);};
      await send('Page.navigate',{url:origin+'/'});
      await wait("document.querySelectorAll('thead th').length>18 && document.querySelectorAll('tr.income td.amount').length>0");
      const color=await evalJS(`(()=>{const d=${JSON.stringify(Number(day.slice(-2)))},e=document.querySelectorAll('thead th')[d],span=e.querySelector('.dow'),num=e.querySelector('.dnum'),rules=[...document.styleSheets].flatMap(s=>{try{return [...s.cssRules]}catch{return []}}).filter(r=>r.selectorText&&(/today|weekend|thead th|\.dow/.test(r.selectorText))).map(r=>({selector:r.selectorText,css:r.cssText}));e.scrollIntoView({inline:'center',block:'center'});return {date:new Date().toString(),zone:Intl.DateTimeFormat().resolvedOptions().timeZone,html:e.outerHTML,number:num?.innerText,foreground:getComputedStyle(e).color,background:getComputedStyle(e).backgroundColor,backgroundImage:getComputedStyle(e).backgroundImage,dnum:{foreground:getComputedStyle(num).color,background:getComputedStyle(num).backgroundColor},dow:span?{foreground:getComputedStyle(span).color,background:getComputedStyle(span).backgroundColor}:null,rules}})()`);
      assert.match(color.html,/today/);assert.equal(color.zone,'Asia/Novosibirsk');
      if(label==='weekday')assert.doesNotMatch(color.html,/weekend/);else assert.match(color.html,/weekend/);
      colors.push({label,day,...color});log('HEADER_COLOR',colors.at(-1));
      await shot(`today-${label}`);
      if(label==='saturday') {
        const old="document.querySelector('tr.income').children[3]",next="document.querySelectorAll('tr.expense')[1].children[17]";
        const modal=()=>evalJS("(()=>{const m=document.querySelector('.overlay .modal');return {at:performance.now(),heading:m?.querySelector('h3')?.innerText||null,text:m?.innerText||null,rows:[...document.querySelectorAll('.overlay .modal .entry')].map(e=>e.innerText),buttons:[...document.querySelectorAll('.overlay .modal .entry button')].map(b=>b.textContent.trim()),editing:document.querySelector('.overlay .modal input[inputmode=decimal]')?.value||null,confirmation:document.querySelector('.catmodal')?.innerText||null}})()");
        const close=async()=>{await evalJS("document.querySelector('.overlay .modal .row button').click()");await wait("document.querySelector('.overlay .modal')===null");};
        const click=async cell=>{await evalJS(`${cell}.click()`);await wait("document.querySelector('.overlay .modal')!==null");};
        before=await (await fetch(origin+'/api/entries?date=2026-10-03&categoryId=33333333-3333-4333-8333-333333333333&direction=income')).json();
        newer=await (await fetch(origin+'/api/entries?date=2026-10-17&categoryId=44444444-4444-4444-8444-444444444444&direction=expense')).json();
        assert.equal(before.length,2);assert.equal(newer.length,1);assert.equal(newer[0].amount,'6.00');

        for(const lag of [75,1200]){
          delayed=lag;
          await click(old);await wait("document.querySelector('.overlay .modal')?.innerText.includes('100')");await close();
          const start=performance.now();
          const immediate=await evalJS(`(()=>{${next}.click();const m=document.querySelector('.overlay .modal');return {at:performance.now(),heading:m?.querySelector('h3')?.innerText||null,text:m?.innerText||null,rows:[...document.querySelectorAll('.overlay .modal .entry')].map(e=>e.innerText)}})()`);
          await wait("document.querySelector('.overlay .modal')!==null");
          const snapshots=[{elapsedMs:null,clock:'browser performance.now; distinct from Node clock',...immediate}];let prev=JSON.stringify({heading:immediate.heading,rows:immediate.rows});
          for(let i=0;i<180;i++){
            const state=await modal();const key=JSON.stringify({heading:state.heading,rows:state.rows,editing:state.editing,confirmation:state.confirmation});
            if(key!==prev){snapshots.push({elapsedMs:performance.now()-start,...state});prev=key;}
            if(state.rows.length===1 && snapshots.some(s=>s.rows.length===2))break;
            await sleep(10);
          }
          log('MODAL_TRANSITIONS',{lagMs:lag,snapshots});
          assert(snapshots.some(s=>s.rows.length===2 && s.text?.includes('2026-10-17')),`stale rows absent at delay ${lag}`);
          assert.equal(snapshots.at(-1).rows.length,1);
          await shot(`modal-${lag}-settled`);await close();
          // A separately reopened stale window tests edit and delete while heading names the new date.
          const actions=[];
          for(const action of ['edit','delete']){
            await click(old);await wait("document.querySelector('.overlay .modal')?.innerText.includes('100')");await close();
            await click(next);
            await wait("document.querySelector('.overlay .modal')?.innerText.includes('2026-10-17') && document.querySelectorAll('.overlay .modal .entry').length===2");
            const visible=await modal();
            const button=action==='edit'?"document.querySelector('.overlay .modal .entry button.secondary')":"document.querySelector('.overlay .modal .entry button.danger')";
            const exists=await evalJS(`Boolean(${button})`);assert(exists,`${action} button absent`);
            await evalJS(`${button}.click()`);
            const activated=await modal();actions.push({action,visible,activated});
            if(action==='edit')assert.equal(activated.editing,'100.00');
            if(action==='delete')assert(activated.confirmation?.includes('Удалить запись'));
            await shot(`modal-${lag}-${action}`);
            if(action==='delete')await evalJS("document.querySelector('.catmodal button.secondary').click()");
            await wait("document.querySelectorAll('.overlay .modal .entry').length===1",5000);
            await close();
          }
          trials.push({lagMs:lag,snapshots,actions});log('TRIAL',{lagMs:lag,snapshots,actions});
        }
        after=await (await fetch(origin+'/api/entries?date=2026-10-03&categoryId=33333333-3333-4333-8333-333333333333&direction=income')).json();
        assert.deepEqual(after,before,'no synthetic data changed');
        const newAfter=await (await fetch(origin+'/api/entries?date=2026-10-17&categoryId=44444444-4444-4444-8444-444444444444&direction=expense')).json();
        assert.deepEqual(newAfter,newer,'new date unchanged');
        log('DATA_ISOLATION',{before,newer,after,newAfter});
      }
      await cdp.send('Target.closeTarget',{targetId});
    }
    assert.equal(colors.length,3);
    writeFileSync(path.join(output,'timeline.json'),JSON.stringify({configuration:{origin,upstream,timezone:'Asia/Novosibirsk',ordinaryDelayMs:75,slowDelayMs:1200},colors,trials,timing,before,newer,after},null,2));
    passed=true;
  }finally{
    if(ws)ws.close();if(proxy)await new Promise(resolve=>proxy.close(resolve));
    for(const child of [chromeProcess,mock])if(child.exitCode===null){child.kill();await Promise.race([new Promise(r=>child.once('exit',r)),sleep(5000)]);}
    for(const [label,n] of [['mock',mockPort],['proxy',proxyPort],['chrome',debugPort]]){const released=await new Promise(resolve=>{const s=netServer();s.once('error',()=>resolve(false));s.listen(n,'127.0.0.1',()=>s.close(()=>resolve(true)));});log('PORT_RELEASE',{label,n,released});assert(released);}
    log('RUN_STATUS',{passed});
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
