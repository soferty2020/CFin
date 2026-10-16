'use strict';
// Synthetic local acceptance probe; isolated Chrome and loopback mock only.
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {createServer} = require('node:net');
const {mkdirSync, mkdtempSync, writeFileSync} = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const scratch = process.env.CFIN_PROBE_SCRATCH;
assert(scratch && path.isAbsolute(scratch), 'CFIN_PROBE_SCRATCH must be absolute');
const frontend = path.join(scratch, 'frontend');
const output = path.join(root, 'docs/ISSUE3_BROWSER_EVIDENCE');
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise((resolve,reject) => {const s=createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const log = (label, value) => console.log(label, JSON.stringify(value));
class CDP {
  constructor(ws) {this.ws=ws;this.id=0;this.waiting=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=this.waiting.get(m.id);if(p){this.waiting.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}}};}
  send(method,params={},sessionId) {const id=++this.id;return new Promise((resolve,reject)=>{this.waiting.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));setTimeout(()=>{if(this.waiting.delete(id))reject(Error(`${method} timeout`));},10000);});}
}
async function main() {
  mkdirSync(scratch,{recursive:true});mkdirSync(output,{recursive:true});
  const mockPort=await freePort(), debugPort=await freePort();
  const profile=mkdtempSync(path.join(scratch,'chrome-regression-'));
  const origin=`http://127.0.0.1:${mockPort}`;
  const mock=spawn(process.execPath,[path.join(frontend,'test/issue-3-mock-server.cjs')],{cwd:frontend,env:{...process.env,CFIN_MOCK_PORT:String(mockPort),CFIN_MOCK_TODAY:'2026-10-17'},stdio:['ignore','pipe','pipe']});
  const browser=spawn(chrome,[`--remote-debugging-port=${debugPort}`,'--remote-debugging-address=127.0.0.1',`--user-data-dir=${profile}`,'--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--window-size=1440,900','about:blank'],{stdio:['ignore','pipe','pipe']});
  let ws,passed=false;
  mock.stdout.on('data',d=>process.stdout.write(`MOCK ${d}`));mock.stderr.on('data',d=>process.stderr.write(`MOCK_ERROR ${d}`));
  browser.stderr.on('data',d=>{if(process.env.CFIN_VERBOSE_CHROME)process.stderr.write(`CHROME ${d}`);});
  log('CONFIG',{origin,debugPort,profile,output,fixedToday:'2026-10-17',timezone:'Asia/Novosibirsk'});
  try {
    const ready=async(url,child)=>{for(let n=0;n<120;n++){if(child.exitCode!==null)throw Error(`${url} process exit ${child.exitCode}`);try{const r=await fetch(url);if(r.ok)return r.json();}catch{}await sleep(100);}throw Error(`timeout ${url}`);};
    await ready(origin+'/api/auth/me',mock);
    const info=await ready(`http://127.0.0.1:${debugPort}/json/version`,browser);
    ws=new WebSocket(info.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
    const cdp=new CDP(ws);
    const {targetId}=await cdp.send('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:true});
    const send=(method,params)=>cdp.send(method,params,sessionId);
    await send('Page.enable');await send('Runtime.enable');
    await send('Emulation.setTimezoneOverride',{timezoneId:'Asia/Novosibirsk'});
    await send('Page.addScriptToEvaluateOnNewDocument',{source:"(()=>{const RealDate=Date;const fixed='2026-10-17T12:00:00+07:00';class FixedDate extends RealDate{constructor(...args){super(...(args.length?args:[fixed]));}static now(){return new RealDate(fixed).valueOf();}}Object.setPrototypeOf(FixedDate,RealDate);window.Date=FixedDate;})();"});
    const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
    const wait=async (expression)=>{for(let n=0;n<100;n++){if(await evaluate(expression))return;await sleep(100);}throw Error(`wait: ${expression}`);};
    const api=async uri=>{const r=await fetch(origin+uri);assert(r.ok,`${uri}: ${r.status}`);return r.json();};
    const before={october:await api('/api/calendar?month=2026-10'),november:await api('/api/calendar?month=2026-11')};
    const ids={first:'33333333-3333-4333-8333-333333333333',second:'44444444-4444-4444-8444-444444444444'};
    const entryUrl=(day,cat,dir)=>`/api/entries?date=${day}&categoryId=${cat}&direction=${dir}`;
    const locations=[entryUrl('2026-10-03',ids.first,'income'),entryUrl('2026-10-03',ids.first,'expense'),entryUrl('2026-10-03',ids.second,'income'),entryUrl('2026-10-17',ids.first,'income'),entryUrl('2026-10-17',ids.first,'expense'),entryUrl('2026-10-17',ids.second,'expense'),entryUrl('2026-11-02',ids.first,'income')];
    before.entries=Object.fromEntries(await Promise.all(locations.map(async u=>[u,await api(u)])));
    log('BASELINE',before);
    await send('Page.navigate',{url:origin+'/'});
    await wait("document.querySelectorAll('tr.income td.amount').length>0");
    const cell="document.querySelector('tr.income').children[17]";
    const hitTests=[];
    const shot=async name=>{const file=path.join(output,name+'.png');const {data}=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(file,Buffer.from(data,'base64'));console.log('SCREENSHOT',file);};
    const clickClose=async()=>{await evaluate("document.querySelector('.overlay .modal .row button').click()");await wait("document.querySelector('.overlay .modal')===null");};
    const pointer=async (target,scroll)=>{
      const position=await evaluate(`(()=>{const td=${target},w=document.querySelector('.tablewrap');td.scrollIntoView({inline:'center',block:'center'});${scroll?'w.scrollLeft+=155;':''}const r=td.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,h=document.elementFromPoint(x,y);return {x,y,rect:{left:r.left,right:r.right,top:r.top,bottom:r.bottom},hit:h?.outerHTML.slice(0,220),contains:h===td||td.contains(h),scroll:w.scrollLeft,wrap:w.getBoundingClientRect().toJSON()}})()`);
      log('HIT_TEST',position);assert(position.contains,'pointer must hit visible target cell');hitTests.push(position);
      await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:position.x,y:position.y});
      await send('Input.dispatchMouseEvent',{type:'mousePressed',x:position.x,y:position.y,button:'left',clickCount:1});
      await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:position.x,y:position.y,button:'left',clickCount:1});
      return position;
    };
    const inspect=()=>evaluate(`(()=>{const td=${cell},h=document.querySelectorAll('thead th')[17],w=document.querySelector('.tablewrap'),s=document.querySelector('thead th.sticky'),o=document.querySelector('.today-column-outline'),get=e=>({class:e.className,bg:getComputedStyle(e).backgroundColor,rect:e.getBoundingClientRect().toJSON()});return {month:localStorage.getItem('cfin_month'),date:new Date().toString(),zone:Intl.DateTimeFormat().resolvedOptions().timeZone,header:get(h),cell:{...get(td),text:td.innerText,aria:td.getAttribute('aria-selected'),shadow:getComputedStyle(td).boxShadow},sticky:get(s),outline:o?{rect:o.getBoundingClientRect().toJSON(),clip:getComputedStyle(o).clipPath}:null,scroll:w.scrollLeft,modal:document.querySelector('.overlay .modal')?.innerText||null,selected:document.querySelectorAll('.amount.is-selected').length,expense:document.querySelector('tr.expense td.amount')?.outerHTML.slice(0,250),income:td.outerHTML.slice(0,250)}})()`);
    let state=await inspect();log('INITIAL',state);
    assert.equal(state.month,'2026-10');assert.equal(state.zone,'Asia/Novosibirsk');assert.match(state.header.class,/today.*weekend|weekend.*today/);assert.match(state.cell.class,/today.*weekend|weekend.*today/);
    await evaluate(`${cell}.scrollIntoView({inline:'center',block:'center'})`);await sleep(150);
    log('VISIBLE_WEEKEND',await inspect());await shot('01-weekend-today');
    await evaluate("[...document.querySelectorAll('main button')].find(b=>b.textContent==='→').click()");
    await wait("localStorage.getItem('cfin_month')==='2026-11'");
    await send('Page.reload',{ignoreCache:true});await wait("document.querySelectorAll('tr.income td.amount').length>0 && localStorage.getItem('cfin_month')==='2026-11'");
    const persisted=await evaluate("({month:localStorage.getItem('cfin_month'),title:document.querySelector('main')?.innerText.slice(0,260),cells:document.querySelectorAll('tr.income td.amount').length})");
    log('RELOAD_MONTH',persisted);assert.equal(persisted.month,'2026-11');assert.equal(persisted.cells,60);
    await evaluate("[...document.querySelectorAll('main button')].find(b=>b.textContent==='←').click()");await wait("localStorage.getItem('cfin_month')==='2026-10'");await sleep(200);
    await evaluate("document.querySelector('.tablewrap').scrollLeft=0");await sleep(120);
    await pointer("document.querySelector('tr.income').children[3]",false);
    await wait("document.querySelector('.overlay .modal')?.innerText.includes('2026-10-03')");
    log('BEFORE_SCROLL_MODAL',await evaluate("document.querySelector('.overlay .modal').innerText.slice(0,350)"));
    await clickClose();
    await pointer(cell,false);await wait("document.querySelector('.overlay .modal')!==null");
    log('MODAL_DISCOVERY',await evaluate("({html:document.querySelector('.overlay .modal')?.outerHTML.slice(0,12000),cell:document.querySelector('tr.income').children[17].outerHTML})"));
    if(process.env.CFIN_DISCOVER_ONLY==='1')return;
    const target=entryUrl('2026-10-17',ids.first,'income');
    const setAmount=async amount=>evaluate(`(()=>{const input=document.querySelector('.overlay .modal input[inputmode="decimal"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,${JSON.stringify(amount)});input.dispatchEvent(new Event('input',{bubbles:true}));return input.value})()`);
    const clickModal=async label=>evaluate(`(()=>{const button=[...document.querySelectorAll('.overlay .modal button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!button)throw Error('button missing: '+${JSON.stringify(label)});button.click();return button.textContent})()`);
    const waitCount=async count=>{for(let i=0;i<100;i++){const rows=await api(target),grid=await api('/api/calendar?month=2026-10');if(rows.length===count && grid.cells.some(c=>c.category_id===ids.first&&c.date==='2026-10-17'&&c.direction==='income'&&c.count===count))return {rows,grid};await sleep(100);}throw Error(`expected ${count} saved rows`);};
    assert.equal(await setAmount('41.25'),'41.25');await clickModal('Добавить запись');
    const first=await waitCount(1);log('FIRST_CREATE',first);await shot('02-first-entry');
    log('FIRST_MODAL',await evaluate("document.querySelector('.overlay .modal').outerHTML.slice(0,12000)"));
    assert.equal(await setAmount('13.75'),'13.75');await clickModal('Добавить запись');
    const second=await waitCount(2);assert.notEqual(second.rows[0].id,second.rows[1].id);
    assert.deepEqual(second.rows.map(e=>e.amount),['41.25','13.75']);
    await wait("document.querySelector('tr.income').children[17].innerText.includes('2')");
    log('TWO_ENTRIES',{rows:second.rows,cell:await inspect(),modal:await evaluate("document.querySelector('.overlay .modal').innerText")});
    await shot('03-two-entries-count');
    await evaluate("document.querySelector('.overlay .modal .entry button.secondary').click()");
    await wait("document.querySelector('.overlay .modal input[inputmode=decimal]')?.value==='41.25'");
    log('EDIT_FORM',await evaluate("document.querySelector('.overlay .modal').innerText"));
    assert.equal(await setAmount('51.25'),'51.25');await clickModal('Сохранить изменения');
    for(let i=0;i<100;i++){const rows=await api(target);if(rows.length===2&&rows[0].amount==='51.25'){assert.equal(rows[0].id,second.rows[0].id);assert.deepEqual(rows[1],second.rows[1]);break;}if(i===99)throw Error('edit not persisted');await sleep(100);}
    await wait("document.querySelector('.overlay .modal')?.innerText.includes('51,25')");
    log('EDIT_ONLY_FIRST',{rows:await api(target),modal:await evaluate("document.querySelector('.overlay .modal').innerText")});
    await shot('04-edited-first-only');
    await clickClose();
    const selected=await inspect();assert.equal(selected.selected,1);assert.equal(selected.cell.aria,'true');assert.match(selected.cell.shadow,/245, 215, 112/);
    log('CLOSED_SELECTED',selected);await shot('05-selected-scrolled-sticky');
    await pointer(cell,false);await wait("document.querySelector('.overlay .modal')?.innerText.includes('51,25')");
    const reopened=await evaluate("document.querySelector('.overlay .modal').innerText");
    assert.match(reopened,/13,75/);log('REOPEN_PERSISTENCE',{modal:reopened,rows:await api(target)});
    await shot('06-reopened');await clickClose();
    const distinction=await evaluate("(()=>{const income=document.querySelector('tr.income'),expense=document.querySelector('tr.expense');return {incomeClass:income.className,expenseClass:expense.className,incomeColor:getComputedStyle(income).color,expenseColor:getComputedStyle(expense).color,incomeCell:income.children[17].innerText,expenseCell:expense.children[17].innerText,expenseBg:getComputedStyle(expense.children[17]).backgroundColor}})()");
    log('DIRECTION_RENDER',distinction);assert.notEqual(distinction.incomeColor,distinction.expenseColor);
    assert.match(distinction.incomeClass,/income/);assert.match(distinction.expenseClass,/expense/);
    const after={october:await api('/api/calendar?month=2026-10'),november:await api('/api/calendar?month=2026-11')};
    after.entries=Object.fromEntries(await Promise.all(locations.map(async u=>[u,await api(u)])));
    assert.deepEqual(after.november,before.november);
    for(const [location,rows] of Object.entries(before.entries))if(location!==target)assert.deepEqual(after.entries[location],rows,`moved/altered ${location}`);
    const oldCells=before.october.cells;
    assert.deepEqual(after.october.cells.filter(c=>!(c.category_id===ids.first&&c.date==='2026-10-17'&&c.direction==='income')),oldCells);
    assert.deepEqual(after.entries[target].map(e=>({id:e.id,date:e.entry_date,amount:e.amount})),[
      {id:second.rows[0].id,date:'2026-10-17',amount:'51.25'},
      {id:second.rows[1].id,date:'2026-10-17',amount:'13.75'}]);
    log('AFTER_AND_BASELINE_COMPARISON',{after,unchangedLocations:locations.filter(u=>u!==target),expectedOnlyChange:target});
    assert.equal(hitTests[0].scroll,0);assert(hitTests[1].scroll>0);
    assert.equal(hitTests[0].wrap.left,hitTests[1].wrap.left);
    assert.equal(selected.sticky.rect.x,hitTests[1].wrap.left+1);
    assert(selected.header.rect.left>=selected.sticky.rect.right,'day header should clear sticky label');
    assert(selected.outline.rect.left>=selected.sticky.rect.right,'today outline should clear sticky label');
    writeFileSync(path.join(output,'evidence.json'),JSON.stringify({fixture:{date:'2026-10-17',zone:'Asia/Novosibirsk',origin:'loopback mock'},monthReload:persisted,hitTests,weekendBefore:state,selectedAfter: selected,direction:distinction,created:second.rows,afterEdit:after.entries[target],baseline:before,after,unchangedLocations:locations.filter(u=>u!==target),screenshots:['01-weekend-today.png','02-first-entry.png','03-two-entries-count.png','04-edited-first-only.png','05-selected-scrolled-sticky.png','06-reopened.png'],scope:'local frontend+mock only; real backend and production UNVERIFIED'},null,2));
    passed=true;
  } finally {
    if(ws)ws.close();
    for(const child of [browser,mock]){if(child.exitCode===null){child.kill();await Promise.race([new Promise(r=>child.once('exit',r)),sleep(5000)]);}}
    for(const [label,port] of [['mock',mockPort],['debug',debugPort]]){
      const released=await new Promise(resolve=>{const s=createServer();s.once('error',()=>resolve(false));s.listen(port,'127.0.0.1',()=>s.close(()=>resolve(true)));});
      log('PORT_RELEASE',{label,port,released});assert(released,`${label} port still occupied`);
    }
    log('RUN_STATUS',{passed,discoverOnly:process.env.CFIN_DISCOVER_ONLY==='1'});
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
