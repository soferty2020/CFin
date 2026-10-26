const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const ts = require('typescript');

// Exercise the real React submit callback with state setters and an API seam;
// this is not a DOM interaction test.
const source = readFileSync(join(__dirname, '../../frontend/src/main.tsx'), 'utf8');
const file = ts.createSourceFile('main.tsx', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
const app = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'App');
assert.ok(app);
const callbacks = ['refreshCategory', 'submitModal'].map(name => {
  const statement = app.body.statements.find(node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(d => d.name.getText(file) === name));
  assert.ok(statement, `the actual ${name} callback is present`);
  return statement.getText(file);
});
const javascript = ts.transpileModule(`const cats=[];const allowIncome=true,allowExpense=true;
  const busyRequest={current:0},cellSession={current:0},modalRef={current:modal};
  ${callbacks.join('\n')}; return submitModal;`, {
  compilerOptions: {target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React},
}).outputText;

for (const type of ['create', 'rename', 'delete']) {
  test(`bugfix: ${type} category modal cannot resubmit when refresh fails after successful mutation`, async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    let modal = type === 'create' ? {type, kind: 'groups'} : {type, kind: 'groups', id, name: 'Original'};
    let modalError = '';
    let globalError = '';
    let writes = 0;
    const api = async (path, method) => {
      assert.equal(path, type === 'create' ? '/categories/groups' : `/categories/groups/${id}`);
      assert.equal(method, {create: 'POST', rename: 'PATCH', delete: 'DELETE'}[type]);
      writes++;
    };
    const load = async () => { throw Error('Не удалось обновить данные'); };
    const factory = () => new Function('modal', 'modalText', 'setModal', 'setModalError', 'setBusy',
      'api', 'load', 'setError', javascript)(modal, 'Changed', value => { modal = value; },
      value => { modalError = value; }, () => {}, api, load, value => { globalError = value; });
    await factory()();
    assert.equal(writes, 1, 'server mutation succeeded once');
    assert.equal(modal, null, 'do not leave a live submit button after success');
    assert.equal(globalError, 'Не удалось обновить данные', 'refresh failure must stay visible');
    assert.equal(modalError, '', 'mutation itself did not fail');
    await factory()();
    assert.equal(writes, 1, 'a subsequent submission cannot duplicate the mutation');
  });
}

for (const kind of ['groups', 'subgroups', 'categories']) {
  test(`characterization: ${kind} modal sends create, rename and delete through category API`, async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const parentId = '22222222-2222-4222-8222-222222222222';
    for (const type of ['create', 'rename', 'delete']) {
      let modal = type === 'create' ? {type, kind, parentId} : {type, kind, id, name: 'Old'};
      let refreshed = 0;
      const calls = [];
      const submit = new Function('modal', 'modalText', 'setModal', 'setModalError', 'setBusy',
        'api', 'load', 'setError', javascript)(modal, ' New ', value => { modal = value; },
        () => {}, () => {}, async (...args) => { calls.push(args); },
        async () => { refreshed++; }, () => {});
      await submit();
      assert.deepEqual(calls, type === 'create' ? [[`/categories/${kind}`, 'POST', kind === 'categories' ? {name: 'New', parentId, allow_income: true, allow_expense: true} : {name: 'New', parentId}]]
        : type === 'rename' ? [[`/categories/${kind}/${id}`, 'PATCH', kind === 'categories' ? {name: 'New', allow_income: true, allow_expense: true} : {name: 'New'}]]
          : [[`/categories/${kind}/${id}`, 'DELETE']]);
      assert.equal(refreshed, 1);
      assert.equal(modal, null);
    }
  });
}

test('characterization: modal validation and 409 dependency error do not close the modal', async () => {
  let modal = {type: 'rename', kind: 'categories', id: '11111111-1111-4111-8111-111111111111', name: 'Old'};
  let modalError = '';
  let writes = 0;
  const factory = text => new Function('modal', 'modalText', 'setModal', 'setModalError', 'setBusy',
    'api', 'load', 'setError', javascript)(modal, text, value => { modal = value; },
    value => { modalError = value; }, () => {}, async () => {
      writes++;
      throw Error('Нельзя удалить статью, содержащую финансовые записи.');
    }, async () => { throw Error('load must not be called'); }, () => {});
  await factory('   ')();
  assert.equal(modalError, 'Название должно содержать от 1 до 120 символов');
  assert.equal(writes, 0);
  modal = {type: 'delete', kind: 'categories', id: modal.id, name: 'Old'};
  await factory('')();
  assert.equal(writes, 1);
  assert.equal(modalError, 'Нельзя удалить статью, содержащую финансовые записи.');
  assert.equal(modal.type, 'delete');
});

test('directions: flag-only category edit persists and 409 retains modal', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  let modal = {type:'rename', kind:'categories', id, name:'Same'};
  let error = '';
  const calls = [];
  const code = javascript.replace(/const cats = \[\];\s*const allowIncome = true, allowExpense = true;/,
    `const cats=[{id:'${id}',allow_income:true,allow_expense:true}];const allowIncome=false,allowExpense=true;`);
  assert.notEqual(code, javascript, 'test seam must replace defaults');
  const invoke = api => new Function('modal', 'modalText', 'setModal', 'setModalError', 'setBusy',
    'api', 'load', 'setError', code)(modal, 'Same', value => {modal=value;},
    value => {error=value;}, () => {}, api, async () => {}, () => {});
  await invoke(async (...args) => {calls.push(args); throw Error('Сначала удалите все записи');})();
  assert.equal(modal.type,'rename');
  assert.equal(error,'Сначала удалите все записи');
  assert.deepEqual(calls[0], [`/categories/categories/${id}`, 'PATCH',
    {name:'Same',allow_income:false,allow_expense:true}]);
  await invoke(async (...args) => {calls.push(args);})();
  assert.equal(modal,null);
  assert.equal(calls.length,2);
});
