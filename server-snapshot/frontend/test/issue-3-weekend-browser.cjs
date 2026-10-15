'use strict';
// Read-only synthetic UI probe. Runs the mock and an isolated Chrome profile on loopback.
const {spawn} = require('node:child_process');
const {createServer} = require('node:net');
const {writeFileSync, mkdirSync, mkdtempSync} = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const scratch = process.env.CFIN_PROBE_SCRATCH;
assert(scratch && path.isAbsolute(scratch), 'Set CFIN_PROBE_SCRATCH to an absolute scratch directory');
const frontend = path.join(scratch, 'frontend');
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const timezone = 'Asia/Novosibirsk';
const cases = [{label:'saturday', iso:'2026-10-17T12:00:00+07:00', day:'2026-10-17'}, {label:'sunday', iso:'2026-10-18T12:00:00+07:00', day:'2026-10-18'}];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve,reject) => {const s=createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const get = async url => {const r=await fetch(url);if(!r.ok)throw Error(`${url}: ${r.status}`);return r.json();};
async function ready(url, child) {for(let n=0;n<100;n++){if(child.exitCode!==null)throw Error(`process exited: ${child.exitCode}`);try {return await get(url);}catch{await sleep(100);}}throw Error(`timeout: ${url}`);}
class CDP {
  constructor(ws) {this.ws=ws;this.id=0;this.waiting=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=this.waiting.get(m.id);if(p){this.waiting.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}}};}
  send(method,params={},sessionId) {const id=++this.id;return new Promise((resolve,reject)=>{this.waiting.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));setTimeout(()=>{if(this.waiting.delete(id))reject(Error(`${method} timed out`));},10000);});}
}
async function main(){
  mkdirSync(scratch,{recursive:true});
  const mockPort=await freePort(), debugPort=await freePort();
  const profile=mkdtempSync(path.join(scratch,'chrome-profile-'));
  const mock=spawn(process.execPath,[path.join(frontend,'test/issue-3-mock-server.cjs')],{cwd:frontend,env:{...process.env,CFIN_MOCK_PORT:String(mockPort)},stdio:['ignore','pipe','pipe']});
  const browser=spawn(chrome,[`--remote-debugging-port=${debugPort}`,'--remote-debugging-address=127.0.0.1',`--user-data-dir=${profile}`,'--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--window-size=1440,900','about:blank'],{stdio:['ignore','pipe','pipe']});
  let ws;
  mock.stdout.on('data',d=>process.stdout.write(`MOCK ${d}`));mock.stderr.on('data',d=>process.stderr.write(`MOCK_ERROR ${d}`));
  browser.stderr.on('data',d=>{if(process.env.CFIN_VERBOSE_CHROME)process.stderr.write(`CHROME ${d}`);});
  console.log(JSON.stringify({mockPort,debugPort,profile,timezone,caseDates:cases}));
  try {
    await ready(`http://127.0.0.1:${mockPort}/api/auth/me`,mock);
    const info=await ready(`http://127.0.0.1:${debugPort}/json/version`,browser);
    ws=new WebSocket(info.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
    const cdp=new CDP(ws);
    for(const test of cases){
      const {targetId}=await cdp.send('Target.createTarget',{url:'about:blank'});
      const {sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:true});
      const send=(method,params)=>cdp.send(method,params,sessionId);
      await send('Page.enable');await send('Runtime.enable');
      await send('Emulation.setTimezoneOverride',{timezoneId:timezone});
      const override=`(()=>{const RealDate=Date;const fixed=${JSON.stringify(test.iso)};class FixedDate extends RealDate{constructor(...args){super(...(args.length?args:[fixed]));}static now(){return new RealDate(fixed).valueOf();}}Object.setPrototypeOf(FixedDate,RealDate);window.Date=FixedDate;})();`;
      await send('Page.addScriptToEvaluateOnNewDocument',{source:override});
      await send('Page.navigate',{url:`http://127.0.0.1:${mockPort}/`});
      const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
      let loaded=false;for(let n=0;n<100;n++){if(await evaluate("document.querySelectorAll('.tablewrap td.amount').length > 0")){loaded=true;break;}await sleep(100);}
      assert(loaded,'mock calendar cells did not render');
      const day=Number(test.day.slice(-2));
      const dayCell=`document.querySelector('tr.income').children[${day}]`;
      const weekdayCell="document.querySelector('tr.income').children[19]";
      const snapshot=async cell=>evaluate(`(()=>{const td=${cell},h=document.querySelectorAll('thead th')[td.cellIndex],w=document.querySelector('.tablewrap'),outline=document.querySelector('.today-column-outline');const rect=td.getBoundingClientRect();return {browserDate:new Date().toString(),browserIso:new Date().toISOString(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,header:{text:h.textContent,class:h.className,background:getComputedStyle(h).backgroundColor},cell:{class:td.className,selected:td.getAttribute('aria-selected'),background:getComputedStyle(td).backgroundColor,shadow:getComputedStyle(td).boxShadow,rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}},outline:outline?{width:outline.getBoundingClientRect().width,height:outline.getBoundingClientRect().height,clip:getComputedStyle(outline).clipPath}:null,scroll:w.scrollLeft,modal:document.querySelector('.overlay .modal')?.innerText||null,selectedCount:document.querySelectorAll('.amount.is-selected').length,month:localStorage.getItem('cfin_month')}})()`);
      const capture=async tag=>{const file=path.join(scratch,`${test.label}-${tag}.png`);const {data}=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(file,Buffer.from(data,'base64'));console.log('SCREENSHOT',file);};
      await evaluate(`${dayCell}.scrollIntoView({block:'center',inline:'center'})`);await sleep(150);
      const initial=await snapshot(dayCell);
      assert.equal(initial.browserIso,new Date(test.iso).toISOString());assert.equal(initial.timezone,timezone);
      assert.match(initial.header.class,/weekend/);assert.match(initial.header.class,/today/);
      assert.match(initial.cell.class,/weekend/);assert.match(initial.cell.class,/today/);
      assert(initial.cell.rect.width>0 && initial.cell.rect.height>0 && initial.outline.width>0 && initial.outline.height>0);
      assert.equal(initial.selectedCount,0);console.log('INITIAL',test.label,JSON.stringify(initial));
      await capture('today-weekend');
      await evaluate(`${dayCell}.click()`);await sleep(200);
      const open=await snapshot(dayCell);
      assert.equal(open.cell.selected,'true');assert.match(open.cell.class,/is-selected/);
      assert.match(open.cell.shadow,/245, 215, 112/);assert(open.modal.includes(test.day));
      assert.equal(open.selectedCount,1);console.log('OPEN',test.label,JSON.stringify(open));
      await capture('selected-modal');
      await evaluate("document.querySelector('.overlay .modal .row button').click()");await sleep(120);
      const closed=await snapshot(dayCell);
      assert.equal(closed.modal,null);assert.equal(closed.cell.selected,'true');
      console.log('CLOSED_NO_SAVE',test.label,JSON.stringify(closed));
      await evaluate(`${weekdayCell}.click()`);await sleep(150);
      const weekday=await snapshot(weekdayCell);
      assert.equal(weekday.cell.selected,'true');assert(!weekday.cell.class.includes('weekend'));assert(!weekday.cell.class.includes('today'));
      assert.equal(weekday.selectedCount,1);assert.match(weekday.modal,/2026-10-19/);
      assert.equal((await snapshot(dayCell)).cell.selected,'false');console.log('WEEKDAY',test.label,JSON.stringify(weekday));
      await evaluate("document.querySelector('.overlay .modal .row button').click()");await sleep(100);
      await evaluate(`${dayCell}.click()`);await sleep(150);
      const returned=await snapshot(dayCell);assert.equal(returned.cell.selected,'true');assert(returned.modal.includes(test.day));
      console.log('RETURN',test.label,JSON.stringify(returned));
      await evaluate("document.querySelector('.overlay .modal .row button').click()");await sleep(100);
      await evaluate("[...document.querySelectorAll('main button')].find(b=>b.textContent==='→').click()");await sleep(250);
      const next=await evaluate(`({month:localStorage.getItem('cfin_month'),selected:document.querySelectorAll('.amount.is-selected').length,todayHeaders:document.querySelectorAll('thead th.today').length,weekdayCells:document.querySelectorAll('tr.income td.amount').length})`);
      assert.equal(next.month,'2026-11');assert.equal(next.selected,0);assert.equal(next.todayHeaders,0);assert(next.weekdayCells>0);
      console.log('NEXT_MONTH',test.label,JSON.stringify(next));
      await evaluate("[...document.querySelectorAll('main button')].find(b=>b.textContent==='←').click()");await sleep(250);
      const previous=await snapshot(dayCell);assert.equal(previous.month,'2026-10');assert.equal(previous.cell.selected,'false');assert.match(previous.header.class,/today/);
      console.log('RETURN_MONTH',test.label,JSON.stringify(previous));
      await cdp.send('Target.closeTarget',{targetId});
    }
  } finally {
    if(ws)ws.close();
    for(const p of [browser,mock]){if(p.exitCode===null){p.kill();await Promise.race([new Promise(r=>p.once('exit',r)),sleep(5000)]);}}
    for(const [label,port] of [['mock',mockPort],['debug',debugPort]]){
      const released=await new Promise(resolve=>{const s=createServer();s.once('error',()=>resolve(false));s.listen(port,'127.0.0.1',()=>s.close(()=>resolve(true)));});
      console.log('PORT_RELEASE',label,port,released);
    }
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
