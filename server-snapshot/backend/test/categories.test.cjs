const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {randomUUID} = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');
const ts = require('typescript');

// Execute the actual category handlers against FK-enforcing in-memory tables.
// This characterizes local route behavior, not PostgreSQL/HTTP/production.
const source = readFileSync(join(__dirname, '../src/index.ts'), 'utf8');
const file = ts.createSourceFile('index.ts', source, ts.ScriptTarget.ES2022, true);
const helpers = new Set(['uuid', 'safeName', 'directionError', 'categoryTables', 'categoryKind', 'categoryDependencies']);
const declarations = [];
const routes = [];
for (const node of file.statements) {
  if (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => helpers.has(d.name.getText(file)))) {
    declarations.push(node.getText(file));
  } else if (ts.isFunctionDeclaration(node) && helpers.has(node.name?.text)) {
    declarations.push(node.getText(file));
  } else if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
    const call = node.expression;
    if (ts.isPropertyAccessExpression(call.expression) && call.expression.expression.getText(file) === 'app'
        && ts.isStringLiteral(call.arguments[0]) && call.arguments[0].text.startsWith('/api/categories')) {
      routes.push(node.getText(file));
    }
  }
}
assert.equal(declarations.length, helpers.size, 'expected category helpers must be found');
assert.equal(routes.length, 4, 'expected category GET/POST/PATCH/DELETE routes must be found');
const javascript = ts.transpileModule([...declarations, ...routes].join('\n'), {
  compilerOptions: {target: ts.ScriptTarget.ES2022},
}).outputText;

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, sort_order INTEGER DEFAULT 0);
    CREATE TABLE subgroups (id TEXT PRIMARY KEY, name TEXT NOT NULL, group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT, sort_order INTEGER DEFAULT 0);
    CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, subgroup_id TEXT NOT NULL REFERENCES subgroups(id) ON DELETE RESTRICT, sort_order INTEGER DEFAULT 0, allow_income INTEGER NOT NULL DEFAULT 1, allow_expense INTEGER NOT NULL DEFAULT 1, CHECK(allow_income OR allow_expense));
    CREATE TABLE entries (id TEXT PRIMARY KEY, category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT, direction TEXT NOT NULL DEFAULT 'income');
    CREATE TRIGGER category_directions BEFORE UPDATE OF allow_income,allow_expense ON categories
    WHEN (NEW.allow_income=0 AND EXISTS(SELECT 1 FROM entries WHERE category_id=NEW.id AND direction='income'))
      OR (NEW.allow_expense=0 AND EXISTS(SELECT 1 FROM entries WHERE category_id=NEW.id AND direction='expense'))
    BEGIN SELECT RAISE(ABORT,'categories_entries_direction_check'); END;`);
  const handlers = new Map();
  const app = Object.fromEntries(['get', 'post', 'patch', 'delete'].map(method => [method, (path, _auth, handler) => {
    handlers.set(`${method.toUpperCase()} ${path}`, handler);
  }]));
  let beforeDelete;
  const pool = {async connect() { return {query: pool.query, release() {}}; }, async query(sql, args = []) {
    // SQLite uses positional '?' rather than PostgreSQL's $1, $2 placeholders.
    const statement = db.prepare(sql.replace(/\$\d+/g, '?').replace(/ FOR UPDATE$/, ''));
    if (beforeDelete && sql.startsWith('DELETE FROM ')) {
      const inject = beforeDelete;
      beforeDelete = undefined;
      inject(db, args);
    }
    try {
      const rows = statement.all(...(sql.includes('allow_income=$3') ? [args[0], args[2], args[3], args[1]] : args).map(value => typeof value === 'boolean' ? Number(value) : value));
      for (const row of rows) {
        if ('allow_income' in row) row.allow_income = Boolean(row.allow_income);
        if ('allow_expense' in row) row.allow_expense = Boolean(row.allow_expense);
      }
      return {rows, rowCount: rows.length};
    } catch (error) {
      // PostgreSQL reports a concurrent FK restriction as SQLSTATE 23503.
      if (error.code === 'ERR_SQLITE_ERROR' && error.message === 'FOREIGN KEY constraint failed') {
        const pgError = new Error(error.message);
        pgError.code = '23503';
        throw pgError;
      }
      if (error.message === 'categories_entries_direction_check') {
        const pgError = new Error(error.message);
        pgError.constraint = error.message;
        throw pgError;
      }
      throw error;
    }
  }};
  new Function('app', 'auth', 'pool', 'randomUUID', javascript)(app, () => {}, pool, randomUUID);
  async function request(method, path, {kind, id, body} = {}) {
    const handler = handlers.get(`${method} ${path}`);
    assert.ok(handler, `route ${method} ${path}`);
    const response = {statusCode: 200, body: undefined, ended: false,
      status(code) { this.statusCode = code; return this; },
      json(value) { this.body = value; return this; },
      end() { this.ended = true; return this; }};
    await handler({params: {kind, id}, body}, response, error => { throw error; });
    return response;
  }
  const create = (kind, name, parentId, flags = {}) => request('POST', '/api/categories/:kind', {kind, body: {name, parentId, ...flags}});
  const rename = (kind, id, name, flags = {}) => request('PATCH', '/api/categories/:kind/:id', {kind, id, body: {name, ...flags}});
  const remove = (kind, id) => request('DELETE', '/api/categories/:kind/:id', {kind, id});
  const tree = () => request('GET', '/api/categories');
  return {db, create, rename, remove, tree, onDelete(fn) { beforeDelete = fn; }};
}

async function hierarchy(f) {
  const group = (await f.create('groups', ' Group ')).body;
  const sub = (await f.create('subgroups', ' Sub ', group.id)).body;
  const cat = (await f.create('categories', ' Cat ', sub.id)).body;
  return {group, sub, cat};
}

test('characterization: create, list and rename every level preserve parent links', async () => {
  const f = fixture();
  try {
    const {group, sub, cat} = await hierarchy(f);
    assert.equal(group.name, 'Group');
    assert.equal(sub.name, 'Sub');
    assert.equal(cat.name, 'Cat');
    assert.equal(sub.group_id, group.id);
    assert.equal(cat.subgroup_id, sub.id);
    for (const [kind, id] of [['groups', group.id], ['subgroups', sub.id], ['categories', cat.id]]) {
      const response = await f.rename(kind, id, ' Renamed ');
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.name, 'Renamed');
    }
    const listed = (await f.tree()).body;
    assert.equal(listed.groups[0].name, 'Renamed');
    assert.equal(listed.subgroups[0].group_id, group.id);
    assert.equal(listed.categories[0].subgroup_id, sub.id);
    assert.equal(listed.categories[0].name, 'Renamed');
  } finally { f.db.close(); }
});

test('characterization: empty elements delete bottom-up and missing elements return 404', async () => {
  const f = fixture();
  try {
    const {group, sub, cat} = await hierarchy(f);
    for (const [kind, id] of [['categories', cat.id], ['subgroups', sub.id], ['groups', group.id]]) {
      const response = await f.remove(kind, id);
      assert.equal(response.statusCode, 204);
      assert.equal(response.ended, true);
      assert.equal((await f.remove(kind, id)).statusCode, 404);
    }
    assert.deepEqual((await f.tree()).body, {groups: [], subgroups: [], categories: []});
  } finally { f.db.close(); }
});

test('characterization: dependencies block all deletes without losing descendants or entries', async () => {
  const f = fixture();
  try {
    const {group, sub, cat} = await hierarchy(f);
    f.db.prepare('INSERT INTO entries(id,category_id) VALUES (?, ?)').run(randomUUID(), cat.id);
    for (const [kind, id, message] of [
      ['groups', group.id, 'Нельзя удалить группу, содержащую подгруппы.'],
      ['subgroups', sub.id, 'Нельзя удалить подгруппу, содержащую статьи.'],
      ['categories', cat.id, 'Нельзя удалить статью, содержащую финансовые записи.'],
    ]) {
      const response = await f.remove(kind, id);
      assert.equal(response.statusCode, 409);
      assert.equal(response.body.error, message);
    }
    const listed = (await f.tree()).body;
    assert.equal(listed.groups[0].id, group.id);
    assert.equal(listed.subgroups[0].group_id, group.id);
    assert.equal(listed.categories[0].subgroup_id, sub.id);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM entries WHERE category_id=?').get(cat.id).count, 1);
  } finally { f.db.close(); }
});

test('characterization: FK race at DELETE becomes 409 and preserves new dependent row', async () => {
  const f = fixture();
  try {
    const group = (await f.create('groups', 'Group')).body;
    f.onDelete((db, [id]) => db.prepare('INSERT INTO subgroups(id,name,group_id) VALUES(?,?,?)')
      .run(randomUUID(), 'Concurrent', id));
    const response = await f.remove('groups', group.id);
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.error, 'Удаление невозможно: у элемента есть связанные данные.');
    assert.equal((await f.tree()).body.groups[0].id, group.id);
    assert.equal((await f.tree()).body.subgroups[0].group_id, group.id);
  } finally { f.db.close(); }
});

test('characterization: invalid kind, id, name and missing parent reject without writes', async () => {
  const f = fixture();
  try {
    assert.equal((await f.create('groups', '  ')).statusCode, 400);
    assert.equal((await f.create('groups', 'x'.repeat(121))).statusCode, 400);
    assert.equal((await f.create('subgroups', 'Sub')).statusCode, 400);
    assert.equal((await f.create('categories', 'Cat', 'bad-id')).statusCode, 400);
    assert.equal((await f.create('unknown', 'Name')).statusCode, 400);
    assert.equal((await f.rename('groups', 'bad-id', 'Name')).statusCode, 400);
    assert.equal((await f.rename('groups', randomUUID(), '')).statusCode, 400);
    assert.equal((await f.remove('groups', 'bad-id')).statusCode, 400);
    assert.equal((await f.remove('unknown', randomUUID())).statusCode, 400);
    assert.deepEqual((await f.tree()).body, {groups: [], subgroups: [], categories: []});
  } finally { f.db.close(); }
});

test('directions: default both, three valid states, invalid flags and rename-only preserve settings', async () => {
  const f = fixture();
  try {
    const {sub, cat} = await hierarchy(f);
    assert.equal(cat.allow_income, true);
    assert.equal(cat.allow_expense, true);
    assert.equal((await f.create('categories', 'No', sub.id, {allow_income:false, allow_expense:false})).statusCode, 400);
    assert.equal((await f.create('categories', 'Bad', sub.id, {allow_income:'true', allow_expense:false})).statusCode, 400);
    assert.equal((await f.create('categories', 'Partial', sub.id, {allow_income:false})).statusCode, 400);
    for (const flags of [{allow_income:true, allow_expense:false}, {allow_income:false, allow_expense:true}, {allow_income:true, allow_expense:true}]) {
      const created = await f.create('categories', 'Valid', sub.id, flags);
      assert.equal(created.statusCode, 201);
      assert.equal(created.body.allow_income, flags.allow_income);
      assert.equal(created.body.allow_expense, flags.allow_expense);
      const renamed = await f.rename('categories', created.body.id, 'Renamed');
      assert.equal(renamed.body.allow_income, flags.allow_income);
      assert.equal(renamed.body.allow_expense, flags.allow_expense);
    }
    assert.equal((await f.rename('categories', cat.id, 'Cat', {allow_income:false})).statusCode, 400);
    assert.equal((await f.rename('categories', cat.id, 'Cat', {allow_income:false, allow_expense:false})).statusCode, 400);
    assert.equal((await f.tree()).body.categories.length, 4);
  } finally { f.db.close(); }
});

test('directions: linked entries block disabling without mutation; deleting last entry permits it', async () => {
  const f = fixture();
  try {
    const {cat} = await hierarchy(f);
    const entry = randomUUID();
    f.db.prepare('INSERT INTO entries(id,category_id,direction) VALUES(?,?,?)').run(entry, cat.id, 'expense');
    const flags = {allow_income:true, allow_expense:false};
    const blocked = await f.rename('categories', cat.id, 'Changed', flags);
    assert.equal(blocked.statusCode, 409);
    assert.equal((await f.tree()).body.categories[0].name, 'Cat');
    assert.equal((await f.tree()).body.categories[0].allow_expense, true);
    f.db.prepare('DELETE FROM entries WHERE id=?').run(entry);
    const updated = await f.rename('categories', cat.id, 'Changed', flags);
    assert.equal(updated.statusCode, 200);
    assert.equal(updated.body.allow_expense, false);
  } finally { f.db.close(); }
});
