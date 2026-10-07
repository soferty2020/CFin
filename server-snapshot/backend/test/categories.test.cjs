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
const helpers = new Set(['uuid', 'safeName', 'categoryTables', 'categoryKind', 'categoryDependencies']);
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
    CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, subgroup_id TEXT NOT NULL REFERENCES subgroups(id) ON DELETE RESTRICT, sort_order INTEGER DEFAULT 0);
    CREATE TABLE entries (id TEXT PRIMARY KEY, category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT);`);
  const handlers = new Map();
  const app = Object.fromEntries(['get', 'post', 'patch', 'delete'].map(method => [method, (path, _auth, handler) => {
    handlers.set(`${method.toUpperCase()} ${path}`, handler);
  }]));
  let beforeDelete;
  const pool = {async query(sql, args = []) {
    // SQLite uses positional '?' rather than PostgreSQL's $1, $2 placeholders.
    const statement = db.prepare(sql.replace(/\$\d+/g, '?'));
    if (beforeDelete && sql.startsWith('DELETE FROM ')) {
      const inject = beforeDelete;
      beforeDelete = undefined;
      inject(db, args);
    }
    try {
      const rows = statement.all(...args);
      return {rows, rowCount: rows.length};
    } catch (error) {
      // PostgreSQL reports a concurrent FK restriction as SQLSTATE 23503.
      if (error.code === 'ERR_SQLITE_ERROR' && error.message === 'FOREIGN KEY constraint failed') {
        const pgError = new Error(error.message);
        pgError.code = '23503';
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
  const create = (kind, name, parentId) => request('POST', '/api/categories/:kind', {kind, body: {name, parentId}});
  const rename = (kind, id, name) => request('PATCH', '/api/categories/:kind/:id', {kind, id, body: {name}});
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
    f.db.prepare('INSERT INTO entries VALUES (?, ?)').run(randomUUID(), cat.id);
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
