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
app.get('/api/categories',auth,async(_req,res,next)=>{try{const [g,s,c]=await Promise.all([pool.query('SELECT * FROM groups ORDER BY sort_order,name'),pool.query('SELECT * FROM subgroups ORDER BY sort_order,name'),pool.query('SELECT * FROM categories ORDER BY sort_order,name')]);res.json({groups:g.rows,subgroups:s.rows,categories:c.rows});}catch(e){next(e)}});
app.post('/api/categories/:kind',auth,async(req,res,next)=>{try{const {kind}=req.params,{name,parentId}=req.body;if(!safeName(name)||!['groups','subgroups','categories'].includes(kind)){res.status(400).json({error:'Некорректные данные'});return;}let q:string,args:unknown[];if(kind==='groups'){q='INSERT INTO groups(id,name) VALUES($1,$2) RETURNING *';args=[randomUUID(),name.trim()]}else if(kind==='subgroups'&&uuid(parentId)){q='INSERT INTO subgroups(id,name,group_id) VALUES($1,$2,$3) RETURNING *';args=[randomUUID(),name.trim(),parentId]}else if(kind==='categories'&&uuid(parentId)){q='INSERT INTO categories(id,name,subgroup_id) VALUES($1,$2,$3) RETURNING *';args=[randomUUID(),name.trim(),parentId]}else{res.status(400).json({error:'Выберите родительский элемент'});return;}const {rows}=await pool.query(q,args);res.status(201).json(rows[0]);}catch(e){next(e)}});
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
    const {rows} = await pool.query(
      `UPDATE ${categoryTables[kind]} SET name=$1 WHERE id=$2 RETURNING *`,
      [name.trim(), id]
    );
    if (!rows.length) {
      res.status(404).json({error: 'Элемент не найден'});
      return;
    }
    res.json(rows[0]);
  } catch (error) {
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
app.post('/api/entries',auth,async(req,res,next)=>{try{const {entryDate,categoryId,direction,amount,accountId}=req.body;if(!validDate(entryDate)||!uuid(categoryId)||!['income','expense'].includes(direction)||!validAmount(amount)){res.status(400).json({error:'Проверьте дату, статью, направление и сумму'});return;}const acc=uuid(accountId)?accountId:null;const {rows}=await pool.query('INSERT INTO entries(id,entry_date,category_id,direction,amount,account_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,entry_date::text,category_id,direction,amount::text,account_id',[randomUUID(),entryDate,categoryId,direction,amount,acc,(req as Authed).userId]);res.status(201).json(rows[0]);}catch(e){next(e)}});
app.patch('/api/entries/:id',auth,async(req,res,next)=>{try{const {entryDate,categoryId,direction,amount,accountId}=req.body;if(!uuid(req.params.id)||!validDate(entryDate)||!uuid(categoryId)||!['income','expense'].includes(direction)||!validAmount(amount)){res.status(400).json({error:'Некорректные данные'});return;}const acc=uuid(accountId)?accountId:null;const {rows}=await pool.query('UPDATE entries SET entry_date=$1,category_id=$2,direction=$3,amount=$4,account_id=$5,updated_at=now() WHERE id=$6 RETURNING id,entry_date::text,category_id,direction,amount::text,account_id',[entryDate,categoryId,direction,amount,acc,req.params.id]);if(!rows.length){res.status(404).json({error:'Запись не найдена'});return;}res.json(rows[0]);}catch(e){next(e)}});
app.delete('/api/entries/:id',auth,async(req,res,next)=>{try{if(!uuid(req.params.id)){res.status(400).json({error:'Некорректный идентификатор'});return;}const r=await pool.query('DELETE FROM entries WHERE id=$1',[req.params.id]);res.status(r.rowCount?204:404).end();}catch(e){next(e)}});
app.get('/api/calendar',auth,async(req,res,next)=>{try{const month=String(req.query.month||'');if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)){res.status(400).json({error:'Формат месяца: ГГГГ-ММ'});return;}const {rows}=await pool.query("SELECT category_id,entry_date::text AS date,direction,sum(amount)::text AS amount,count(*)::int AS count FROM entries WHERE entry_date >= $1::date AND entry_date < ($1::date + interval '1 month') GROUP BY category_id,entry_date,direction ORDER BY entry_date",[month+'-01']);res.json({month,cells:rows});}catch(e){next(e)}});
app.get('/api/accounts',auth,async(_req,res,next)=>{try{const {rows}=await pool.query('SELECT id,name,kind,opening_balance::text,is_active,sort_order FROM accounts ORDER BY sort_order,name');res.json(rows);}catch(e){next(e)}});
app.post('/api/accounts',auth,async(req,res,next)=>{try{const {name,kind,openingBalance}=req.body;if(!safeName(name)||!['bank','cash'].includes(kind)){res.status(400).json({error:'Укажите название и тип счёта (bank или cash)'});return;}const ob=typeof openingBalance==='string'&&/^\d{1,16}(\.\d{1,2})?$/.test(openingBalance)?openingBalance:'0';const {rows}=await pool.query('INSERT INTO accounts(id,name,kind,opening_balance,sort_order) VALUES($1,$2,$3,$4,0) RETURNING id,name,kind,opening_balance::text,is_active,sort_order',[randomUUID(),name.trim(),kind,ob]);res.status(201).json(rows[0]);}catch(e){next(e)}});
app.patch('/api/accounts/:id',auth,async(req,res,next)=>{try{const {name,kind,openingBalance,isActive}=req.body;if(!uuid(req.params.id)){res.status(400).json({error:'Некорректный идентификатор'});return;}const sets:string[]=[];const args:unknown[]=[];let i=1;if(safeName(name)){sets.push(`name=$${i++}`);args.push(name.trim());}if(['bank','cash'].includes(kind)){sets.push(`kind=$${i++}`);args.push(kind);}if(typeof openingBalance==='string'&&/^\d{1,16}(\.\d{1,2})?$/.test(openingBalance)){sets.push(`opening_balance=$${i++}`);args.push(openingBalance);}if(typeof isActive==='boolean'){sets.push(`is_active=$${i++}`);args.push(isActive);}if(!sets.length){res.status(400).json({error:'Нет данных для обновления'});return;}args.push(req.params.id);const {rows}=await pool.query(`UPDATE accounts SET ${sets.join(',')} WHERE id=$${i} RETURNING id,name,kind,opening_balance::text,is_active,sort_order`,args);if(!rows.length){res.status(404).json({error:'Счёт не найден'});return;}res.json(rows[0]);}catch(e){next(e)}});
app.delete('/api/accounts/:id',auth,async(req,res,next)=>{try{if(!uuid(req.params.id)){res.status(400).json({error:'Некорректный идентификатор'});return;}const r=await pool.query('DELETE FROM accounts WHERE id=$1',[req.params.id]);res.status(r.rowCount?204:404).end();}catch(e){next(e)}});

app.get('/api/balances',auth,async(_req,res,next)=>{try{const {rows}=await pool.query('SELECT a.id,a.name,a.kind,a.opening_balance::text,a.is_active,COALESCE(SUM(CASE WHEN e.direction=\'income\' THEN e.amount WHEN e.direction=\'expense\' THEN -e.amount END),0)::text AS balance FROM accounts a LEFT JOIN entries e ON e.account_id=a.id GROUP BY a.id ORDER BY a.sort_order,a.name');const total=rows.reduce((s:number,r:any)=>s+Number(r.balance),0);res.json({accounts:rows,total:total.toFixed(2)});}catch(e){next(e)}});
app.use((err:unknown,_req:Request,res:Response,_next:NextFunction)=>{console.error(err);res.status(500).json({error:'Ошибка сервера'});});
bootstrap().then(()=>app.listen(3000,'0.0.0.0',()=>console.log('CFin API ready'))).catch(e=>{console.error(e);process.exit(1)});
