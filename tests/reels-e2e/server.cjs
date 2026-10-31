// Isolated loopback fixture: real Page router, session/CSRF middleware, Prisma and PostgreSQL.
// This file is a test server only and is never imported by the application.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const {createRequire}=require('node:module');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'../..'),server=path.join(root,'server');
const requireServer=createRequire(server+'/package.json');
const evidence=path.join(root,'tests/reels-e2e/artifacts');
const native=process.env.REELS_TEST_PG_BIN||'D:/socialinsight-20261006/.ai-company/memory/tasks/SI-CREATE-TWO-STEPS-20260906/local-postgres/node_modules/@embedded-postgres/windows-x64/native/bin';
const pgRequire=createRequire(path.join(process.env.REELS_TEST_PG_PACKAGE||'D:/socialinsight-20261006/.ai-company/memory/tasks/SI-CREATE-TWO-STEPS-20260906/local-postgres','package.json'));
const run=path.join(evidence,'database-'+crypto.randomUUID()),data=path.join(run,'data');
fs.mkdirSync(run,{recursive:true});
const port=57689,origin='http://127.0.0.1:4196';
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
  Object.assign(process.env,{DATABASE_URL:`postgresql://postgres@127.0.0.1:${port}/postgres`,DIRECT_URL:`postgresql://postgres@127.0.0.1:${port}/postgres`,NODE_ENV:'test',PAGES_ENABLED:'true',REELS_ENABLED:'true',STREAM_ACCOUNT_ID:'local',STREAM_API_TOKEN:'local',STREAM_SIGNING_KEY_ID:'local',STREAM_SIGNING_KEY_PEM:'local',STREAM_CUSTOMER_CODE:'local',STREAM_WEBHOOK_SECRET:'local-test-secret',AUTH_COOKIE_SECURE:'false',AUTH_ALLOWED_ORIGINS:origin,CLIENT_URL:origin,AUTH_SESSION_HASH_SECRET:crypto.randomBytes(32).toString('hex'),PAGES_RLS_CONTEXT_KEY_ID:'local_e2e',PAGES_RLS_CONTEXT_SIGNING_KEY:crypto.randomBytes(32).toString('hex'),SUPABASE_URL:'http://127.0.0.1:4196',SUPABASE_SERVICE_ROLE_KEY:'isolated-test-no-provider-key',DISABLE_BACKGROUND_JOBS:'true'});
  command('migrations',[path.join(server,'node_modules/prisma/build/index.js'),'migrate','deploy'],server);
  const checks=new Client({host:'127.0.0.1',port,user:'postgres',database:'postgres'});await checks.connect();
  const privileges=(await checks.query(`SELECT has_table_privilege('anon','"VideoAsset"','SELECT') AS anon,has_table_privilege('authenticated','"VideoAsset"','SELECT') AS authenticated,has_table_privilege('socialinsight_runtime','"VideoAsset"','SELECT,INSERT,UPDATE,DELETE') AS runtime`)).rows[0];
  if(privileges.anon||privileges.authenticated||!privileges.runtime)throw new Error('VideoAsset role grant regression');
  await checks.query('SET ROLE socialinsight_runtime');await checks.query('SELECT count(*) FROM "VideoAsset"');await checks.query('RESET ROLE');
  receipt.videoRoleChecks={...privileges,runtimeRead:true};await checks.end();
  command('context-key',[path.join(server,'dist/scripts/provisionPagesRlsContext.js')],server);
  receipt.contextKeyProvisioned=true;
  db=requireServer('./dist/prisma.js').default;
  const express=requireServer('express'),app=express();
  const videoProvider=requireServer('./dist/reels/streamProvider.js');
  const videos=new Map();
  videoProvider.streamProvider.createUpload=async(bytes,creator)=>{const id=crypto.randomBytes(16).toString('hex');videos.set(id,{bytes,creator,offset:0,chunks:[]});return {providerId:id,uploadUrl:origin+'/__test/tus/'+id};};
  videoProvider.streamProvider.inspect=async id=>{const video=videos.get(id);return {uid:id,creator:video.creator,requireSignedURLs:true,readyToStream:video.offset===video.bytes,status:{state:video.offset===video.bytes?'ready':'inprogress'},duration:2,input:{width:360,height:640}};};
  videoProvider.streamProvider.remove=async id=>{videos.delete(id);};
  videoProvider.streamProvider.findUpload=async creator=>[...videos].filter(([,v])=>v.creator===creator).map(([uid])=>({uid,creator}));
  videoProvider.streamProvider.playback=id=>({hls:origin+'/__test/video/'+id,format:'progressive',poster:'',expiresAt:Date.now()+300000});
  app.head('/__test/tus/:id',(req,res)=>{const video=videos.get(req.params.id);if(!video)return res.sendStatus(404);res.set({'Tus-Resumable':'1.0.0','Upload-Offset':String(video.offset),'Upload-Length':String(video.bytes)}).status(200).end();});
  app.patch('/__test/tus/:id',express.raw({type:'application/offset+octet-stream',limit:'151mb'}),(req,res)=>{const video=videos.get(req.params.id);if(!video)return res.sendStatus(404);if(Number(req.get('Upload-Offset'))!==video.offset)return res.sendStatus(409);video.chunks.push(req.body);video.offset+=req.body.length;res.set({'Tus-Resumable':'1.0.0','Upload-Offset':String(video.offset)}).status(204).end();});
  app.get('/__test/video/:id',(req,res)=>{const video=videos.get(req.params.id);if(!video)return res.sendStatus(404);res.type('video/webm').send(Buffer.concat(video.chunks));});
  app.post('/api/reels/webhook',express.raw({type:'application/json'}),requireServer('./dist/reels/reelRoutes.js').streamWebhook);
  app.use(express.json());
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
  app.use('/api/reels',requireServer('./dist/reels/reelRoutes.js').default);
  app.use('/api/posts',requireServer('./dist/routes/postRoutes.js').default);
  app.get('/api/users/me/groups',(_req,res)=>res.json([]));
  app.get('/api/users/search',(_req,res)=>res.json([]));
  app.get('/__test/database/:id',async(req,res)=>{const session=await sessions.resolveSession(req);if(!session)return res.sendStatus(401);const post=await db.post.findUnique({where:{id:req.params.id},include:{responses:{include:{answers:true}},videoAsset:true}});res.json({post});});
  app.post('/__test/expire/:id',async(req,res)=>{await db.post.update({where:{id:req.params.id},data:{expiresAt:new Date(Date.now()-1000)}});res.json({ok:true});});
  app.post('/__test/privacy/:id',async(req,res)=>{await db.post.update({where:{id:req.params.id},data:{targetAudience:'Followers'}});res.json({ok:true});});
  app.post('/__test/provider/:id',async(req,res)=>{await db.videoAsset.update({where:{id:req.params.id},data:{updatedAt:new Date(Date.now()-10000)}});res.json({ok:true});});
  app.use('/api/pages',requireServer('./dist/pages/pageRoutes.js').default);
  app.use((error,_req,res,_next)=>{console.error('Local fixture request failed:',error.code||error.name);res.status(500).json({code:'TEST_SERVER_ERROR'});});
  // Serve a built client, as production does. Dev compilation/HMR in the API
  // process can block transaction deadlines or reload a page during an upload.
  const {build}=await import(pathToFileURL(path.join(root,'node_modules/vite/dist/node/index.js')).href);
  const ui=path.join(run,'ui');
  await build({root,configFile:false,logLevel:'warn',build:{outDir:ui,emptyOutDir:false,rollupOptions:{input:path.join(__dirname,'index.html')}}});
  app.use(express.static(ui));
  app.use((_req,res)=>res.sendFile(path.join(ui,'tests/reels-e2e/index.html')));
  http=app.listen(4196,'127.0.0.1',()=>console.log('Isolated Reels E2E ready'));
  receipt.readyAt=new Date().toISOString();fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(receipt,null,2));
}
process.on('SIGINT',()=>stop().finally(()=>process.exit()));process.on('SIGTERM',()=>stop().finally(()=>process.exit()));
main().catch(async error=>{if(fs.existsSync(path.join(data,'postmaster.pid')))started=true;receipt.failure=error.message;console.error(error.message);await stop();process.exit(1);});
