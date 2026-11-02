'use strict';
// Local synthetic HTTP/UI-asset smoke; not a real browser or PostgreSQL run.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {join} = require('node:path');
const {existsSync} = require('node:fs');
const {readFileSync} = require('node:fs');
const root=join(__dirname,'..');
const deps=process.env.CFIN_DEPS_NODE_MODULES;
const origin='http://127.0.0.1:4187';
const bank='55555555-5555-4555-8555-555555555555',cash='66666666-6666-4666-8666-666666666666';
test('synthetic mock: explicit account income/expense remain trusted and past edit propagates',async()=>{
  const port=4189,origin=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,[join(__dirname,'issue-3-mock-server.cjs')],{env:{...process.env,CFIN_MOCK_PORT:String(port),CFIN_MOCK_TODAY:'2026-10-29'},stdio:'ignore'});
  try{
    let ready=false;
    for(let i=0;i<50;i++){try{const res=await fetch(origin+'/api/auth/me');ready=res.ok;if(ready)break}catch{}await new Promise(resolve=>setTimeout(resolve,100))}
    assert.ok(ready,'fresh local mock must start');
    const request=async(path,method,body)=>fetch(origin+'/api'+path,{method,headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
    const snapshot=async()=> (await fetch(origin+'/api/daily-balances?month=2026-10')).json();
    const base={entryDate:'2026-10-04',categoryId:'33333333-3333-4333-8333-333333333333',amount:'1.00',accountId:bank};
    let res=await request('/entries','POST',{...base,direction:'income',accountId:undefined});assert.equal(res.status,201);
    const legacy=await res.json();assert.equal(legacy.account_id,null);
    let incomplete=await snapshot();assert.equal(incomplete.days.find(d=>d.date==='2026-10-04').balance,null);
    assert.ok(incomplete.unreviewedEntries.some(e=>e.id===legacy.id));
    res=await request('/entries/'+legacy.id,'PATCH',{...base,direction:'income',amount:'2.00',accountId:undefined});assert.equal(res.status,200);
    assert.equal((await res.json()).account_id,null);
    res=await request('/entries/'+legacy.id,'DELETE');assert.equal(res.status,204);
    res=await request('/entries','POST',{...base,direction:'income'});assert.equal(res.status,201);const income=await res.json();
    res=await request('/entries','POST',{...base,direction:'expense',accountId:cash});assert.equal(res.status,201);
    let view=await snapshot(),day=view.days.find(d=>d.date==='2026-10-04');
    assert.equal(day.completeness,'complete');assert.equal(day.reasons.includes('entry_unreviewed'),false);
    assert.equal(view.unreviewedEntries.length,0);
    const later=view.days.find(d=>d.date==='2026-10-05').balance;
    res=await request('/entries/'+income.id,'PATCH',{...base,direction:'income',entryDate:'2026-10-03',amount:'2.00'});assert.equal(res.status,200);
    view=await snapshot();assert.equal(view.days.find(d=>d.date==='2026-10-03').completeness,'complete');
    assert.equal(view.days.find(d=>d.date==='2026-10-04').completeness,'complete');
    assert.equal(view.days.find(d=>d.date==='2026-10-05').balance,(Number(later)+1).toFixed(2));
  }finally{child.kill()}
});
test('production-style full-month calendar retains categories and shows only two certified balance rows', {skip:!deps||!existsSync(join(deps,'typescript'))||!existsSync(join(deps,'react-dom'))},()=>{
  const ts=require(join(deps,'typescript')),React=require(join(deps,'react')),{renderToStaticMarkup}=require(join(deps,'react-dom/server'));
  const source=ts.createSourceFile('main.tsx',readFileSync(join(root,'src/main.tsx'),'utf8'),ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX);
  const names=['cents','fromCents','certifiedOpening','reasonLabels'];
  const declarations=source.statements.filter(ts.isVariableStatement).flatMap(s=>s.declarationList.declarations).filter(d=>names.includes(d.name.getText(source)));
  const functions=source.statements.filter(s=>ts.isFunctionDeclaration(s)&&['preciseMoney','MonthCalendar'].includes(s.name.text));
  assert.equal(declarations.length,names.length);
  assert.equal(functions.length,2);
  const code=ts.transpileModule(declarations.map(d=>'const '+d.getText(source)+';').join('\n')+'\n'+functions.map(f=>f.getText(source)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
  const {MonthCalendar,certifiedOpening,fromCents,cents}=new Function('React','serverToday','money','useState',code+';return {MonthCalendar,certifiedOpening,fromCents,cents}')(React,()=> '2024-10-07',v=>String(v),React.useState);
  assert.equal(fromCents(cents('90071992547409.93')+cents('0.01')),'90071992547409.94');
  const category={id:'cat',name:'Синтетическая статья',subgroup_id:'sub',allow_income:true,allow_expense:true};
  const cells=[{category_id:'cat',date:'2024-10-03',direction:'income',amount:'90071992547409.93',count:1},{category_id:'cat',date:'2024-10-04',direction:'income',amount:'0.01',count:1},{category_id:'cat',date:'2024-10-06',direction:'expense',amount:'2.00',count:2}];

  const day=(date,balance,movement,reasons=[])=>({date,balance,movement,reasons});
  const snapshot={asOfDate:'2024-10-07',days:[day('2024-10-01','100.00','0.00'),day('2024-10-02','130.00','30.00'),day('2024-10-03','90071992547539.93','90071992547409.93'),day('2024-10-04','90071992547539.94','0.01'),day('2024-10-05','-10.00','0.00'),day('2024-10-06',null,null,['entry_unallocated'])]};
  assert.equal(certifiedOpening(snapshot.days[4]),'-10.00','dated reset is not the previous close');
  assert.equal(certifiedOpening(snapshot.days[5]),null,'incomplete is never zero');
  assert.equal(certifiedOpening(day('2024-10-07','120.00',null)),null,'unallocated movement makes opening unknown');
  const props={changeMonth:()=>{},groups:[{id:'group',name:'Демо-группа'}],subs:[{id:'sub',group_id:'group',name:'Демо-подгруппа'}],cats:[category],cells,snapshot,calendarReady:true,selectedCell:{date:'2024-10-06',categoryId:'cat',direction:'expense'},openCell:()=>{}};
  const render=month=>renderToStaticMarkup(React.createElement(MonthCalendar,{...props,month}));
  for(const [month,length] of [['2023-02',28],['2024-02',29],['2024-04',30],['2024-10',31]]){
    const html=render(month);
    assert.equal((html.match(/<thead>[\s\S]*?<\/thead>/)||[])[0].match(/<th\b/g).length,length+1,month);
    assert.equal((html.match(/balance-calendar-row/g)||[]).length,2,month);
    assert.match(html,/Остаток на начало дня/);assert.match(html,/Расчётный остаток на конец дня/);
    assert.ok(!/Итого за период|Кассовый разрыв|Следующая неделя|Направление <select|grid-toolbar/.test(html));
  }
  const html=render('2024-10');
  assert.match(html,/Демо-группа/);assert.match(html,/Демо-подгруппа/);
  assert.match(html,/colSpan="32"/);assert.match(html,/Синтетическая статья/);
  assert.match(html,/aria-selected="true"/);assert.match(html,/badge/);
  assert.match(html,/weekend has-data/);assert.match(html,/negative-balance/);assert.match(html,/Неполно/);
  assert.match(html,/Сегодня/);assert.match(html,/90071992547409/);
  const loading=renderToStaticMarkup(React.createElement(MonthCalendar,{...props,month:'2024-10',snapshot:null,calendarReady:false}));
  assert.match(loading,/Загрузка…/);assert.ok(!loading.includes('90071992547409'),'stale month figures must not appear');
  const failed=renderToStaticMarkup(React.createElement(MonthCalendar,{...props,month:'2024-10',snapshot:null,financialProblem:'HTTP 503',calendarReady:false}));
  assert.match(failed,/Ошибка загрузки/);assert.ok(!failed.includes('100,00 ₽'));
  const css=readFileSync(join(root,'src/style.css'),'utf8');
  assert.match(css,/\.tablewrap\{[^}]*overflow:auto/);
  assert.match(css,/th\.sticky,td\.sticky\{[^}]*left:0/);
  assert.match(css,/\.balance-calendar-row/);
});
test('actual frontend request helper ignores out-of-order success and error after month switch', {skip:!deps||!existsSync(join(deps,'typescript'))},async()=>{
  const ts=require(join(deps,'typescript'));
  const source=ts.createSourceFile('main.tsx',readFileSync(join(root,'src/main.tsx'),'utf8'),ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX);
  const helper=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='fetchFinancialSnapshot');
  assert.ok(helper,'test must exercise actual request implementation');
  const js=ts.transpileModule(helper.getText(source),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const pending=[];
  const api=path=>new Promise((resolve,reject)=>pending.push({path,resolve,reject}));
  const refresh=new Function('api',js+';return fetchFinancialSnapshot')(api);
  const applied=[],errors=[];let month='2026-09',generation=0;
  const start=selected=>{const version=++generation;return refresh(selected,()=>version===generation&&month===selected,(snapshot,history)=>applied.push([snapshot,history]),message=>errors.push(message))};
  const old=start(month);month='2026-11';const newest=start(month);
  pending[2].resolve({month:'2026-11',today:{balance:'117.00'}});pending[3].resolve([]);
  await newest;
  pending[0].resolve({month:'2026-09',today:{balance:'999.00'}});pending[1].resolve([]);
  await old;
  assert.deepEqual(applied.map(([snapshot])=>snapshot.month),['2026-11']);
  assert.equal(applied[0][0].today.balance,'117.00');
  const staleFailure=start('2026-09');month='2026-10';const current=start(month);
  pending[4].reject(Error('stale failure'));pending[5].resolve([]);
  await assert.rejects(staleFailure,/stale failure/);
  pending[6].resolve({month:'2026-10'});pending[7].resolve([]);await current;
  assert.deepEqual(errors,[]);
  const currentFailure=start(month);
  pending[8].reject(Error('current failure'));pending[9].resolve([]);
  await assert.rejects(currentFailure,/current failure/);
  assert.deepEqual(errors,['current failure']);
});
test('delayed old-month mutation never supersedes pending new-month refresh', {skip:!deps||!existsSync(join(deps,'typescript'))},async()=>{
  const ts=require(join(deps,'typescript'));
  const source=ts.createSourceFile('main.tsx',readFileSync(join(root,'src/main.tsx'),'utf8'),ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX);
  const component=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='FinancialCore');
  const actDeclaration=component.body.statements.filter(ts.isVariableStatement).flatMap(node=>node.declarationList.declarations).find(node=>node.name.getText(source)==='act');
  assert.ok(actDeclaration,'exercise the actual component mutation implementation');
  const actJs=ts.transpileModule('const act='+actDeclaration.initializer.getText(source)+';', {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const pending=[];
  const api=path=>new Promise((resolve,reject)=>pending.push({path,resolve,reject}));
  const helper=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='fetchFinancialSnapshot');
  const request=new Function('api',ts.transpileModule(helper.getText(source),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+';return fetchFinancialSnapshot')(api);
  const monthRef={current:'2026-09'},applied=[],problems=[];
  let generation=0,working=false;
  const refresh=month=>{const version=++generation;return request(month,()=>generation===version&&monthRef.current===month,data=>applied.push(data.month),message=>problems.push(message))};
  const oldAct=new Function('setWorking','setProblem','monthRef','month','refresh',actJs+';return act')(
    value=>{working=value},value=>problems.push(value),monthRef,'2026-09',()=>refresh('2026-09'));
  let finishMutation;
  const delayed=oldAct(()=>new Promise(resolve=>{finishMutation=resolve}));
  monthRef.current='2026-11';const newer=refresh('2026-11');
  assert.equal(pending.length,2);
  finishMutation();await delayed;
  assert.equal(working,false);assert.equal(pending.length,2,'old action must not issue a captured-month refresh');
  pending[1].resolve([]);pending[0].resolve({month:'2026-11'});await newer;
  assert.deepEqual(applied,['2026-11']);assert.deepEqual(problems,['']);
});
async function awaitReady(child){
  for(let i=0;i<100;i++){
    if(child.exitCode!==null)throw Error('Synthetic mock exited early: '+child.exitCode);
    try {const r=await fetch(origin+'/');if(r.ok)return r;}catch{}
    await new Promise(r=>setTimeout(r,70));
  }
  throw Error('Synthetic mock readiness timeout');
}
test('bundled local UI assets, dated forecast, POST transfer net-zero, CAS opening and review', {skip:!deps||!existsSync(join(deps,'esbuild'))},async()=>{
  const child=spawn(process.execPath,[join(__dirname,'issue-3-mock-server.cjs')],{cwd:root,env:{...process.env,CFIN_MOCK_BUNDLE:'1',CFIN_MOCK_PORT:'4187',CFIN_MOCK_TODAY:'2026-10-29',CFIN_DEPS_NODE_MODULES:deps},stdio:'ignore'});
  try{
    const html=await (await awaitReady(child)).text();assert.match(html,/issue4.js/);
    const js=await fetch(origin+'/issue4.js'),css=await fetch(origin+'/issue4.css'),logo=await fetch(origin+'/calypso-logo.png');
    assert.equal(js.status,200);assert.equal(css.status,200);assert.equal(logo.status,200);
    assert.ok((await js.text()).includes('financial-core'),'financial component included in browser bundle');assert.ok((await css.text()).includes('financial-core'),'financial styles included');
    const before=await (await fetch(origin+'/api/daily-balances?month=2026-10')).json();
    assert.equal(before.timeZone,'Asia/Novosibirsk');assert.ok(before.current.balance);
    assert.ok(before.days.find(d=>d.date==='2026-10-29').balance);
    const otherMonth=await (await fetch(origin+'/api/daily-balances?month=2026-11')).json();
    assert.equal(otherMonth.today.balance,before.today.balance);
    assert.equal(otherMonth.days.some(d=>d.date===otherMonth.asOfDate),false);
    const post=(p,body,method='POST')=>fetch(origin+'/api'+p,{method,headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
    const moved=await post('/transfers',{date:'2026-10-29',sourceAccountId:bank,targetAccountId:cash,amount:'7.00'});assert.equal(moved.status,201);
    const transfer=await moved.json();
    const after=await (await fetch(origin+'/api/daily-balances?month=2026-10')).json();
    const old=before.days.find(d=>d.date==='2026-10-29'),now=after.days.find(d=>d.date==='2026-10-29');
    assert.equal(now.balance,old.balance);assert.notEqual(now.accounts[0].balance,old.accounts[0].balance);
    const revised=await post('/transfers/'+transfer.id,{date:'2026-10-30',sourceAccountId:bank,targetAccountId:cash,amount:'7.00'},'PATCH');assert.equal(revised.status,200);
    const updated=await (await fetch(origin+'/api/daily-balances?month=2026-10')).json();
    assert.equal(updated.days.find(d=>d.date==='2026-10-29').accounts[0].balance,old.accounts[0].balance);
    const removed=await post('/transfers/'+transfer.id,{},'DELETE');assert.equal(removed.status,204);
    const cleared=await (await fetch(origin+'/api/daily-balances?month=2026-10')).json();assert.equal(cleared.transfers.length,0);
    const baseline=await post('/account-baselines/'+bank+'/2026-10-01',{amount:'-10.00',revision:1,reason:'synthetic reset',firstActivation:false,reconciled:true},'PUT');assert.equal(baseline.status,200);
    const saved=await (await fetch(origin+'/api/account-baselines')).json();assert.equal(saved.find(b=>b.account_id===bank).amount,'-10.00');
    const stale=await post('/account-baselines/'+bank+'/2026-10-01',{amount:'1.00',revision:1,reason:'stale',firstActivation:false,reconciled:true},'PUT');assert.equal(stale.status,409);
    const unallocated=await post('/entries',{entryDate:'2026-10-29',categoryId:'33333333-3333-4333-8333-333333333333',direction:'income',amount:'5.00'});assert.equal(unallocated.status,201);
    const partial=await (await fetch(origin+'/api/daily-balances?month=2026-11')).json();
    assert.equal(partial.todayMovement,null);assert.equal(partial.today.movement,null);
    assert.equal(partial.today.movementComplete,false);
    assert.equal(partial.today.balance,null);
  }finally{child.kill();}
});
