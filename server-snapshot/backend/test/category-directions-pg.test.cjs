const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {randomUUID} = require('node:crypto');
const pg = require('pg');
const ts = require('typescript');

test('entry POST/PATCH map database direction guard to 409 without partial writes', async () => {
  const source = readFileSync(join(__dirname, '../src/index.ts'), 'utf8');
  const file = ts.createSourceFile('index.ts', source, ts.ScriptTarget.ES2022, true);
  const nodes = file.statements.filter(node => ts.isVariableStatement(node) &&
    node.declarationList.declarations.some(d => d.name.getText(file) === 'directionError') ||
    ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) &&
    ts.isStringLiteral(node.expression.arguments[0]) &&
    ['/api/entries','/api/entries/:id'].includes(node.expression.arguments[0].text) &&
    ['app.post','app.patch'].includes(node.expression.expression.getText(file)));
  const js = ts.transpileModule(nodes.map(n=>n.getText(file)).join('\n'),
    {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const handlers = new Map();
  const app = {post:(path,_auth,fn)=>handlers.set('POST '+path,fn),
    patch:(path,_auth,fn)=>handlers.set('PATCH '+path,fn)};
  const guard = Object.assign(new Error('blocked'), {constraint:'entries_category_direction_check'});
  const pool = {async query() {throw guard;}};
  new Function('app','auth','pool','uuid','validDate','validAmount','randomUUID',js)(app,()=>{},pool,
    ()=>true,()=>true,()=>true,randomUUID);
  for (const [method,path] of [['POST','/api/entries'],['PATCH','/api/entries/:id']]) {
    const result = {code:200,status(code){this.code=code;return this;},json(body){this.body=body;}};
    await handlers.get(method+' '+path)({params:{id:randomUUID()},body:{entryDate:'2026-10-17',categoryId:randomUUID(),direction:'expense',amount:'10'},userId:randomUUID()},result,error=>{throw error;});
    assert.equal(result.code,409);
    assert.match(result.body.error,/Направление/);
  }
});

// Run only against a disposable PostgreSQL database explicitly supplied by the operator.
// Never point this at production: the test creates and drops a dedicated schema.
const url = process.env.CFIN_TEST_DATABASE_URL;
const sql = readFileSync(join(__dirname, '../../db/init.sql'), 'utf8');
const migration = readFileSync(join(__dirname, '../../db/migrations/001_category_directions.sql'), 'utf8');

// Observe the server-side lock queue, not just a query promise that may not
// have reached PostgreSQL yet. Fail boundedly if the intended race never occurs.
async function waitBlocked(observer, waiter, holder) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const {rows} = await observer.query(
      `SELECT wait_event_type, pg_blocking_pids(pid) AS blockers
       FROM pg_stat_activity WHERE pid=$1`, [waiter.processID]);
    if (rows[0]?.wait_event_type === 'Lock' && rows[0].blockers.includes(holder.processID)) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail(`backend ${waiter.processID} never blocked on ${holder.processID}`);
}

test('PostgreSQL: fresh schema, migration, guards and both concurrency orders', {skip: !url && 'CFIN_TEST_DATABASE_URL not set'}, async () => {
  const schema = 'cfin_test_' + randomUUID().replaceAll('-', '');
  const legacy = schema + '_old';
  const admin = new pg.Client({connectionString:url});
  await admin.connect();
  const clients = [];
  const make = async () => {
    const client = new pg.Client({connectionString:url});
    await client.connect();
    await client.query(`SET search_path TO ${schema}`);
    clients.push(client);
    return client;
  };
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    const a = await make(), b = await make();
    await a.query(sql);
    const uid = randomUUID(), gid = randomUUID(), sid = randomUUID(), cid = randomUUID();
    await a.query("INSERT INTO users(id,login,password_hash,role) VALUES($1,'tester','x','admin')",[uid]);
    await a.query("INSERT INTO groups(id,name) VALUES($1,'g')",[gid]);
    await a.query("INSERT INTO subgroups(id,name,group_id) VALUES($1,'s',$2)",[sid,gid]);
    await a.query("INSERT INTO categories(id,name,subgroup_id) VALUES($1,'c',$2)",[cid,sid]);
    assert.deepEqual((await a.query('SELECT allow_income,allow_expense FROM categories WHERE id=$1',[cid])).rows[0], {allow_income:true,allow_expense:true});
    await assert.rejects(a.query('UPDATE categories SET allow_income=false,allow_expense=false WHERE id=$1',[cid]), {code:'23514'});
    const entry = async (client, direction, id=randomUUID()) => client.query('INSERT INTO entries(id,category_id,entry_date,direction,amount,created_by) VALUES($1,$2,current_date,$3,10,$4)',[id,cid,direction,uid]);
    await entry(a,'expense');
    await assert.rejects(a.query('UPDATE categories SET allow_expense=false WHERE id=$1',[cid]), {constraint:'categories_entries_direction_check'});
    await a.query("DELETE FROM entries WHERE category_id=$1 AND direction='expense'",[cid]);
    await a.query('UPDATE categories SET allow_expense=false WHERE id=$1',[cid]);
    await assert.rejects(entry(a,'expense'), {constraint:'entries_category_direction_check'});
    await a.query('UPDATE categories SET allow_expense=true WHERE id=$1',[cid]);
    for (const operation of ['INSERT', 'UPDATE']) {
      for (const first of ['entry', 'category']) {
        const id = randomUUID();
        if (operation === 'UPDATE') await entry(a, 'income', id);
        const changeEntry = client => operation === 'INSERT' ? entry(client, 'expense', id) :
          client.query("UPDATE entries SET direction='expense' WHERE id=$1", [id]);
        await a.query('BEGIN');
        try {
        if (first === 'entry') {
          await changeEntry(a);
          const pending = b.query('UPDATE categories SET allow_expense=false WHERE id=$1',[cid]);
          pending.catch(() => {}); // attach a rejection handler before the lock is released
          await waitBlocked(admin, b, a);
          await a.query('COMMIT');
          await assert.rejects(pending, {constraint:'categories_entries_direction_check'});
          assert.deepEqual((await a.query('SELECT direction FROM entries WHERE id=$1',[id])).rows,
            [{direction:'expense'}]);
          assert.equal((await a.query('SELECT allow_expense FROM categories WHERE id=$1',[cid])).rows[0].allow_expense,true);
          await a.query('DELETE FROM entries WHERE id=$1',[id]);
        } else {
          await a.query('UPDATE categories SET allow_expense=false WHERE id=$1',[cid]);
          const pending = changeEntry(b);
          pending.catch(() => {});
          await waitBlocked(admin, b, a);
          await a.query('COMMIT');
          await assert.rejects(pending, {constraint:'entries_category_direction_check'});
          assert.deepEqual((await a.query('SELECT direction FROM entries WHERE id=$1',[id])).rows,
            operation === 'UPDATE' ? [{direction:'income'}] : []);
          assert.equal((await a.query('SELECT allow_expense FROM categories WHERE id=$1',[cid])).rows[0].allow_expense,false);
          if (operation === 'UPDATE') await a.query('DELETE FROM entries WHERE id=$1',[id]);
          await a.query('UPDATE categories SET allow_expense=true WHERE id=$1',[cid]);
        }
        } finally {
          // Also unblock a pending waiter if a barrier assertion fails.
          await a.query('ROLLBACK');
        }
      }
    }
    assert.equal((await a.query('SELECT count(*)::int AS n FROM entries WHERE category_id=$1',[cid])).rows[0].n,0);
    // Existing-volume migration: initialize legacy schema from pre-feature definitions.
    await admin.query(`CREATE SCHEMA ${legacy}`);
    const old = await make();
    await old.query(`SET search_path TO ${legacy}`);
    const legacySql = sql.slice(0, sql.indexOf('CREATE INDEX IF NOT EXISTS entries_category_direction_idx'))
      .replace(', allow_income boolean NOT NULL DEFAULT true, allow_expense boolean NOT NULL DEFAULT true, CONSTRAINT categories_direction_check CHECK (allow_income OR allow_expense)', '');
    await old.query(legacySql);
    const oldUser = randomUUID(), oldGroup = randomUUID(), oldSubgroup = randomUUID();
    const oldCategory = randomUUID(), oldAccount = randomUUID();
    const oldIncome = randomUUID(), oldExpense = randomUUID();
    await old.query("INSERT INTO users(id,login,password_hash,role) VALUES($1,'legacy','x','admin')",[oldUser]);
    await old.query("INSERT INTO groups(id,name) VALUES($1,'legacy group')",[oldGroup]);
    await old.query("INSERT INTO subgroups(id,name,group_id) VALUES($1,'legacy subgroup',$2)",[oldSubgroup,oldGroup]);
    await old.query("INSERT INTO categories(id,name,subgroup_id) VALUES($1,'legacy category',$2)",[oldCategory,oldSubgroup]);
    await old.query("INSERT INTO accounts(id,name,kind,opening_balance) VALUES($1,'legacy account','bank',100)",[oldAccount]);
    await old.query("INSERT INTO entries(id,category_id,entry_date,direction,amount,account_id,created_by) VALUES($1,$2,'2026-10-17','income',40,$3,$4)",[oldIncome,oldCategory,oldAccount,oldUser]);
    await old.query("INSERT INTO entries(id,category_id,entry_date,direction,amount,account_id,created_by) VALUES($1,$2,'2026-10-17','expense',15,$3,$4)",[oldExpense,oldCategory,oldAccount,oldUser]);
    const entriesQuery = 'SELECT id,category_id,entry_date::text AS day,direction,amount::text,account_id,created_by FROM entries ORDER BY id';
    const totalsQuery = `SELECT e.entry_date::text AS day,e.category_id,e.direction,
      sum(e.amount)::text AS total FROM entries e GROUP BY e.entry_date,e.category_id,e.direction ORDER BY direction`;
    const balanceQuery = `SELECT a.id,(a.opening_balance + COALESCE(sum(CASE e.direction
      WHEN 'income' THEN e.amount ELSE -e.amount END),0))::text AS balance
      FROM accounts a LEFT JOIN entries e ON e.account_id=a.id GROUP BY a.id ORDER BY a.id`;
    const beforeEntries = (await old.query(entriesQuery)).rows;
    const beforeTotals = (await old.query(totalsQuery)).rows;
    const beforeBalances = (await old.query(balanceQuery)).rows;
    assert.equal(beforeEntries.length,2);
    assert.deepEqual(beforeTotals.map(row => [row.direction,row.total]),
      [['expense','15.00'],['income','40.00']]);
    assert.deepEqual(beforeBalances,[{id:oldAccount,balance:'125.00'}]);
    await old.query(migration);
    const columns = await old.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='categories' AND column_name LIKE 'allow_%'",[legacy]);
    assert.equal(columns.rowCount,2);
    assert.deepEqual((await old.query('SELECT allow_income,allow_expense FROM categories WHERE id=$1',[oldCategory])).rows,
      [{allow_income:true,allow_expense:true}]);
    assert.deepEqual((await old.query(entriesQuery)).rows,beforeEntries);
    assert.deepEqual((await old.query(totalsQuery)).rows,beforeTotals);
    assert.deepEqual((await old.query(balanceQuery)).rows,beforeBalances);
    // The former client still creates categories without flags and renames existing ones.
    const clientCategory = randomUUID();
    await old.query("INSERT INTO categories(id,name,subgroup_id) VALUES($1,'old client',$2)",[clientCategory,oldSubgroup]);
    assert.deepEqual((await old.query('SELECT allow_income,allow_expense FROM categories WHERE id=$1',[clientCategory])).rows,
      [{allow_income:true,allow_expense:true}]);
    await old.query("UPDATE categories SET name='renamed' WHERE id=$1",[oldCategory]);
    assert.deepEqual((await old.query('SELECT allow_income,allow_expense FROM categories WHERE id=$1',[oldCategory])).rows,
      [{allow_income:true,allow_expense:true}]);
    await assert.rejects(old.query('UPDATE categories SET allow_expense=false WHERE id=$1',[oldCategory]),
      {constraint:'categories_entries_direction_check'});
    assert.deepEqual((await old.query(entriesQuery)).rows,beforeEntries);
    await old.query('DELETE FROM entries WHERE id=$1',[oldExpense]);
    await old.query('UPDATE categories SET allow_expense=false WHERE id=$1',[oldCategory]);
    assert.deepEqual((await old.query('SELECT id,direction,amount::text FROM entries WHERE category_id=$1',[oldCategory])).rows,
      [{id:oldIncome,direction:'income',amount:'40.00'}]);
    assert.deepEqual((await old.query(balanceQuery)).rows,[{id:oldAccount,balance:'140.00'}]);
    await assert.rejects(old.query("INSERT INTO entries(id,category_id,entry_date,direction,amount,created_by) VALUES($1,$2,'2026-10-17','expense',1,$3)",
      [randomUUID(),oldCategory,oldUser]), {constraint:'entries_category_direction_check'});
  } finally {
    await Promise.all(clients.map(c=>c.end()));
    await admin.query(`DROP SCHEMA IF EXISTS ${legacy} CASCADE`);
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
