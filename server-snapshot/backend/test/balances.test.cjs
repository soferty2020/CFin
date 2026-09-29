const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const ts = require('typescript');

test('SQLite characterization: balances arithmetic and structure, not PostgreSQL numeric serialization', async () => {
  const source = readFileSync(join(__dirname, '../src/index.ts'), 'utf8');
  const file = ts.createSourceFile('index.ts', source, ts.ScriptTarget.ES2022, true);
  const routes = [];
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && node.expression.expression.getText(file) === 'app'
        && node.expression.name.text === 'get'
        && ts.isStringLiteral(node.arguments[0])
        && node.arguments[0].text === '/api/balances') {
      routes.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.equal(routes.length, 1, 'exactly one balances route must exist');

  let handler;
  const app = {get(path, _auth, callback) {
    assert.equal(path, '/api/balances');
    handler = callback;
  }};
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT, kind TEXT,
    opening_balance TEXT, is_active INTEGER, sort_order INTEGER);
    CREATE TABLE entries (account_id TEXT, direction TEXT, amount INTEGER);`);
  const account = db.prepare('INSERT INTO accounts VALUES (?, ?, ?, ?, ?, ?)');
  account.run('bank', 'Bank', 'bank', '1000.00', 1, 1);
  account.run('cash', 'Cash', 'cash', '50.00', 1, 2);
  account.run('unused', 'Unused', 'cash', '80.00', 1, 3);
  const entry = db.prepare('INSERT INTO entries VALUES (?, ?, ?)');
  entry.run('bank', 'income', 40);
  entry.run('bank', 'expense', 14);
  entry.run('cash', 'expense', 13);
  const pool = {async query(sql) {
    const openingCast = 'a.opening_balance::text';
    const balanceCast = "COALESCE(SUM(CASE WHEN e.direction='income' THEN e.amount WHEN e.direction='expense' THEN -e.amount END),0)::text AS balance";
    assert.ok(sql.includes(openingCast), 'expected opening_balance cast');
    assert.ok(sql.includes(balanceCast), 'expected balance cast at the aggregate');
    assert.deepEqual([...sql.matchAll(/::text/g)].map(match => match.index), [
      sql.indexOf(openingCast) + openingCast.indexOf('::text'),
      sql.indexOf(balanceCast) + balanceCast.indexOf('::text'),
    ], 'only the two expected casts are supported');
    // SQLite executes the route SELECT/JOIN/SUM; adapt only these verified casts
    // and the pg text boundary, not PostgreSQL numeric formatting or semantics.
    const sqliteSql = sql.replace(openingCast, 'a.opening_balance')
      .replace(balanceCast, balanceCast.replace('::text', ''));
    const rows = db.prepare(sqliteSql).all()
      .map(row => ({...row, balance: String(row.balance)}));
    return {rows};
  }};
  const javascript = ts.transpileModule(routes[0].getText(file), {
    compilerOptions: {target: ts.ScriptTarget.ES2022},
  }).outputText;
  new Function('app', 'auth', 'pool', javascript)(app, () => {}, pool);

  let response;
  try {
    await handler({}, {json(body) { response = body; }}, error => { throw error; });
    assert.deepEqual(response.accounts.map(({opening_balance}) => opening_balance),
      ['1000.00', '50.00', '80.00']);
    assert.deepEqual(response.accounts.map(({opening_balance, balance, ...account}) => ({
      ...account, balance: Number(balance),
    })), [
      {id: 'bank', name: 'Bank', kind: 'bank', is_active: 1, balance: 26},
      {id: 'cash', name: 'Cash', kind: 'cash', is_active: 1, balance: -13},
      {id: 'unused', name: 'Unused', kind: 'cash', is_active: 1, balance: 0},
    ]);
    assert.equal(Number(response.total), 13);
  } finally {
    db.close();
  }
});
