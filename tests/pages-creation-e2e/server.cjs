// Isolated loopback fixture: real Page router, session/CSRF middleware, Prisma and PostgreSQL.
// This file is a test server only and is never imported by the application.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const {createRequire}=require('node:module');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'../..'),server=path.join(root,'server');
const requireServer=createRequire(server+'/package.json');
const evidence='D:/socialinsight-20261006/.ai-company/memory/tasks/SI-PAGE-CREATION-IMPLEMENTATION-20261024';
const native='D:/socialinsight-20261006/.ai-company/memory/tasks/SI-CREATE-TWO-STEPS-20260906/local-postgres/node_modules/@embedded-postgres/windows-x64/native/bin';
const pgRequire=createRequire('D:/socialinsight-20261006/.ai-company/memory/tasks/SI-CREATE-TWO-STEPS-20260906/local-postgres/package.json');
const run=path.join(evidence,'database-'+crypto.randomUUID()),data=path.join(run,'data');
fs.mkdirSync(run,{recursive:true});
const port=57687,origin='http://127.0.0.1:4193';
let started=false,db,http,vite,stopping=false;
const receipt={environment:'ISOLATED_LOOPBACK_REAL_ROUTER_COOKIE_SESSION_CSRF_PRISMA_POSTGRES',data,port,startedAt:new Date().toISOString(),databaseRole:'postgres superuser; restricted-role RLS is not claimed'};
function command(name,args,cwd=run){const result=cp.spawnSync(process.execPath,args,{cwd,env:process.env,encoding:'utf8',windowsHide:true,timeout:120000});fs.writeFileSync(path.join(run,name+'.log'),(result.stdout||'')+(result.stderr||''));if(result.status!==0)throw new Error(name+' failed; see isolated fixture log');}
function nativeCommand(name,args){const result=cp.spawnSync(path.join(native,name+'.exe'),args,{cwd:run,env:process.env,encoding:'utf8',stdio:name==='pg_ctl'?'ignore':'pipe',windowsHide:true,timeout:60000});fs.writeFileSync(path.join(run,name+'.log'),(result.stdout||'')+(result.stderr||''));if(result.status!==0)throw new Error(name+' failed; see isolated fixture log');}
async function stop(){if(stopping)return;stopping=true;try{if(http)await new Promise(r=>http.close(r));if(vite)await vite.close();if(db)await db.$disconnect();if(started){nativeCommand('pg_ctl',['-D',data,'-w','-t','30','-m','fast','stop']);receipt.cleanup='OWN_CLUSTER_STOPPED_DATA_RETAINED';}}finally{receipt.endedAt=new Date().toISOString();fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(receipt,null,2));}}
async function main(){
  // Always allocate a fresh directory and override every DB target before importing Prisma.
  nativeCommand('initdb',['-D',data,'-U','postgres','--encoding=UTF8','--locale=C','--auth=trust','--no-sync']);
  fs.appendFileSync(path.join(data,'postgresql.conf'),`\nlisten_addresses='127.0.0.1'\nport=${port}\n`);
  nativeCommand('pg_ctl',['-D',data,'-l',path.join(run,'postgres.log'),'-w','-t','30','start']);started=true;
  const {Client}=pgRequire('pg'),pg=new Client({host:'127.0.0.1',port,user:'postgres',database:'postgres'});
  await pg.connect();const identity=(await pg.query("select current_setting('data_directory') as data,inet_server_port() as port")).rows[0];
  if(path.resolve(identity.data)!==path.resolve(data)||identity.port!==port)throw new Error('Local DB identity mismatch');
  await pg.query('CREATE ROLE anon NOLOGIN');await pg.query('CREATE ROLE authenticated NOLOGIN');await pg.end();
  Object.assign(process.env,{DATABASE_URL:`postgresql://postgres@127.0.0.1:${port}/postgres`,DIRECT_URL:`postgresql://postgres@127.0.0.1:${port}/postgres`,NODE_ENV:'test',PAGES_ENABLED:'true',AUTH_COOKIE_SECURE:'false',AUTH_ALLOWED_ORIGINS:origin,CLIENT_URL:origin,AUTH_SESSION_HASH_SECRET:crypto.randomBytes(32).toString('hex'),PAGES_RLS_CONTEXT_KEY_ID:'local_e2e',PAGES_RLS_CONTEXT_SIGNING_KEY:crypto.randomBytes(32).toString('hex'),SUPABASE_URL:'http://127.0.0.1:4193',SUPABASE_SERVICE_ROLE_KEY:'isolated-test-no-provider-key',DISABLE_BACKGROUND_JOBS:'true'});
  command('migrations',[path.join(server,'node_modules/prisma/build/index.js'),'migrate','deploy'],server);
  command('context-key',[path.join(server,'dist/scripts/provisionPagesRlsContext.js')],server);
  receipt.contextKeyProvisioned=true;
  db=requireServer('./dist/prisma.js').default;
  const express=requireServer('express'),app=express();app.use(express.json());
  const sessions=requireServer('./dist/services/sessionService.js');
  app.get('/__test/ready',(_req,res)=>res.json({ready:true}));
  app.post('/__test/shutdown',(_req,res)=>{res.json({stopping:true,receiptPath:path.join(run,'receipt.json')});setImmediate(()=>stop().finally(()=>process.exit()));});
  app.get('/__test/session',async(req,res,next)=>{try{
    const existing=await sessions.resolveSession(req);
    const user=existing?await db.user.findUniqueOrThrow({where:{id:existing.userId}}):await db.user.create({data:{name:'Page Test',handle:'qa_'+crypto.randomBytes(8).toString('hex'),email:'qa_'+crypto.randomBytes(8).toString('hex')+'@example.test',emailVerifiedAt:new Date(),status:'ACTIVE'}});
    const csrfToken=existing?sessions.readCookies(req)[sessions.CSRF_COOKIE_NAME]:(await sessions.createSession(user.id,res,req)).csrfToken;
    res.json({user:{id:user.id,name:user.name,handle:user.handle},csrfToken});
  }catch(error){next(error);}});
  app.get('/__test/state/:id',async(req,res)=>{const session=await sessions.resolveSession(req);if(!session)return res.sendStatus(401);const page=await db.page.findFirst({where:{id:req.params.id,ownerId:session.userId}});res.json({page,count:await db.page.count({where:{ownerId:session.userId}})});});
  app.use('/api/pages',requireServer('./dist/pages/pageRoutes.js').default);
  app.use((error,_req,res,_next)=>{console.error('Local fixture request failed:',error.code||error.name);res.status(500).json({code:'TEST_SERVER_ERROR'});});
  const {createServer}=await import(pathToFileURL(path.join(root,'node_modules/vite/dist/node/index.js')).href);
  vite=await createServer({root,configFile:false,optimizeDeps:{entries:['tests/pages-creation-e2e/index.html']},server:{middlewareMode:true},appType:'custom'});
  app.use(vite.middlewares);
  app.use(async(req,res,next)=>{try{res.type('html').send(await vite.transformIndexHtml(req.url,fs.readFileSync(path.join(__dirname,'index.html'),'utf8')));}catch(error){next(error);}});
  http=app.listen(4193,'127.0.0.1',()=>console.log('Isolated Pages E2E ready'));
  receipt.readyAt=new Date().toISOString();fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(receipt,null,2));
}
process.on('SIGINT',()=>stop().finally(()=>process.exit()));process.on('SIGTERM',()=>stop().finally(()=>process.exit()));
main().catch(async error=>{if(fs.existsSync(path.join(data,'postmaster.pid')))started=true;receipt.failure=error.message;console.error(error.message);await stop();process.exit(1);});
