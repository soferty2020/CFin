import express, {type Request, type Response, type NextFunction} from 'express';
import pg from 'pg';
import {randomUUID, randomBytes, createHash, scryptSync, timingSafeEqual} from 'node:crypto';
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL});
const app=express(); app.disable('x-powered-by'); app.use(express.json({limit:'32kb'}));
const origin=process.env.APP_ORIGIN!;
app.use((req,res,next)=>{if(['POST','PUT','PATCH','DELETE'].includes(req.method)&&req.headers.origin!==origin){res.status(403).json({error:'Недопустимый источник запроса'});return;}next();});
const hash=(x:string)=>createHash('sha256').update(x).digest('hex');
const pwHash=(pw:string)=>{const salt=randomBytes(16).toString('hex');return `${salt}:${scryptSync(pw,salt,64).toString('hex')}`};
const pwCheck=(pw:string,stored:string)=>{const [salt,hex]=stored.split(':');if(!salt||!hex)return false;const a=scryptSync(pw,salt,64),b=Buffer.from(hex,'hex');return a.length===b.length&&timingSafeEqual(a,b)};
async function bootstrap(){const login=process.env.ADMIN_LOGIN!,password=process.env.ADMIN_PASSWORD!;if(!login||!password||password.length<16)throw Error('Set ADMIN_LOGIN and ADMIN_PASSWORD (>=16 chars)');await pool.query('INSERT INTO users(id,login,password_hash,role) VALUES($1,$2,$3,$4) ON CONFLICT(login) DO NOTHING',[randomUUID(),login,pwHash(password),'admin']);}
type Authed=Request & {userId:string;role:string};
async function auth(req:Request,res:Response,next:NextFunction){try{const token=/cfin_session=([^;]+)/.exec(req.headers.cookie||'')?.[1];if(!token){res.status(401).json({error:'Требуется вход'});return;}const {rows}=await pool.query('SELECT u.id,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()',[hash(token)]);if(!rows.length){res.status(401).json({error:'Сессия истекла'});return;}(req as Authed).userId=rows[0].id;(req as Authed).role=rows[0].role;next();}catch(e){next(e)}}
app.get('/api/health',(_req,res)=>res.json({ok:true}));
app.post('/api/auth/login',async(req,res,next)=>{try{const {login,password}=req.body;if(typeof login!=='string'||typeof password!=='string'){res.status(400).json({error:'Укажите логин и пароль'});return;}const {rows}=await pool.query('SELECT * FROM users WHERE login=$1',[login]);if(!rows.length||!pwCheck(password,rows[0].password_hash)){res.status(401).json({error:'Неверный логин или пароль'});return;}const token=randomBytes(32).toString('hex');await pool.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '12 hours')",[hash(token),rows[0].id]);res.setHeader('Set-Cookie',`cfin_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`);res.json({login:rows[0].login,role:rows[0].role});}catch(e){next(e)}});
app.post('/api/auth/logout',auth,async(req,res,next)=>{try{const token=/cfin_session=([^;]+)/.exec(req.headers.cookie||'')?.[1];if(token)await pool.query('DELETE FROM sessions WHERE token_hash=$1',[hash(token)]);res.setHeader('Set-Cookie','cfin_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');res.json({ok:true});}catch(e){next(e)}});
app.get('/api/auth/me',auth,async(req,res)=>res.json({id:(req as Authed).userId,role:(req as Authed).role}));
const uuid=(x:unknown)=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const validDate=(x:unknown)=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&!Number.isNaN(Date.parse(x))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const validAmount=(x:unknown)=>typeof x==='string'&&/^\d{1,16}(\.\d{1,2})?$/.test(x)&&Number(x)>0;
const safeName=(x:unknown)=>typeof x==='string'&&x.trim().length>0&&x.trim().length<=120;
const directionError=(error:unknown)=>error instanceof Error && 'constraint' in error &&
  (error.constraint==='entries_category_direction_check' || error.constraint==='categories_entries_direction_check');
app.get('/api/categories',auth,async(_req,res,next)=>{try{const [g,s,c]=await Promise.all([pool.query('SELECT * FROM groups ORDER BY sort_order,name'),pool.query('SELECT * FROM subgroups ORDER BY sort_order,name'),pool.query('SELECT * FROM categories ORDER BY sort_order,name')]);res.json({groups:g.rows,subgroups:s.rows,categories:c.rows});}catch(e){next(e)}});
app.post('/api/categories/:kind',auth,async(req,res,next)=>{try{const {kind}=req.params,{name,parentId,allow_income=true,allow_expense=true}=req.body;if(!safeName(name)||!['groups','subgroups','categories'].includes(kind)){res.status(400).json({error:'Некорректные данные'});return;}if(kind==='categories'&&((Object.prototype.hasOwnProperty.call(req.body,'allow_income')!==Object.prototype.hasOwnProperty.call(req.body,'allow_expense'))||typeof allow_income!=='boolean'||typeof allow_expense!=='boolean'||(!allow_income&&!allow_expense))){res.status(400).json({error:'Выберите хотя бы одно направление'});return;}let q:string,args:unknown[];if(kind==='groups'){q='INSERT INTO groups(id,name) VALUES($1,$2) RETURNING *';args=[randomUUID(),name.trim()]}else if(kind==='subgroups'&&uuid(parentId)){q='INSERT INTO subgroups(id,name,group_id) VALUES($1,$2,$3) RETURNING *';args=[randomUUID(),name.trim(),parentId]}else if(kind==='categories'&&uuid(parentId)){q='INSERT INTO categories(id,name,subgroup_id,allow_income,allow_expense) VALUES($1,$2,$3,$4,$5) RETURNING *';args=[randomUUID(),name.trim(),parentId,allow_income,allow_expense]}else{res.status(400).json({error:'Выберите родительский элемент'});return;}const {rows}=await pool.query(q,args);res.status(201).json(rows[0]);}catch(e){next(e)}});
// Only these fixed table names can be interpolated into SQL.
const categoryTables = {
  groups: 'groups',
  subgroups: 'subgroups',
  categories: 'categories',
} as const;
type CategoryKind = keyof typeof categoryTables;
function categoryKind(value: string): CategoryKind | null {
  return Object.prototype.hasOwnProperty.call(categoryTables, value)
    ? value as CategoryKind
    : null;
}

app.patch('/api/categories/:kind/:id', auth, async (req, res, next) => {
  try {
    const kind = categoryKind(req.params.kind);
    const id = req.params.id;
    const name: unknown = req.body?.name;
    if (!kind || !uuid(id) || typeof name !== 'string' || !safeName(name)) {
      res.status(400).json({error: 'Некорректные данные'});
      return;
    }
    const hasIncome = Object.prototype.hasOwnProperty.call(req.body, 'allow_income');
    const hasExpense = Object.prototype.hasOwnProperty.call(req.body, 'allow_expense');
    if (kind === 'categories' && (hasIncome !== hasExpense ||
        (hasIncome && (typeof req.body.allow_income !== 'boolean' ||
          typeof req.body.allow_expense !== 'boolean' ||
          (!req.body.allow_income && !req.body.allow_expense))))) {
      res.status(400).json({error: 'Выберите хотя бы одно направление'});
      return;
    }
    if (kind !== 'categories' && (hasIncome || hasExpense)) {
      res.status(400).json({error: 'Направления доступны только для статей'});
      return;
    }
    let rows: any[];
    if (kind === 'categories' && hasIncome) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // A separate statement after the lock sees entries committed by a prior writer.
        const locked = await client.query('SELECT id FROM categories WHERE id=$1 FOR UPDATE', [id]);
        if (!locked.rowCount) {
          await client.query('ROLLBACK');
          res.status(404).json({error: 'Элемент не найден'});
          return;
        }
        const updated = await client.query(
          'UPDATE categories SET name=$1,allow_income=$3,allow_expense=$4 WHERE id=$2 RETURNING *',
          [name.trim(), id, req.body.allow_income, req.body.allow_expense]
        );
        rows = updated.rows;
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    } else {
      const result = await pool.query(`UPDATE ${categoryTables[kind]} SET name=$1 WHERE id=$2 RETURNING *`, [name.trim(), id]);
      rows = result.rows;
    }
    if (!rows.length) {
      res.status(404).json({error: 'Элемент не найден'});
      return;
    }
    res.json(rows[0]);
  } catch (error) {
    if (directionError(error)) {
      res.status(409).json({error: 'Сначала удалите все записи отключаемого направления.'});
      return;
    }
    next(error);
  }
});

const categoryDependencies: Record<CategoryKind, {table: string; column: string; message: string}> = {
  groups: {table: 'subgroups', column: 'group_id', message: 'Нельзя удалить группу, содержащую подгруппы.'},
  subgroups: {table: 'categories', column: 'subgroup_id', message: 'Нельзя удалить подгруппу, содержащую статьи.'},
  categories: {table: 'entries', column: 'category_id', message: 'Нельзя удалить статью, содержащую финансовые записи.'},
};

app.delete('/api/categories/:kind/:id', auth, async (req, res, next) => {
  try {
    const kind = categoryKind(req.params.kind);
    const id = req.params.id;
    if (!kind || !uuid(id)) {
      res.status(400).json({error: 'Некорректный элемент'});
      return;
    }
    const dependency = categoryDependencies[kind];
    const related = await pool.query(
      `SELECT 1 FROM ${dependency.table} WHERE ${dependency.column}=$1 LIMIT 1`,
      [id]
    );
    if (related.rowCount) {
      res.status(409).json({error: dependency.message});
      return;
    }
    const result = await pool.query(
      `DELETE FROM ${categoryTables[kind]} WHERE id=$1 RETURNING id`,
      [id]
    );
    if (!result.rowCount) {
      res.status(404).json({error: 'Элемент не найден'});
      return;
    }
    res.status(204).end();
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === '23503') {
      res.status(409).json({error: 'Удаление невозможно: у элемента есть связанные данные.'});
      return;
    }
    next(error);
  }
});

app.get('/api/entries',auth,async(req,res,next)=>{try{const {date,categoryId,direction}=req.query;if(!validDate(date)||!uuid(categoryId)||!['income','expense'].includes(String(direction))){res.status(400).json({error:'Некорректная ячейка'});return;}const {rows}=await pool.query('SELECT id,category_id,entry_date::text,direction,amount::text,account_id FROM entries WHERE entry_date=$1 AND category_id=$2 AND direction=$3 ORDER BY created_at,id',[date,categoryId,direction]);res.json(rows);}catch(e){next(e)}});
// Only a new, explicit account assignment can establish automatic operating provenance.
// Editing a legacy/unreviewed entry cannot certify it; manual decisions are never overwritten.
app.post('/api/entries',auth,async(req,res,next)=>{
  const {entryDate,categoryId,direction,amount,accountId}=req.body||{};
  if(!validDate(entryDate)||!uuid(categoryId)||!['income','expense'].includes(direction)||!validAmount(amount)){
    res.status(400).json({error:'Проверьте дату, статью, направление и сумму'});return;
  }
  // Legacy clients omit the account; their write must remain unreviewed.
  const acc=uuid(accountId)?accountId:null;
  let client:pg.PoolClient;try{client=await pool.connect()}catch(e){next(e);return}
  try{
    await client.query('BEGIN');
    if(acc&&!(await client.query('SELECT id FROM accounts WHERE id=$1 FOR KEY SHARE',[acc])).rowCount){await client.query('ROLLBACK');res.status(400).json({error:'Выберите существующий счёт'});return}
    const {rows}=await client.query('INSERT INTO entries(id,entry_date,category_id,direction,amount,account_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,entry_date::text,category_id,direction,amount::text,account_id',[randomUUID(),entryDate,categoryId,direction,amount,acc,(req as Authed).userId]);
    if(acc)await client.query(`INSERT INTO entry_financial_review(entry_id,account_id,entry_date,category_id,direction,amount,classification,provenance,reviewed_by)
      VALUES($1,$2,$3,$4,$5,$6,'operating','entry_write',$7)`, [rows[0].id,acc,entryDate,categoryId,direction,amount,(req as Authed).userId]);
    await client.query('COMMIT');res.status(201).json(rows[0]);
  }catch(e){await client.query('ROLLBACK').catch(()=>{});if(directionError(e)){res.status(409).json({error:'Направление не разрешено для статьи.'});return}next(e)}finally{client.release()}
});
app.patch('/api/entries/:id',auth,async(req,res,next)=>{
  const {entryDate,categoryId,direction,amount,accountId}=req.body||{};
  if(!uuid(req.params.id)||!validDate(entryDate)||!uuid(categoryId)||!['income','expense'].includes(direction)||!validAmount(amount)){
    res.status(400).json({error:'Некорректные данные'});return;
  }
  const acc=uuid(accountId)?accountId:null;
  let client:pg.PoolClient;try{client=await pool.connect()}catch(e){next(e);return}
  try{
    await client.query('BEGIN');
    const before=await client.query('SELECT id,entry_date::text,category_id,direction,amount::text,account_id FROM entries WHERE id=$1 FOR UPDATE',[req.params.id]);
    if(!before.rowCount){await client.query('ROLLBACK');res.status(404).json({error:'Запись не найдена'});return}
    const old=before.rows[0];
    const review=await client.query('SELECT account_id,entry_date::text,category_id,direction,amount::text,classification,provenance FROM entry_financial_review WHERE entry_id=$1',[req.params.id]);
    const original=review.rows[0];
    const mayRenew=acc!==null&&old.account_id!==null&&original?.provenance==='entry_write'&&original.classification==='operating'&&reviewFingerprint(old,original);
    if(acc&&!(await client.query('SELECT id FROM accounts WHERE id=$1 FOR KEY SHARE',[acc])).rowCount){await client.query('ROLLBACK');res.status(400).json({error:'Выберите существующий счёт'});return}
    const {rows}=await client.query('UPDATE entries SET entry_date=$1,category_id=$2,direction=$3,amount=$4,account_id=$5,updated_at=now() WHERE id=$6 RETURNING id,entry_date::text,category_id,direction,amount::text,account_id',[entryDate,categoryId,direction,amount,acc,req.params.id]);
    if(mayRenew){
      await client.query(`UPDATE entry_financial_review SET account_id=$2,entry_date=$3,category_id=$4,direction=$5,amount=$6,reviewed_by=$7,reviewed_at=now()
        WHERE entry_id=$1 AND provenance='entry_write'`, [req.params.id,acc,entryDate,categoryId,direction,amount,(req as Authed).userId]);
    }else if(original){
      // A changed manual/stale review is invalidated, not silently re-certified by reverting a field.
      if(!reviewFingerprint(old,original)||!reviewFingerprint(rows[0],original)||old.account_id!==acc||original.provenance==='entry_write'&&acc===null)await client.query('DELETE FROM entry_financial_review WHERE entry_id=$1',[req.params.id]);
    }
    await client.query('COMMIT');res.json(rows[0]);
  }catch(e){await client.query('ROLLBACK').catch(()=>{});if(directionError(e)){res.status(409).json({error:'Направление не разрешено для статьи.'});return}next(e)}finally{client.release()}
});
app.delete('/api/entries/:id',auth,async(req,res,next)=>{try{if(!uuid(req.params.id)){res.status(400).json({error:'Некорректный идентификатор'});return;}const r=await pool.query('DELETE FROM entries WHERE id=$1',[req.params.id]);res.status(r.rowCount?204:404).end();}catch(e){next(e)}});
app.get('/api/calendar',auth,async(req,res,next)=>{try{const month=String(req.query.month||'');if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)){res.status(400).json({error:'Формат месяца: ГГГГ-ММ'});return;}const {rows}=await pool.query("SELECT category_id,entry_date::text AS date,direction,sum(amount)::text AS amount,count(*)::int AS count FROM entries WHERE entry_date >= $1::date AND entry_date < ($1::date + interval '1 month') GROUP BY category_id,entry_date,direction ORDER BY entry_date",[month+'-01']);res.json({month,cells:rows});}catch(e){next(e)}});
app.get('/api/accounts',auth,async(_req,res,next)=>{try{const {rows}=await pool.query('SELECT id,name,kind,opening_balance::text,is_active,sort_order FROM accounts ORDER BY sort_order,name');res.json(rows);}catch(e){next(e)}});
app.post('/api/accounts',auth,async(req,res,next)=>{try{const {name,kind,openingBalance}=req.body;if(!safeName(name)||!['bank','cash'].includes(kind)){res.status(400).json({error:'Укажите название и тип счёта (bank или cash)'});return;}const ob=typeof openingBalance==='string'&&/^\d{1,16}(\.\d{1,2})?$/.test(openingBalance)?openingBalance:'0';const {rows}=await pool.query('INSERT INTO accounts(id,name,kind,opening_balance,sort_order) VALUES($1,$2,$3,$4,0) RETURNING id,name,kind,opening_balance::text,is_active,sort_order',[randomUUID(),name.trim(),kind,ob]);res.status(201).json(rows[0]);}catch(e){next(e)}});
app.patch('/api/accounts/:id',auth,async(req,res,next)=>{try{const {name,kind,openingBalance,isActive}=req.body;if(!uuid(req.params.id)){res.status(400).json({error:'Некорректный идентификатор'});return;}const sets:string[]=[];const args:unknown[]=[];let i=1;if(safeName(name)){sets.push(`name=$${i++}`);args.push(name.trim());}if(['bank','cash'].includes(kind)){sets.push(`kind=$${i++}`);args.push(kind);}if(typeof openingBalance==='string'&&/^\d{1,16}(\.\d{1,2})?$/.test(openingBalance)){sets.push(`opening_balance=$${i++}`);args.push(openingBalance);}if(typeof isActive==='boolean'){sets.push(`is_active=$${i++}`);args.push(isActive);}if(!sets.length){res.status(400).json({error:'Нет данных для обновления'});return;}args.push(req.params.id);const {rows}=await pool.query(`UPDATE accounts SET ${sets.join(',')} WHERE id=$${i} RETURNING id,name,kind,opening_balance::text,is_active,sort_order`,args);if(!rows.length){res.status(404).json({error:'Счёт не найден'});return;}res.json(rows[0]);}catch(e){next(e)}});
app.delete('/api/accounts/:id',auth,async(req,res,next)=>{try{if(!uuid(req.params.id)){res.status(400).json({error:'Некорректный идентификатор'});return;}const r=await pool.query('DELETE FROM accounts WHERE id=$1',[req.params.id]);res.status(r.rowCount?204:404).end();}catch(e){next(e)}});

app.get('/api/balances',auth,async(_req,res,next)=>{try{const {rows}=await pool.query('SELECT a.id,a.name,a.kind,a.opening_balance::text,a.is_active,COALESCE(SUM(CASE WHEN e.direction=\'income\' THEN e.amount WHEN e.direction=\'expense\' THEN -e.amount END),0)::text AS balance FROM accounts a LEFT JOIN entries e ON e.account_id=a.id GROUP BY a.id ORDER BY a.sort_order,a.name');const total=rows.reduce((s:number,r:any)=>s+Number(r.balance),0);res.json({accounts:rows,total:total.toFixed(2)});}catch(e){next(e)}});

// Financial core v1 is additive: the legacy balance endpoint above keeps its old contract.
// All arithmetic below uses integer minor units; database NUMERIC is transported as text.
const signedMoney=(value:unknown)=>typeof value==='string'&&/^-?(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(value);
function cents(value:string):bigint {
  if(!signedMoney(value))throw Error('Некорректная точность суммы');
  const negative=value.startsWith('-'),[whole,fraction='']= (negative?value.slice(1):value).split('.');
  return (negative?-1n:1n)*(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));
}
function decimal(value:bigint):string {
  const absolute=value<0n?-value:value;
  return `${value<0n?'-':''}${absolute/100n}.${String(absolute%100n).padStart(2,'0')}`;
}
const businessDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Novosibirsk',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const nextDay=(date:string)=>new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
const previousDay=(date:string)=>new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString().slice(0,10);
const reviewFingerprint=(entry:any,review:any)=>review&&entry.entry_date===review.entry_date&&entry.category_id===review.category_id&&entry.direction===review.direction&&cents(entry.amount)===cents(review.amount)&&(!entry.account_id||entry.account_id===review.account_id);

app.get('/api/daily-balances',auth,async(req,res,next)=>{
  const month=String(req.query.month||'');
  if(!/^(20\d\d|2100)-(0[1-9]|1[0-2])$/.test(month)){res.status(400).json({error:'Месяц должен быть в диапазоне 2000–2100'});return;}
  let client:pg.PoolClient;try{client=await pool.connect()}catch(e){next(e);return}
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const today=businessDate(),yesterday=previousDay(today);
    const monthEnd=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);
    const until=monthEnd>today?monthEnd:today;
    const [accountsResult,inventoryResult,baselinesResult,entriesResult,reviewsResult,transfersResult,pairsResult]=await Promise.all([
      client.query('SELECT id,name,kind,is_active FROM accounts ORDER BY sort_order,name'),
      client.query('SELECT roster_hash FROM financial_inventory WHERE id=true'),
      client.query('SELECT account_id,effective_date::text,amount::text,first_activation,reason,reconciled,revision FROM account_baselines WHERE effective_date<=$1 ORDER BY effective_date',[until]),
      client.query('SELECT id,entry_date::text,category_id,direction,amount::text,account_id FROM entries WHERE entry_date<=$1 ORDER BY entry_date,id LIMIT 10001',[until]),
      client.query('SELECT r.entry_id,r.account_id,r.entry_date::text,r.category_id,r.direction,r.amount::text,r.classification,r.provenance FROM entry_financial_review r JOIN entries e ON e.id=r.entry_id WHERE e.entry_date<=$1 LIMIT 10001',[until]),
      client.query('SELECT id,transfer_date::text,source_account_id,target_account_id,amount::text FROM internal_transfers WHERE transfer_date<=$1 ORDER BY transfer_date,id LIMIT 10001',[until]),
      client.query('SELECT p.id,p.expense_entry_id,p.income_entry_id FROM legacy_transfer_pairs p JOIN entries e ON e.id=p.expense_entry_id WHERE e.entry_date<=$1',[until])
    ]);
    if(entriesResult.rows.length>10000||reviewsResult.rows.length>10000||transfersResult.rows.length>10000||accountsResult.rows.length>1000||baselinesResult.rows.length>10000){await client.query('ROLLBACK');res.status(413).json({error:'Слишком много счетов или операций для одного снимка'});return;}
    const accounts=accountsResult.rows,baselines=baselinesResult.rows,entries=entriesResult.rows,reviews=new Map(reviewsResult.rows.map((r:any)=>[r.entry_id,r]));
    const accountIds=new Set(accounts.map((a:any)=>a.id));
    const baselineByDay=new Map(baselines.map((b:any)=>[b.account_id+'|'+b.effective_date,b]));
    const activationByAccount=new Map(baselines.filter((b:any)=>b.first_activation).map((b:any)=>[b.account_id,b]));
    const pairs=pairsResult.rows,entryById=new Map(entries.map((e:any)=>[e.id,e]));
    const globalReasons=new Set<string>();
    const rosterHash=hash(accounts.map((a:any)=>a.id).sort().join('|'));
    if(!inventoryResult.rows.length||inventoryResult.rows[0].roster_hash!==rosterHash)globalReasons.add('inventory_unattested');
    if(!accounts.length)globalReasons.add('no_accounts');
    const linked=new Set<string>(),invalidByDate=new Map<string,Set<string>>();
    const invalid=(date:string,reason:string)=>{if(!invalidByDate.has(date))invalidByDate.set(date,new Set());invalidByDate.get(date)!.add(reason)};
    for(const pair of pairs){
      const out=entryById.get(pair.expense_entry_id) as any, incoming=entryById.get(pair.income_entry_id) as any;
      const a=out&&reviews.get(out.id) as any,b=incoming&&reviews.get(incoming.id) as any;
      if(!out||!incoming||!a||!b||!reviewFingerprint(out,a)||!reviewFingerprint(incoming,b)||a.classification!=='transfer'||b.classification!=='transfer'||out.direction!=='expense'||incoming.direction!=='income'||out.entry_date!==incoming.entry_date||cents(out.amount)!==cents(incoming.amount)||a.account_id===b.account_id||linked.has(out.id)||linked.has(incoming.id))invalid(out?.entry_date||incoming?.entry_date||month+'-01','transfer_review_invalid');
      linked.add(pair.expense_entry_id);linked.add(pair.income_entry_id);
    }
    const eligible=(entry:any)=>{const review=reviews.get(entry.id) as any;return reviewFingerprint(entry,review)&&!(review.classification==='transfer'&&!linked.has(entry.id))&&!(review.classification==='operating'&&linked.has(entry.id))};
    const movements=new Map<string,bigint>();
    const add=(account:string,date:string,delta:bigint)=>{const key=account+'|'+date;movements.set(key,(movements.get(key)||0n)+delta)};
    for(const entry of entries){
      const review=reviews.get(entry.id) as any;
      const reviewed=reviewFingerprint(entry,review);
      if(!eligible(entry))invalid(entry.entry_date,'entry_unreviewed');
      const account=entry.account_id||(reviewed?review.account_id:null);
      if(!account||!accountIds.has(account))invalid(entry.entry_date,'entry_unallocated');
      else add(account,entry.entry_date,(entry.direction==='income'?1n:-1n)*cents(entry.amount));
    }
    for(const transfer of transfersResult.rows){
      add(transfer.source_account_id,transfer.transfer_date,-cents(transfer.amount));
      add(transfer.target_account_id,transfer.transfer_date,cents(transfer.amount));
    }
    const startDates=[month+'-01',yesterday,...baselines.map((b:any)=>b.effective_date),...entries.map((e:any)=>e.entry_date),...transfersResult.rows.map((t:any)=>t.transfer_date)].filter((d:string)=>d<=until);
    const start=startDates.sort()[0]||month+'-01';
    if(start<'1900-01-01'||Date.parse(until+'T00:00:00Z')-Date.parse(start+'T00:00:00Z')>3660*86400000){await client.query('ROLLBACK');res.status(413).json({error:'Диапазон истории превышает десять лет'});return;}
    const balanceByAccount=new Map<string,bigint>(),unknown=new Map<string,Set<string>>(),daily:any[]=[],hadMovement=new Set<string>();
    const unresolved=new Set<string>();
    let current:any=null,todaySnapshot:any=null,todayMovement:string|null=null;
    for(let day=start;day<=until;day=nextDay(day)){
      for(const flag of invalidByDate.get(day)||[])unresolved.add(flag);
      const reasons=new Set([...globalReasons,...unresolved]),accountDays:any[]=[];
      let candidate=0n,movement=0n;
      for(const account of accounts){
        const baseline=baselineByDay.get(account.id+'|'+day) as any;
        const activation=activationByAccount.get(account.id) as any;
        const move=movements.get(account.id+'|'+day)||0n;
        movement+=move;
        let prior=balanceByAccount.get(account.id),flags=unknown.get(account.id)||new Set<string>();
        const earlierMovement=hadMovement.has(account.id);
        if(move!==0n)hadMovement.add(account.id);
        if(activation&&day<activation.effective_date){if(move!==0n){flags.add('pre_activation_movement');unknown.set(account.id,flags);reasons.add('pre_activation_movement')}continue;}
        if(baseline){
          const value=cents(baseline.amount);
          const preActivation=flags.has('pre_activation_movement');
          if(prior!==undefined&&value!==prior&&!baseline.reconciled)flags=new Set([...flags,'reset_gap']);
          else if(baseline.reconciled||prior===undefined)flags=new Set();
          if(baseline.first_activation&&preActivation)flags.add('pre_activation_movement');
          if(prior===undefined&&earlierMovement&&!baseline.reconciled)flags.add('pre_opening_movement');
          balanceByAccount.set(account.id,value+move);unknown.set(account.id,flags);
          accountDays.push({id:account.id,name:account.name,balance:decimal(value+move),movement:decimal(move),baseline:baseline.amount,resetDelta:prior===undefined?null:decimal(value-prior),reason:baseline.reason,reconciled:baseline.reconciled,completeness:flags.size?'incomplete':'complete',reasons:[...flags]});
        }else if(prior===undefined){
          flags.add('opening_missing');unknown.set(account.id,flags);
          accountDays.push({id:account.id,name:account.name,balance:null,movement:decimal(move),completeness:'incomplete',reasons:[...flags]});
        }else{
          const balance=prior+move;balanceByAccount.set(account.id,balance);
          accountDays.push({id:account.id,name:account.name,balance:decimal(balance),movement:decimal(move),completeness:flags.size?'incomplete':'complete',reasons:[...flags]});
        }
        const value=balanceByAccount.get(account.id);if(value!==undefined)candidate+=value;
        for(const flag of flags)reasons.add(flag);
      }
      const movementComplete=!invalidByDate.get(day)?.has('entry_unallocated');
      if(day===today||day===yesterday||day.startsWith(month+'-')){
        const snapshot={date:day,kind:day<today?'current':'forecast',balance:reasons.size?null:decimal(candidate),conditionalBalance:decimal(candidate),movement:movementComplete?decimal(movement):null,movementComplete,completeness:reasons.size?'incomplete':'complete',reasons:[...reasons],accounts:accountDays};
        if(day===yesterday)current=snapshot;
        if(day===today){todaySnapshot=snapshot;todayMovement=snapshot.movement;}
        if(day.startsWith(month+'-'))daily.push(snapshot);
      }
    }
    await client.query('COMMIT');
    res.json({month,asOfDate:today,timeZone:'Asia/Novosibirsk',current,today:todaySnapshot,todayMovement,days:daily,unreviewedEntries:entries.filter((e:any)=>!eligible(e)).map((e:any)=>({id:e.id,date:e.entry_date,accountId:e.account_id,amount:e.amount,direction:e.direction})),legacyEntries:entries.map((e:any)=>({id:e.id,date:e.entry_date,accountId:e.account_id,amount:e.amount,direction:e.direction})),legacyPairs:pairs,transfers:transfersResult.rows});
  }catch(error){await client.query('ROLLBACK').catch(()=>{});next(error)}finally{client.release()}
});

app.put('/api/account-baselines/:accountId/:date',auth,async(req,res,next)=>{
  if(!uuid(req.params.accountId)||!validDate(req.params.date)||!signedMoney(req.body?.amount)||typeof req.body?.reason!=='string'||!req.body.reason.trim()||req.body.reason.trim().length>500||typeof req.body.firstActivation!=='boolean'||typeof req.body.reconciled!=='boolean'||!Number.isInteger(req.body.revision)||req.body.revision<0){res.status(400).json({error:'Проверьте дату, сумму, основание и версию'});return;}
  try{
    const args=[req.params.accountId,req.params.date,req.body.amount,req.body.firstActivation,req.body.reason.trim(),req.body.reconciled,(req as Authed).userId,req.body.revision];
    const {rows}=await pool.query(`INSERT INTO account_baselines(account_id,effective_date,amount,first_activation,reason,reconciled,attested_by)
      SELECT $1,$2,$3,$4,$5,$6,$7 WHERE $8=0
      ON CONFLICT(account_id,effective_date) DO UPDATE SET amount=$3,first_activation=$4,reason=$5,reconciled=$6,attested_by=$7,revision=account_baselines.revision+1,attested_at=now()
      WHERE account_baselines.revision=$8 RETURNING account_id,effective_date::text,amount::text,first_activation,reason,reconciled,revision`,args);
    if(!rows.length){res.status(409).json({error:'Версия изменилась; обновите данные'});return}res.json(rows[0]);
  }catch(error){next(error)}
});
app.get('/api/account-baselines',auth,async(_req,res,next)=>{try{const {rows}=await pool.query('SELECT account_id,effective_date::text,amount::text,first_activation,reason,reconciled,revision FROM account_baselines ORDER BY effective_date');res.json(rows)}catch(e){next(e)}});
app.post('/api/financial-inventory/attest',auth,async(req,res,next)=>{if(req.body?.confirmed!==true){res.status(400).json({error:'Подтвердите полный перечень счетов'});return}try{const {rows}=await pool.query('SELECT id FROM accounts ORDER BY id');if(!rows.length){res.status(409).json({error:'Нет счетов для проверки'});return}const rosterHash=hash(rows.map((r:any)=>r.id).join('|'));await pool.query('INSERT INTO financial_inventory(id,roster_hash,attested_by) VALUES(true,$1,$2) ON CONFLICT(id) DO UPDATE SET roster_hash=$1,attested_by=$2,attested_at=now()',[rosterHash,(req as Authed).userId]);res.json({attested:true})}catch(e){next(e)}});
app.post('/api/transfers',auth,async(req,res,next)=>{
  const {date,sourceAccountId,targetAccountId,amount}=req.body||{};
  if(!validDate(date)||!uuid(sourceAccountId)||!uuid(targetAccountId)||sourceAccountId===targetAccountId||!validAmount(amount)){res.status(400).json({error:'Укажите дату, разные счета и положительную сумму'});return}
  try{const {rows}=await pool.query(`INSERT INTO internal_transfers(id,transfer_date,source_account_id,target_account_id,amount,created_by)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING id,transfer_date::text,source_account_id,target_account_id,amount::text`,[randomUUID(),date,sourceAccountId,targetAccountId,amount,(req as Authed).userId]);res.status(201).json(rows[0])}catch(e){next(e)}
});
app.patch('/api/transfers/:id',auth,async(req,res,next)=>{
  const {date,sourceAccountId,targetAccountId,amount}=req.body||{};
  if(!uuid(req.params.id)||!validDate(date)||!uuid(sourceAccountId)||!uuid(targetAccountId)||sourceAccountId===targetAccountId||!validAmount(amount)){res.status(400).json({error:'Укажите дату, разные счета и положительную сумму'});return}
  try{const {rows}=await pool.query(`UPDATE internal_transfers SET transfer_date=$1,source_account_id=$2,target_account_id=$3,amount=$4 WHERE id=$5
    RETURNING id,transfer_date::text,source_account_id,target_account_id,amount::text`,[date,sourceAccountId,targetAccountId,amount,req.params.id]);if(!rows.length){res.status(404).json({error:'Перевод не найден'});return}res.json(rows[0])}catch(e){next(e)}
});
app.delete('/api/transfers/:id',auth,async(req,res,next)=>{
  if(!uuid(req.params.id)){res.status(400).json({error:'Некорректный перевод'});return}
  try{const result=await pool.query('DELETE FROM internal_transfers WHERE id=$1',[req.params.id]);res.status(result.rowCount?204:404).end()}catch(e){next(e)}
});
app.post('/api/entries/:id/review',auth,async(req,res,next)=>{
  if(!uuid(req.params.id)||!uuid(req.body?.accountId)||req.body?.classification!=='operating'){res.status(400).json({error:'Укажите счёт и подтвердите обычную операцию'});return}
  let client:pg.PoolClient;try{client=await pool.connect()}catch(e){next(e);return}try{await client.query('BEGIN');const {rows}=await client.query('SELECT id,entry_date,category_id,direction,amount,account_id FROM entries WHERE id=$1 FOR UPDATE',[req.params.id]);
    if(!rows.length){await client.query('ROLLBACK');res.status(404).json({error:'Запись не найдена'});return}
    if(rows[0].account_id&&rows[0].account_id!==req.body.accountId){await client.query('ROLLBACK');res.status(409).json({error:'Счёт исходной записи отличается'});return}
    const pair=await client.query('SELECT 1 FROM legacy_transfer_pairs WHERE expense_entry_id=$1 OR income_entry_id=$1',[req.params.id]);
    if(pair.rowCount){await client.query('ROLLBACK');res.status(409).json({error:'Сначала отмените связь перевода'});return}
    await client.query(`INSERT INTO entry_financial_review(entry_id,account_id,entry_date,category_id,direction,amount,classification,reviewed_by)
      VALUES($1,$2,$3,$4,$5,$6,'operating',$7) ON CONFLICT(entry_id) DO UPDATE SET account_id=$2,entry_date=$3,category_id=$4,direction=$5,amount=$6,classification='operating',provenance='manual_review',reviewed_by=$7,reviewed_at=now()`,[req.params.id,req.body.accountId,rows[0].entry_date,rows[0].category_id,rows[0].direction,rows[0].amount,(req as Authed).userId]);
    await client.query('COMMIT');res.json({reviewed:true})
  }catch(e){await client.query('ROLLBACK').catch(()=>{});next(e)}finally{client.release()}
});
app.post('/api/legacy-transfers',auth,async(req,res,next)=>{
  if(!uuid(req.body?.expenseEntryId)||!uuid(req.body?.incomeEntryId)||req.body.expenseEntryId===req.body.incomeEntryId||!uuid(req.body.sourceAccountId)||!uuid(req.body.targetAccountId)||req.body.sourceAccountId===req.body.targetAccountId){res.status(400).json({error:'Выберите две разные записи и счета'});return}
  let client:pg.PoolClient;try{client=await pool.connect()}catch(e){next(e);return}try{await client.query('BEGIN');
    const {rows}=await client.query('SELECT id,entry_date,category_id,direction,amount,account_id FROM entries WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[[req.body.expenseEntryId,req.body.incomeEntryId]]);
    const out=rows.find((e:any)=>e.id===req.body.expenseEntryId),incoming=rows.find((e:any)=>e.id===req.body.incomeEntryId);
    if(!out||!incoming||out.direction!=='expense'||incoming.direction!=='income'||String(out.entry_date)!==String(incoming.entry_date)||cents(out.amount)!==cents(incoming.amount)||out.account_id&&out.account_id!==req.body.sourceAccountId||incoming.account_id&&incoming.account_id!==req.body.targetAccountId){await client.query('ROLLBACK');res.status(409).json({error:'Пара должна совпадать по дате/сумме и иметь разные счета'});return}
    const conflict=await client.query('SELECT 1 FROM legacy_transfer_pairs WHERE expense_entry_id=ANY($1::uuid[]) OR income_entry_id=ANY($1::uuid[])',[[out.id,incoming.id]]);
    if(conflict.rowCount){await client.query('ROLLBACK');res.status(409).json({error:'Запись уже связана'});return}
    for(const [entry,account] of [[out,req.body.sourceAccountId],[incoming,req.body.targetAccountId]] as const)await client.query(`INSERT INTO entry_financial_review(entry_id,account_id,entry_date,category_id,direction,amount,classification,reviewed_by)
      VALUES($1,$2,$3,$4,$5,$6,'transfer',$7) ON CONFLICT(entry_id) DO UPDATE SET account_id=$2,entry_date=$3,category_id=$4,direction=$5,amount=$6,classification='transfer',provenance='manual_review',reviewed_by=$7,reviewed_at=now()`,[entry.id,account,entry.entry_date,entry.category_id,entry.direction,entry.amount,(req as Authed).userId]);
    const id=randomUUID();await client.query('INSERT INTO legacy_transfer_pairs(id,expense_entry_id,income_entry_id,reviewed_by) VALUES($1,$2,$3,$4)',[id,out.id,incoming.id,(req as Authed).userId]);await client.query('COMMIT');res.status(201).json({id})
  }catch(e){await client.query('ROLLBACK').catch(()=>{});next(e)}finally{client.release()}
});
app.delete('/api/legacy-transfers/:id',auth,async(req,res,next)=>{
  if(!uuid(req.params.id)){res.status(400).json({error:'Некорректная связь'});return}
  let client:pg.PoolClient;try{client=await pool.connect()}catch(e){next(e);return}try{await client.query('BEGIN');
    const {rows}=await client.query('SELECT expense_entry_id,income_entry_id FROM legacy_transfer_pairs WHERE id=$1 FOR UPDATE',[req.params.id]);
    if(!rows.length){await client.query('ROLLBACK');res.status(404).json({error:'Связь не найдена'});return}
    await client.query('DELETE FROM legacy_transfer_pairs WHERE id=$1',[req.params.id]);
    await client.query('DELETE FROM entry_financial_review WHERE entry_id=ANY($1::uuid[])',[[rows[0].expense_entry_id,rows[0].income_entry_id]]);
    await client.query('COMMIT');res.status(204).end();
  }catch(e){await client.query('ROLLBACK').catch(()=>{});next(e)}finally{client.release()}
});
app.use((err:unknown,_req:Request,res:Response,_next:NextFunction)=>{if(err instanceof Error&&'constraint' in err&&err.constraint==='linked_transfer_entry_guard'){res.status(409).json({error:'Сначала отмените связь проверенного перевода'});return}if(err instanceof Error&&'constraint' in err&&['account_baseline_order_guard','account_first_activation_unique'].includes(String(err.constraint))){res.status(409).json({error:'Первая активация должна предшествовать остальным остаткам по счёту'});return}console.error(err);res.status(500).json({error:'Ошибка сервера'});});
bootstrap().then(()=>app.listen(3000,'0.0.0.0',()=>console.log('CFin API ready'))).catch(e=>{console.error(e);process.exit(1)});
