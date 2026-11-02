'use strict';
// Local visual fixture only. No database, upstream requests, or persistent state.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');

const host = '127.0.0.1';
const port = Number(process.env.CFIN_MOCK_PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid CFIN_MOCK_PORT');
const dist = path.resolve(__dirname, '../dist');
// Optional ephemeral in-memory bundle; does not write generated files to the repository.
const bundle = process.env.CFIN_MOCK_BUNDLE === '1' ? (() => {
  const deps=process.env.CFIN_DEPS_NODE_MODULES;
  if(!deps||!fs.existsSync(path.join(deps,'esbuild')))throw Error('CFIN_DEPS_NODE_MODULES must point to existing frontend dependencies');
  const root=path.resolve(__dirname,'..');
  const files=require(path.join(deps,'esbuild')).buildSync({entryPoints:[path.join(root,'src/main.tsx')],absWorkingDir:root,bundle:true,write:false,outdir:path.join(root,'dist'),nodePaths:[deps],platform:'browser',format:'iife'}).outputFiles;
  return new Map(files.map(file=>['/issue4'+path.extname(file.path),file.contents]));
})() : null;
const ids = {
  group: '11111111-1111-4111-8111-111111111111',
  sub: '22222222-2222-4222-8222-222222222222',
  first: '33333333-3333-4333-8333-333333333333',
  second: '44444444-4444-4444-8444-444444444444',
  bank: '55555555-5555-4555-8555-555555555555',
  cash: '66666666-6666-4666-8666-666666666666'
};
const pad = n => String(n).padStart(2, '0');
const localDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// Optional fixed calendar date for repeatable local-only browser regression.
const fixtureToday = process.env.CFIN_MOCK_TODAY;
if (fixtureToday && (!validDateFixture(fixtureToday))) throw Error('Invalid CFIN_MOCK_TODAY');
function validDateFixture(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value; }
const today = fixtureToday ? new Date(Number(fixtureToday.slice(0,4)), Number(fixtureToday.slice(5,7))-1, Number(fixtureToday.slice(8,10))) : new Date();
const base = new Date(today.getFullYear(), today.getMonth(), 1);
const date = n => localDate(new Date(base.getFullYear(), base.getMonth(), n));
const weekendDay = [6, 7].map(n => new Date(base.getFullYear(), base.getMonth(), n)).find(d => d.getMonth() === base.getMonth() && [0, 6].includes(d.getDay())) || new Date(base.getFullYear(), base.getMonth(), 1 + (6 - base.getDay() + 7) % 7);
const weekend = localDate(weekendDay);
const adjacent = localDate(new Date(base.getFullYear(), base.getMonth() + 1, 2));
const fixtureDay = date(3);
const categories = {
  groups: [{id: ids.group, name: 'Демо-группа', sort_order: 0}],
  subgroups: [{id: ids.sub, name: 'Демо-подгруппа', group_id: ids.group, sort_order: 0}],
  categories: [{id: ids.first, name: 'Демо-статья A', subgroup_id: ids.sub, allow_income:true, allow_expense:true, sort_order: 0}, {id: ids.second, name: 'Демо-статья B', subgroup_id: ids.sub, allow_income:true, allow_expense:true, sort_order: 1}]
};
const accounts = [
  {id: ids.bank, name: 'Демо-банк', kind: 'bank', opening_balance: '1000.00', is_active: true, sort_order: 0},
  {id: ids.cash, name: 'Демо-касса', kind: 'cash', opening_balance: '250.00', is_active: true, sort_order: 1}
];
const entry = (id, entry_date, category_id, direction, amount, account_id) => ({id, entry_date, category_id, direction, amount, account_id});
const entries = [
  entry('aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa', fixtureDay, ids.first, 'income', '100.00', ids.bank),
  entry('aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa', fixtureDay, ids.first, 'income', '25.50', ids.cash),
  entry('aaaaaaa3-aaaa-4aaa-8aaa-aaaaaaaaaaaa', fixtureDay, ids.first, 'expense', '30.00', ids.bank),
  entry('aaaaaaa4-aaaa-4aaa-8aaa-aaaaaaaaaaaa', fixtureDay, ids.second, 'income', '12.00', ids.cash),
  entry('aaaaaaa5-aaaa-4aaa-8aaa-aaaaaaaaaaaa', weekend, ids.first, 'expense', '8.00', ids.cash),
  entry('aaaaaaa6-aaaa-4aaa-8aaa-aaaaaaaaaaaa', localDate(today), ids.second, 'expense', '6.00', ids.bank),
  entry('aaaaaaa7-aaaa-4aaa-8aaa-aaaaaaaaaaaa', adjacent, ids.first, 'income', '9.00', ids.bank)
];
// Synthetic financial core fixture, intentionally not a representation of real company records.
const openings=[{account_id:ids.bank,effective_date:date(1),amount:'1000.00',first_activation:false,reason:'Synthetic verified',reconciled:false,revision:1},{account_id:ids.cash,effective_date:date(1),amount:'250.00',first_activation:false,reason:'Synthetic verified',reconciled:false,revision:1}];
const reviewOf=(e,accountId,provenance)=>({accountId,provenance,entry_date:e.entry_date,category_id:e.category_id,direction:e.direction,amount:e.amount,account_id:e.account_id});
const reviewed=new Map(entries.map(e=>[e.id,reviewOf(e,e.account_id,'manual_review')]));
const matchesReview=e=>{const r=reviewed.get(e.id);return !!r&&r.entry_date===e.entry_date&&r.category_id===e.category_id&&r.direction===e.direction&&minor(r.amount)===minor(e.amount)&&r.account_id===e.account_id};
const transfers=[];
let inventoryAttested=true;
const minor=x=>{const negative=x.startsWith('-'),[a,b='']=(negative?x.slice(1):x).split('.');return (negative?-1n:1n)*(BigInt(a)*100n+BigInt(b.padEnd(2,'0')))};
const decimalMinor=x=>`${x<0n?'-':''}${(x<0n?-x:x)/100n}.${String((x<0n?-x:x)%100n).padStart(2,'0')}`;
function daily(month){
  const asOfDate=localDate(today),yesterday=localDate(new Date(today.getFullYear(),today.getMonth(),today.getDate()-1));
  const end=localDate(new Date(Number(month.slice(0,4)),Number(month.slice(5)),0)),until=end>asOfDate?end:asOfDate;
  const balance=new Map(),days=[],unresolved=new Set();let current=null,todaySnapshot=null,todayMovement=null;
  for(let d=date(1);d<=until;d=localDate(new Date(Number(d.slice(0,4)),Number(d.slice(5,7))-1,Number(d.slice(8))+1))){
    const onDate=entries.filter(e=>e.entry_date===d);if(!inventoryAttested)unresolved.add('inventory_unattested');
    if(onDate.some(e=>!matchesReview(e)))unresolved.add('entry_unreviewed');
    if(onDate.some(e=>!e.account_id&&(!matchesReview(e)||!reviewed.get(e.id).accountId)))unresolved.add('entry_unallocated');
    const reasons=[...unresolved];
    let movement=0n;
    const accountDays=accounts.map(a=>{const baseline=openings.find(b=>b.account_id===a.id&&b.effective_date===d);let value=baseline?minor(baseline.amount):balance.get(a.id);if(value===undefined){reasons.push('opening_missing');value=0n}
      const move=onDate.filter(e=>(e.account_id||(matchesReview(e)?reviewed.get(e.id).accountId:null))===a.id).reduce((n,e)=>n+(e.direction==='income'?1n:-1n)*minor(e.amount),0n)+transfers.filter(t=>t.transfer_date===d).reduce((n,t)=>n+(t.source_account_id===a.id?-minor(t.amount):t.target_account_id===a.id?minor(t.amount):0n),0n);
      movement+=move;value+=move;balance.set(a.id,value);return {id:a.id,name:a.name,balance:decimalMinor(value),movement:decimalMinor(move),reasons:[]};});
    const candidate=decimalMinor(accountDays.reduce((n,a)=>n+minor(a.balance),0n));
    const movementComplete=!onDate.some(e=>!e.account_id&&(!matchesReview(e)||!reviewed.get(e.id).accountId));
    const item={date:d,kind:d<asOfDate?'current':'forecast',balance:reasons.length?null:candidate,conditionalBalance:candidate,movement:movementComplete?decimalMinor(movement):null,movementComplete,completeness:reasons.length?'incomplete':'complete',reasons,accounts:accountDays};
    if(d===yesterday)current=item;if(d===asOfDate){todaySnapshot=item;todayMovement=item.movement;}if(d.startsWith(month+'-'))days.push(item);
  }
  const legacyEntries=entries.map(e=>({id:e.id,date:e.entry_date,accountId:e.account_id,amount:e.amount,direction:e.direction}));
  return {asOfDate,timeZone:'Asia/Novosibirsk',current,today:todaySnapshot,todayMovement,days,unreviewedEntries:legacyEntries.filter(e=>!matchesReview(entries.find(row=>row.id===e.id))),legacyEntries,legacyPairs:[],transfers};
}
const uuid = x => typeof x === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(x);
const validDate = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && !Number.isNaN(Date.parse(x)) && new Date(x + 'T00:00:00Z').toISOString().slice(0, 10) === x;
const validAmount = x => typeof x === 'string' && /^\d{1,16}(\.\d{1,2})?$/.test(x) && Number(x) > 0;
const sum = n => (n / 100).toFixed(2);
const cents = x => Math.round(Number(x) * 100);
const json = (res, status, data) => {res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});res.end(JSON.stringify(data));};
const error = (res, status, message) => json(res, status, {error: message});
const noContent = res => {res.writeHead(204);res.end();};
function aggregate(month) {
  const cells = new Map();
  for (const e of entries.filter(e => e.entry_date.startsWith(month + '-'))) {
    const key = `${e.category_id}|${e.entry_date}|${e.direction}`;
    const row = cells.get(key) || {category_id: e.category_id, date: e.entry_date, direction: e.direction, value: 0, count: 0};
    row.value += cents(e.amount);
    row.count++;
    cells.set(key, row);
  }
  return [...cells.values()].sort((a, b) => a.date.localeCompare(b.date)).map(({value, ...row}) => ({...row, amount: sum(value)}));
}
function balances() {
  const rows = accounts.map(a => ({id: a.id, name: a.name, kind: a.kind, opening_balance: a.opening_balance, is_active: a.is_active,
    balance: sum(entries.filter(e => e.account_id === a.id).reduce((n, e) => n + (e.direction === 'income' ? 1 : -1) * cents(e.amount), 0))}));
  return {accounts: rows, total: sum(rows.reduce((n, a) => n + cents(a.balance), 0))};
}
async function body(req) {
  let text = '';
  for await (const chunk of req) {text += chunk;if (text.length > 32768) throw Error('body too large');}
  return JSON.parse(text || '{}');
}
function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return error(res, 405, 'Метод не поддерживается');
  if(bundle){
    const file=pathname==='/'?Buffer.from(fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8').replace('/src/main.tsx','/issue4.js').replace('</head>','<link rel="stylesheet" href="/issue4.css"/></head>')):bundle.get(pathname)||(pathname==='/calypso-logo.png'?fs.readFileSync(path.resolve(__dirname,'../public/calypso-logo.png')):null);
    if(!file)return error(res,404,'Файл не найден');
    res.writeHead(200,{'Content-Type':pathname.endsWith('.js')?'text/javascript':pathname.endsWith('.css')?'text/css':pathname.endsWith('.png')?'image/png':'text/html','Cache-Control':'no-store'});return res.end(req.method==='HEAD'?undefined:file);
  }
  let decoded;
  try {decoded = decodeURIComponent(pathname);} catch {return error(res, 400, 'Некорректный путь');}
  if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').includes('..')) return error(res, 400, 'Некорректный путь');
  const file = path.resolve(dist, '.' + (decoded === '/' ? '/index.html' : decoded));
  if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return error(res, 404, 'Файл не найден');
  const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'};
  res.writeHead(200, {'Content-Type': (types[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8', 'Cache-Control': 'no-store'});
  if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
}
async function handle(req, res) {
  const origin = `http://${host}:${port}`;
  const url = new URL(req.url, origin);
  const p = url.pathname;
  if (!p.startsWith('/api/')) return serveStatic(req, res, p);
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.headers.origin !== origin) return error(res, 403, 'Недопустимый источник запроса');
  if (p === '/api/auth/me' && req.method === 'GET') return json(res, 200, {id: ids.group, role: 'admin'});
  if (p === '/api/auth/login' && req.method === 'POST') return json(res, 200, {login: 'demo', role: 'admin'});
  if (p === '/api/auth/logout' && req.method === 'POST') return json(res, 200, {ok: true});
  if (p === '/api/categories' && req.method === 'GET') return json(res, 200, categories);
  if (p === '/api/accounts' && req.method === 'GET') return json(res, 200, accounts);
  if (p === '/api/balances' && req.method === 'GET') return json(res, 200, balances());
  if (p === '/api/daily-balances' && req.method === 'GET') {
    const month=url.searchParams.get('month');if(!/^(20\d\d|2100)-(0[1-9]|1[0-2])$/.test(month||''))return error(res,400,'Некорректный месяц');
    return json(res,200,daily(month));
  }
  if (p === '/api/account-baselines' && req.method === 'GET')return json(res,200,openings);
  if (p === '/api/financial-inventory/attest' && req.method === 'POST'){inventoryAttested=true;return json(res,200,{attested:true})}
  const baselineMatch=/^\/api\/account-baselines\/([^/]+)\/(\d{4}-\d\d-\d\d)$/.exec(p);
  if(baselineMatch&&req.method==='PUT'){
    const data=await body(req),existing=openings.find(b=>b.account_id===baselineMatch[1]&&b.effective_date===baselineMatch[2]);
    if(!accounts.some(a=>a.id===baselineMatch[1])||!validDate(baselineMatch[2])||!/^-?(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(data.amount)||data.revision!==(existing?.revision||0))return error(res,409,'Проверьте сумму и версию');
    const row={account_id:baselineMatch[1],effective_date:baselineMatch[2],amount:data.amount,first_activation:data.firstActivation,reason:data.reason,reconciled:data.reconciled,revision:(existing?.revision||0)+1};
    if(existing)openings.splice(openings.indexOf(existing),1,row);else openings.push(row);return json(res,200,row);
  }
  if (p === '/api/transfers' && req.method === 'POST'){
    const data=await body(req);if(!validDate(data.date)||!validAmount(data.amount)||data.sourceAccountId===data.targetAccountId||!accounts.some(a=>a.id===data.sourceAccountId)||!accounts.some(a=>a.id===data.targetAccountId))return error(res,400,'Некорректный перевод');
    const transfer={id:randomUUID(),transfer_date:data.date,source_account_id:data.sourceAccountId,target_account_id:data.targetAccountId,amount:data.amount};transfers.push(transfer);return json(res,201,transfer);
  }
  const transferMatch=/^\/api\/transfers\/([^/]+)$/.exec(p);
  if(transferMatch&&['PATCH','DELETE'].includes(req.method)){
    const index=transfers.findIndex(t=>t.id===transferMatch[1]);if(index<0)return error(res,404,'Перевод не найден');
    if(req.method==='DELETE'){transfers.splice(index,1);return noContent(res)}
    const data=await body(req);if(!validDate(data.date)||!validAmount(data.amount)||data.sourceAccountId===data.targetAccountId||!accounts.some(a=>a.id===data.sourceAccountId)||!accounts.some(a=>a.id===data.targetAccountId))return error(res,400,'Некорректный перевод');
    const transfer={id:transferMatch[1],transfer_date:data.date,source_account_id:data.sourceAccountId,target_account_id:data.targetAccountId,amount:data.amount};transfers[index]=transfer;return json(res,200,transfer);
  }
  const reviewMatch=/^\/api\/entries\/([^/]+)\/review$/.exec(p);
  if(reviewMatch&&req.method==='POST'){
    const data=await body(req),entry=entries.find(e=>e.id===reviewMatch[1]);if(!entry||!accounts.some(a=>a.id===data.accountId)||entry.account_id&&entry.account_id!==data.accountId)return error(res,409,'Неверный счёт');
    reviewed.set(entry.id,reviewOf(entry,data.accountId,'manual_review'));return json(res,200,{reviewed:true});
  }
  if(p==='/api/legacy-transfers'&&req.method==='POST')return error(res,409,'В синтетическом сценарии нет проверенной пары');
  if (p === '/api/calendar' && req.method === 'GET') {
    const month = url.searchParams.get('month');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) return error(res, 400, 'Формат месяца: ГГГГ-ММ');
    return json(res, 200, {month, cells: aggregate(month)});
  }
  if (p === '/api/entries' && req.method === 'GET') {
    const date = url.searchParams.get('date'), categoryId = url.searchParams.get('categoryId'), direction = url.searchParams.get('direction');
    if (!validDate(date) || !uuid(categoryId) || !['income', 'expense'].includes(direction)) return error(res, 400, 'Некорректная ячейка');
    return json(res, 200, entries.filter(e => e.entry_date === date && e.category_id === categoryId && e.direction === direction));
  }
  const match = /^\/api\/entries\/([^/]+)$/.exec(p);
  if (p === '/api/entries' && req.method === 'POST' || match && req.method === 'PATCH') {
    if (match && !uuid(match[1])) return error(res, 400, 'Некорректные данные');
    let data;
    try {data = await body(req);} catch {return error(res, 400, 'Некорректные данные');}
    const {entryDate, categoryId, direction, amount, accountId} = data;
    if (!validDate(entryDate) || !uuid(categoryId) || !['income', 'expense'].includes(direction) || !validAmount(amount) || uuid(accountId) && !accounts.some(a=>a.id===accountId)) return error(res, 400, 'Проверьте данные');
    const index = match ? entries.findIndex(e => e.id === match[1]) : -1;
    if (match && index < 0) return error(res, 404, 'Запись не найдена');
    const acc=uuid(accountId)?accountId:null;
    const row = entry(match ? match[1] : randomUUID(), entryDate, categoryId, direction, sum(cents(amount)), acc);
    if (match){const old=entries[index],review=reviewed.get(old.id),priorMatch=matchesReview(old),renew=!!acc&&!!old.account_id&&review?.provenance==='entry_write'&&priorMatch;entries[index]=row;if(renew)reviewed.set(row.id,reviewOf(row,acc,'entry_write'));else if(review&&(!priorMatch||!matchesReview(row)||old.account_id!==acc||review.provenance==='entry_write'&&!acc))reviewed.delete(row.id);} else {entries.push(row);if(acc)reviewed.set(row.id,reviewOf(row,acc,'entry_write'));}
    return json(res, match ? 200 : 201, row);
  }
  if (match && req.method === 'DELETE') {
    if (!uuid(match[1])) return error(res, 400, 'Некорректный идентификатор');
    const index = entries.findIndex(e => e.id === match[1]);
    if (index < 0) {res.writeHead(404);return res.end();}
    entries.splice(index, 1);reviewed.delete(match[1]);
    return noContent(res);
  }
  if (p.startsWith('/api/categories') || p.startsWith('/api/accounts')) return error(res, 405, 'Изменение категорий и счетов вне сценария этого mock');
  return error(res, 404, 'Маршрут не найден');
}
const server = http.createServer((req, res) => {handle(req, res).catch(err => {console.error(err);if (!res.headersSent) error(res, 500, 'Ошибка сервера');else res.destroy();});});
server.listen(port, host, () => console.log(`Synthetic CFin mock: http://${host}:${port}/ (PID ${process.pid})`));
