'use strict';
// SQL-shape contract + executable route characterization with synthetic PG-compatible rows.
// This is NOT a real PostgreSQL migration/transaction test: requires disposable PG gate.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const ts = require('typescript');
const {createHash} = require('node:crypto');
const source = readFileSync(join(__dirname, '../src/index.ts'), 'utf8');
const from = source.indexOf('// Financial core v1');
const to = source.indexOf('app.use((err:', from);
assert.ok(from > 0 && to > from);
const code = ts.transpileModule(source.slice(from, to).replace(
  /const businessDate=\(\)=>new Intl\.DateTimeFormat[^;]+;/,
  "const businessDate=()=> '2026-10-29';"
), {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;
const bank = '55555555-5555-4555-8555-555555555555';
const cash = '66666666-6666-4666-8666-666666666666';
const category = '33333333-3333-4333-8333-333333333333';
const user = '11111111-1111-4111-8111-111111111111';
const hash = value => createHash('sha256').update(value).digest('hex');
const row = (id, entry_date, direction, amount, account_id) => ({id, entry_date, direction, amount, account_id, category_id: category});
const id1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', id2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function fixture(overrides = {}) {
  const accounts = [{id: bank, name: 'Bank', kind: 'bank', is_active: true}, {id: cash, name: 'Cash', kind: 'cash', is_active: true}];
  const baselines = [
    {account_id: bank, effective_date: '2026-10-28', amount: '100.00', first_activation: false, reason: 'attested', reconciled: false, revision: 1},
    {account_id: cash, effective_date: '2026-10-29', amount: '25.00', first_activation: true, reason: 'new account', reconciled: false, revision: 1}
  ];
  const entries = [row(id1, '2026-10-29', 'expense', '10.00', bank), row(id2, '2026-10-29', 'income', '2.00', cash)];
  const reviews = entries.map(e => ({entry_id: e.id, account_id: e.account_id, entry_date: e.entry_date, direction: e.direction, amount: e.amount, category_id: category, classification: 'operating'}));
  return {accounts, inventory: [{roster_hash: hash([bank, cash].sort().join('|'))}], baselines, entries, reviews, transfers: [], pairs: [], ...overrides};
}
async function route(data, month='2026-10') {
  const handlers = new Map(), app = {get(p, _auth, h) {handlers.set('GET '+p, h)}, post(){}, put(){}, patch(){}, delete(){}};
  const reads=[];
  const client = {async query(sql, args) {
    reads.push({sql,args});
    if(sql.startsWith('BEGIN')||sql==='COMMIT'||sql==='ROLLBACK') return {rows: []};
    if(sql.includes('FROM accounts ORDER BY sort_order'))return {rows: data.accounts};
    if(sql.includes('FROM financial_inventory'))return {rows: data.inventory};
    if(sql.includes('FROM account_baselines'))return {rows: data.baselines.filter(b=>b.effective_date<=args[0])};
    if(sql.includes('FROM entries WHERE entry_date<='))return {rows: data.entries.filter(e=>e.entry_date<=args[0])};
    if(sql.includes('FROM entry_financial_review'))return {rows: data.reviews};
    if(sql.includes('FROM internal_transfers'))return {rows: data.transfers.filter(t=>t.transfer_date<=args[0])};
    if(sql.includes('FROM legacy_transfer_pairs'))return {rows: data.pairs};
    throw Error('Unexpected SQL: '+sql);
  },release(){}};
  const pool={async connect(){return client}};
  const uuid = x => typeof x==='string' && /^[0-9a-f-]{36}$/.test(x);
  new Function('app','auth','pool','hash','uuid','validDate','safeName','validAmount','randomUUID',code)(app,()=>{},pool,hash,uuid,()=>true,()=>true,()=>true,()=>id1);
  let payload, status=200;
  const response={json(x){payload=x;return this},status(x){status=x;return this}};
  await handlers.get('GET /api/daily-balances')({query:{month}},response,e=>{throw e});
  return {payload,status,reads};
}
test('daily route: yesterday, today once, first activation, future date and transfer net-zero', async()=>{
  const data=fixture({transfers:[{id:id1,transfer_date:'2026-10-29',source_account_id:bank,target_account_id:cash,amount:'7.00'}]});
  data.entries.push(row('cccccccc-cccc-4ccc-8ccc-cccccccccccc','2026-10-30','income','3.00',cash));
  data.reviews.push({...data.entries.at(-1),entry_id:data.entries.at(-1).id,classification:'operating'});
  const {payload,status,reads}=await route(data);
  assert.equal(status,200);assert.equal(payload.asOfDate,'2026-10-29');
  assert.equal(payload.current.balance,'100.00');assert.equal(payload.todayMovement,'-8.00');
  assert.equal(payload.today.balance,'117.00');assert.equal(payload.today.movementComplete,true);
  assert.equal(payload.days.find(d=>d.date==='2026-10-29').balance,'117.00');
  assert.equal(payload.days.find(d=>d.date==='2026-10-30').balance,'120.00');
  assert.deepEqual(payload.days.find(d=>d.date==='2026-10-29').accounts.map(a=>a.balance),['83.00','34.00']);
  assert.equal(reads[0].sql,'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(reads.at(-1).sql,'COMMIT');
});
test('today independent of selected month; NULL-account movement unknown on affected day only',async()=>{
  const data=fixture();
  let {payload}=await route(data,'2026-09');
  assert.equal(payload.days.some(day=>day.date==='2026-10-29'),false);
  assert.equal(payload.today.date,'2026-10-29');
  assert.equal(payload.today.balance,'117.00');
  ({payload}=await route(data,'2026-11'));
  assert.equal(payload.today.balance,'117.00');
  data.entries.push(row('cccccccc-cccc-4ccc-8ccc-cccccccccccc','2026-10-29','income','5.00',null));
  ({payload}=await route(data,'2026-10'));
  assert.equal(payload.todayMovement,null);
  assert.equal(payload.today.movement,null);
  assert.equal(payload.today.movementComplete,false);
  assert.equal(payload.today.balance,null);
  assert.ok(payload.today.reasons.includes('entry_unallocated'));
  assert.equal(payload.days.find(d=>d.date==='2026-10-29').movement,null);
  assert.equal(payload.current.movementComplete,true);
  assert.equal(payload.days.find(d=>d.date==='2026-10-30').movement,'0.00');
});
test('POST accepts old clients without account; explicit account atomically inserts entry_write sidecar',async()=>{
  const fragment=source.slice(source.indexOf("app.post('/api/entries',"),source.indexOf("app.patch('/api/entries/:id'"));
  const code=ts.transpileModule(fragment,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  let handler,fail=false,queries=[];
  const app={post(_path,_auth,fn){handler=fn}};
  const client={async query(sql,args){queries.push(sql);
    if(sql==='BEGIN'||sql==='ROLLBACK'||sql==='COMMIT')return {rows:[]};
    if(sql.startsWith('SELECT id FROM accounts'))return {rowCount:args[0]===bank?1:0,rows:[]};
    if(sql.startsWith('INSERT INTO entries'))return {rows:[row(id1,args[1],args[3],args[4],args[5])]};
    if(sql.startsWith('INSERT INTO entry_financial_review')){if(fail)throw Error('synthetic sidecar failure');return {rows:[]}};
    throw Error('Unexpected SQL: '+sql);
  },release(){}};
  new Function('app','auth','pool','uuid','validDate','validAmount','randomUUID','directionError',code)(app,()=>{},{connect:async()=>client},x=>typeof x==='string'&&/^[0-9a-f-]{36}$/.test(x),()=>true,()=>true,()=>id1,()=>false);
  async function post(accountId){let status=200,body,err;await handler({body:{entryDate:'2026-10-29',categoryId:category,direction:'income',amount:'1.00',...(accountId===undefined?{}:{accountId})},userId:user},{status(x){status=x;return this},json(x){body=x}},e=>{err=e});return {status,body,err}};
  assert.equal((await post(undefined)).status,201);
  assert.deepEqual(queries.map(q=>q.split(' ')[0]),['BEGIN','INSERT','COMMIT']);
  queries=[];
  assert.equal((await post(cash)).status,400);assert.deepEqual(queries,['BEGIN','SELECT id FROM accounts WHERE id=$1 FOR KEY SHARE','ROLLBACK']);
  queries=[];assert.equal((await post(bank)).status,201);
  assert.deepEqual(queries.map(q=>q.split(' ')[0]),['BEGIN','SELECT','INSERT','INSERT','COMMIT']);
  queries=[];fail=true;assert.match((await post(bank)).err.message,/sidecar failure/);
  assert.equal(queries.at(-1),'ROLLBACK');assert.ok(!queries.includes('COMMIT'));
});
test('PATCH accepts old clients, renews only matching entry_write, never certifies legacy',async()=>{
  const patchSource=source.slice(source.indexOf("app.patch('/api/entries/:id'"),source.indexOf("app.delete('/api/entries/:id'"));
  const patchCode=ts.transpileModule(patchSource,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const routes=new Map(),data=fixture();
  data.entries=[row(id1,'2026-10-29','income','5.00',bank)];
  data.reviews=[{entry_id:id1,account_id:bank,entry_date:'2026-10-29',category_id:category,direction:'income',amount:'5.00',classification:'operating',provenance:'entry_write'}];
  const calls=[];
  const client={async query(sql,args){calls.push(sql);
    if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rows:[]};
    if(sql.startsWith('SELECT id,entry_date::text,category_id,direction,amount::text,account_id FROM entries'))return {rowCount:1,rows:[{...data.entries[0]}]};
    if(sql.startsWith('SELECT account_id')&&sql.includes('FROM entry_financial_review'))return {rows:data.reviews.map(r=>({...r}))};
    if(sql.startsWith('SELECT id FROM accounts'))return {rowCount:1,rows:[{id:args[0]}]};
    if(sql.startsWith('UPDATE entries')){data.entries[0]={...data.entries[0],entry_date:args[0],category_id:args[1],direction:args[2],amount:args[3],account_id:args[4]};return {rows:[data.entries[0]]};}
    if(sql.startsWith('UPDATE entry_financial_review')){Object.assign(data.reviews[0],{account_id:args[1],entry_date:args[2],category_id:args[3],direction:args[4],amount:args[5]});return {rows:[]};}
    if(sql.startsWith('DELETE FROM entry_financial_review')){data.reviews=[];return {rows:[]};}
    throw Error('Unexpected SQL: '+sql);
  },release(){}};
  const app={patch(path,_auth,handler){routes.set(path,handler)}},uuid=x=>typeof x==='string'&&/^[0-9a-f-]{36}$/.test(x);
  new Function('app','auth','pool','uuid','validDate','validAmount','directionError','reviewFingerprint',patchCode)(app,()=>{},{connect:async()=>client},uuid,()=>true,()=>true,()=>false,(e,r)=>!!r&&e.entry_date===r.entry_date&&e.category_id===r.category_id&&e.direction===r.direction&&BigInt(Math.round(Number(e.amount)*100))===BigInt(Math.round(Number(r.amount)*100))&&(!e.account_id||e.account_id===r.account_id));
  async function update(accountId,amount='5.00',date='2026-10-29'){let payload,status=200;await routes.get('/api/entries/:id')({params:{id:id1},body:{entryDate:date,categoryId:category,direction:'income',amount,...(accountId===undefined?{}:{accountId})},userId:user},{status(n){status=n;return this},json(value){payload=value;return this}},error=>{throw error});return {payload,status};}
  assert.equal((await update(undefined)).status,200);
  assert.equal(data.entries[0].account_id,null);
  assert.deepEqual(data.reviews,[]);
  let initial=await route(data);assert.equal(initial.payload.today.balance,null);
  assert.ok(initial.payload.today.reasons.includes('entry_unallocated'));
  calls.length=0;data.entries=[row(id1,'2026-10-29','income','5.00',bank)];
  data.reviews=[{entry_id:id1,account_id:bank,entry_date:'2026-10-29',category_id:category,direction:'income',amount:'5.00',classification:'operating',provenance:'entry_write'}];
  assert.equal((await update(bank,'6.00','2026-10-28')).status,200);
  assert.ok(calls.some(sql=>sql.startsWith('UPDATE entry_financial_review')));
  let {payload}=await route(data);
  assert.equal(payload.days.find(d=>d.date==='2026-10-29').balance,'131.00');
  assert.equal(payload.days.find(d=>d.date==='2026-10-28').accounts[0].balance,'106.00');
  assert.deepEqual(payload.unreviewedEntries,[]);
  data.reviews[0].provenance='manual_review';calls.length=0;
  assert.equal((await update(bank,'7.00','2026-10-28')).status,200);
  assert.ok(calls.some(sql=>sql.startsWith('DELETE FROM entry_financial_review')));
  ({payload}=await route(data));assert.ok(payload.today.reasons.includes('entry_unreviewed'));
  data.entries[0].account_id=null;data.reviews=[];calls.length=0;
  assert.equal((await update(undefined)).status,200);
  assert.equal(data.entries[0].account_id,null);
  assert.deepEqual(data.reviews,[]);
  ({payload}=await route(data));assert.ok(payload.today.reasons.includes('entry_unreviewed'));
  calls.length=0;assert.equal((await update(bank)).status,200);
  assert.deepEqual(data.reviews,[]);
});
test('missing inventory, unreviewed entry, future reset and precision fail closed',async()=>{
  const data=fixture();data.inventory=[];data.reviews=[];
  let {payload}=await route(data);
  assert.equal(payload.current.balance,null);
  assert.ok(payload.days.find(d=>d.date==='2026-10-29').reasons.includes('entry_unreviewed'));
  data.inventory=fixture().inventory;data.reviews=fixture().reviews;
  data.baselines.push({account_id:bank,effective_date:'2026-10-30',amount:'120.00',first_activation:false,reason:'manual reset',reconciled:false,revision:1});
  ({payload}=await route(data));
  const reset=payload.days.find(d=>d.date==='2026-10-30');
  assert.equal(reset.balance,null);assert.equal(reset.conditionalBalance,'147.00');
  assert.equal(reset.accounts[0].resetDelta,'30.00');assert.ok(reset.reasons.includes('reset_gap'));
  const huge=fixture({accounts:[{id:bank,name:'Bank',kind:'bank',is_active:true}],inventory:[{roster_hash:hash(bank)}],baselines:[{account_id:bank,effective_date:'2026-10-28',amount:'90071992547409.93',first_activation:false,reason:'manual',reconciled:false,revision:1}],entries:[row(id1,'2026-10-29','income','0.01',bank)],reviews:[{entry_id:id1,account_id:bank,entry_date:'2026-10-29',direction:'income',amount:'0.01',category_id:category,classification:'operating'}]});
  ({payload}=await route(huge));assert.equal(payload.days.find(d=>d.date==='2026-10-29').balance,'90071992547409.94');
});
test('calendar month bounds and historical edits recalculate from snapshots',async()=>{
  const data=fixture();let {payload,status}=await route(data,'1899-01');assert.equal(status,400);
  ({payload}=await route(data));assert.equal(payload.days.find(d=>d.date==='2026-10-29').balance,'117.00');
  data.entries[0].amount='11.00';data.reviews[0].amount='11.00';
  ({payload}=await route(data));assert.equal(payload.days.find(d=>d.date==='2026-10-29').balance,'116.00');
});
test('future first activation and reset crossing year boundary never double count',async()=>{
  const data=fixture();
  data.baselines[1].effective_date='2027-01-01';data.baselines[1].amount='50.00';
  data.entries=[row(id1,'2026-10-29','expense','10.00',bank),row(id2,'2027-01-01','income','3.00',cash)];
  data.reviews=data.entries.map(e=>({...e,entry_id:e.id,account_id:e.account_id,classification:'operating'}));
  let {payload}=await route(data,'2027-01');
  assert.equal(payload.current.balance,'100.00');
  assert.equal(payload.days.find(d=>d.date==='2027-01-01').balance,'143.00');
  assert.deepEqual(payload.days.find(d=>d.date==='2027-01-01').accounts.map(a=>a.balance),['90.00','53.00']);
  data.baselines.push({account_id:bank,effective_date:'2027-01-02',amount:'120.00',first_activation:false,reason:'explicit scenario',reconciled:false,revision:1});
  ({payload}=await route(data,'2027-01'));
  const next=payload.days.find(d=>d.date==='2027-01-02');
  assert.equal(next.balance,null);assert.equal(next.conditionalBalance,'173.00');
  assert.equal(next.accounts[0].resetDelta,'30.00');
});
test('linked legacy legs count once, reviewed NULL-account allocation and stale review fail closed',async()=>{
  const data=fixture();
  data.entries=[row(id1,'2026-10-28','expense','7.00',bank),row(id2,'2026-10-28','income','7.00',null)];
  data.reviews=[{entry_id:id1,account_id:bank,entry_date:'2026-10-28',category_id:category,direction:'expense',amount:'7.00',classification:'transfer'},
    {entry_id:id2,account_id:cash,entry_date:'2026-10-28',category_id:category,direction:'income',amount:'7.00',classification:'transfer'}];
  data.baselines[1].effective_date='2026-10-28';data.baselines[1].first_activation=false;
  data.pairs=[{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',expense_entry_id:id1,income_entry_id:id2}];
  let {payload}=await route(data);
  assert.equal(payload.current.balance,'125.00');
  assert.equal(payload.current.movement,'0.00');
  assert.deepEqual(payload.current.accounts.map(a=>a.balance),['93.00','32.00']);
  data.entries[1].amount='8.00';
  ({payload}=await route(data));
  assert.equal(payload.current.balance,null);
  assert.ok(payload.current.reasons.includes('transfer_review_invalid'));
});
test('authenticated standalone transfer mutation routes touch one transfer row, never entries',async()=>{
  const routes=new Map(),app={get(){},put(){},post(p,_auth,h){routes.set('POST '+p,h)},patch(p,_auth,h){routes.set('PATCH '+p,h)},delete(p,_auth,h){routes.set('DELETE '+p,h)}};
  const calls=[],pool={async query(sql,args){calls.push({sql,args});return sql.startsWith('DELETE')?{rowCount:1,rows:[]}:{rowCount:1,rows:[{id:id1,transfer_date:'2026-10-29',amount:'7.00'}]}}};
  const uuid=x=>typeof x==='string'&&/^[0-9a-f-]{36}$/.test(x);
  new Function('app','auth','pool','hash','uuid','validDate','safeName','validAmount','randomUUID',code)(app,()=>{},pool,hash,uuid,x=>/^2026-10-\d\d$/.test(x),()=>true,x=>typeof x==='string'&&/^\d+(\.\d{1,2})?$/.test(x)&&x!=='0',()=>id1);
  const body={date:'2026-10-29',sourceAccountId:bank,targetAccountId:cash,amount:'7.00'},request={params:{id:id1},body,userId:user};
  const reply=()=>({code:200,payload:null,status(n){this.code=n;return this},json(x){this.payload=x;return this},end(){return this}});
  for(const [verb,expected] of [['POST',201],['PATCH',200],['DELETE',204]]){
    const response=reply();await routes.get(verb+' '+(verb==='POST'?'/api/transfers':'/api/transfers/:id'))(request,response,e=>{throw e});assert.equal(response.code,expected);
  }
  assert.equal(calls.length,3);
  assert.ok(calls.every(({sql})=>sql.includes('internal_transfers')&&!sql.includes(' entries ')));
  assert.deepEqual(calls[0].args.slice(1,5),['2026-10-29',bank,cash,'7.00']);
});

// Real PostgreSQL contract probe is intentionally gated: NEVER point at a retained DB.
// All DDL runs in one transaction and ROLLBACK removes the test-owned schema.
const pgUrl=process.env.CFIN_ISSUE4_TEST_PG_URL;
const allowedPg=(()=>{try{const url=new URL(pgUrl);return process.env.CFIN_ISSUE4_PG_APPROVED==='yes'&&['127.0.0.1','localhost'].includes(url.hostname)&&url.pathname==='/cfin_issue4_disposable'&&['postgres:','postgresql:'].includes(url.protocol)}catch{return false}})();
test('disposable PostgreSQL: fresh init + additive migration replay + exact NUMERIC', {skip:!allowedPg},async()=>{
  const {Client}=require('pg');
  const client=new Client({connectionString:pgUrl});
  await client.connect();
  const schema='issue4_'+require('node:crypto').randomBytes(8).toString('hex');
  try{
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET LOCAL search_path TO ${schema}`);
    await client.query(readFileSync(join(__dirname,'../../db/init.sql'),'utf8'));
    const migration=readFileSync(join(__dirname,'../../db/migrations/002_financial_core.sql'),'utf8');
    await client.query(migration);
    await client.query(migration);
    const {rows}=await client.query("SELECT (90071992547409.93::numeric + 0.01::numeric)::text AS exact");
    assert.equal(rows[0].exact,'90071992547409.94');
  }finally{await client.query('ROLLBACK');await client.end()}
});
