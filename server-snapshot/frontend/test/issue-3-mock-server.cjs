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
const today = new Date();
const base = new Date(today.getFullYear(), today.getMonth(), 1);
const date = n => localDate(new Date(base.getFullYear(), base.getMonth(), n));
const weekendDay = [6, 7].map(n => new Date(base.getFullYear(), base.getMonth(), n)).find(d => d.getMonth() === base.getMonth() && [0, 6].includes(d.getDay())) || new Date(base.getFullYear(), base.getMonth(), 1 + (6 - base.getDay() + 7) % 7);
const weekend = localDate(weekendDay);
const adjacent = localDate(new Date(base.getFullYear(), base.getMonth() + 1, 2));
const fixtureDay = date(3);
const categories = {
  groups: [{id: ids.group, name: 'Демо-группа', sort_order: 0}],
  subgroups: [{id: ids.sub, name: 'Демо-подгруппа', group_id: ids.group, sort_order: 0}],
  categories: [{id: ids.first, name: 'Демо-статья A', subgroup_id: ids.sub, sort_order: 0}, {id: ids.second, name: 'Демо-статья B', subgroup_id: ids.sub, sort_order: 1}]
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
    if (!validDate(entryDate) || !uuid(categoryId) || !['income', 'expense'].includes(direction) || !validAmount(amount)) return error(res, 400, match ? 'Некорректные данные' : 'Проверьте дату, статью, направление и сумму');
    const index = match ? entries.findIndex(e => e.id === match[1]) : -1;
    if (match && index < 0) return error(res, 404, 'Запись не найдена');
    const row = entry(match ? match[1] : randomUUID(), entryDate, categoryId, direction, sum(cents(amount)), uuid(accountId) ? accountId : null);
    if (match) entries[index] = row; else entries.push(row);
    return json(res, match ? 200 : 201, row);
  }
  if (match && req.method === 'DELETE') {
    if (!uuid(match[1])) return error(res, 400, 'Некорректный идентификатор');
    const index = entries.findIndex(e => e.id === match[1]);
    if (index < 0) {res.writeHead(404);return res.end();}
    entries.splice(index, 1);
    return noContent(res);
  }
  if (p.startsWith('/api/categories') || p.startsWith('/api/accounts')) return error(res, 405, 'Изменение категорий и счетов вне сценария этого mock');
  return error(res, 404, 'Маршрут не найден');
}
const server = http.createServer((req, res) => {handle(req, res).catch(err => {console.error(err);if (!res.headersSent) error(res, 500, 'Ошибка сервера');else res.destroy();});});
server.listen(port, host, () => console.log(`Synthetic CFin mock: http://${host}:${port}/ (PID ${process.pid})`));
