'use strict';
// Synthetic, short-lived Stage storage. Never point it at production credentials or data.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http'),crypto=require('node:crypto');
const NAME='si-pages-qa-media-20260926',WEB='https://si-pages-qa-web-20260926.onrender.com';
if(process.env.RENDER_SERVICE_NAME!==NAME||process.env.STAGE_ONLY!=='true'||process.env.STAGE_WEB_ORIGIN!==WEB)throw Error('STAGE_MEDIA_IDENTITY');
const secret=process.env.STAGE_MEDIA_ADMIN_KEY;
if(typeof secret!=='string'||secret.length<32)throw Error('STAGE_MEDIA_SECRET');
const base=`https://${process.env.RENDER_EXTERNAL_HOSTNAME}`;
if(base!==`https://${NAME}.onrender.com`)throw Error('STAGE_MEDIA_PUBLIC_IDENTITY');
const port=Number(process.env.PORT);if(!Number.isInteger(port)||port<=0)throw Error('STAGE_MEDIA_PORT');
const root=path.join(os.tmpdir(),'si-pages-qa-media');
const databaseUrl=process.env.DATABASE_URL;
if(databaseUrl){
 if(new URL(databaseUrl).pathname!=='/si_pages_qa'||/supabase/i.test(databaseUrl))throw Error('STAGE_MEDIA_DATABASE_IDENTITY');
}
const db=databaseUrl?new (require('../server/node_modules/@prisma/client').PrismaClient)():null;
const buckets=new Set(['media-originals','media-private','media-public']),signed=new Map();
let bytesWritten=0,uploads=0,downloads=0;
function objectPath(bucket,key){
 if(!buckets.has(bucket)||typeof key!=='string'||!key||key.length>500||key.includes('\\')||key.includes(':')||key.split('/').some(x=>!x||x==='.'||x==='..'))throw Error('BAD_OBJECT');
 const file=path.resolve(root,bucket,...key.split('/'));
 if(!file.startsWith(path.resolve(root,bucket)+path.sep))throw Error('BAD_OBJECT');
 return file;
}
function authorized(value){
 const provided=typeof value==='string'&&value.startsWith('Bearer ')?value.slice(7):'';
 const a=Buffer.from(provided),b=Buffer.from(secret);return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
function safeError(res,error){json(res,error.message==='BAD_OBJECT'?400:error.code==='ENOENT'?404:error.code==='EEXIST'?409:500,{error:'STAGE_MEDIA_OPERATION_FAILED'});}
async function body(req,max=15*1024*1024){let chunks=[],size=0;for await(const c of req){size+=c.length;if(size>max)throw Error('BODY_TOO_LARGE');chunks.push(c);}return Buffer.concat(chunks);}
async function parsed(req){return JSON.parse((await body(req,4096)).toString('utf8'));}
async function write(bucket,key,data,mime,replace){
 const file=objectPath(bucket,key);mime=mime||'application/octet-stream';
 if(db){
  if(replace)await db.$executeRaw`INSERT INTO stage_media_objects (bucket,object_key,bytes,mime) VALUES (${bucket},${key},${data},${mime}) ON CONFLICT (bucket,object_key) DO UPDATE SET bytes=EXCLUDED.bytes,mime=EXCLUDED.mime`;
  else{const rows=await db.$queryRaw`INSERT INTO stage_media_objects (bucket,object_key,bytes,mime) VALUES (${bucket},${key},${data},${mime}) ON CONFLICT (bucket,object_key) DO NOTHING RETURNING object_key`;if(!rows.length){const error=Error('EXISTS');error.code='EEXIST';throw error;}}
 }else{await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,data,{flag:replace?'w':'wx'});await fs.writeFile(file+'.meta',JSON.stringify({mime}));}
 bytesWritten+=data.length;uploads++;
}
async function read(bucket,key){
 const file=objectPath(bucket,key);let data,mime;
 if(db){const rows=await db.$queryRaw`SELECT bytes,mime FROM stage_media_objects WHERE bucket=${bucket} AND object_key=${key}`;if(!rows.length){const error=Error('MISSING');error.code='ENOENT';throw error;}data=Buffer.from(rows[0].bytes);mime=rows[0].mime;}
 else{const result=await Promise.all([fs.readFile(file),fs.readFile(file+'.meta','utf8')]);data=result[0];mime=JSON.parse(result[1]).mime;}
 downloads++;return {data,mime};
}
async function remove(bucket,key){const file=objectPath(bucket,key);if(db)await db.$executeRaw`DELETE FROM stage_media_objects WHERE bucket=${bucket} AND object_key=${key}`;else for(const target of [file,file+'.meta'])await fs.unlink(target).catch(e=>{if(e.code!=='ENOENT')throw e;});}
function cors(req,res){const origin=req.headers.origin;if(!origin)return true;if(origin!==WEB){json(res,403,{error:'ORIGIN_FORBIDDEN'});return false;}res.setHeader('Access-Control-Allow-Origin',WEB);res.setHeader('Vary','Origin');return true;}
const server=http.createServer(async(req,res)=>{
 if(!cors(req,res))return;
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Access-Control-Allow-Methods','GET,HEAD,PUT,POST,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type, x-upsert');
 if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
 let url;try{url=new URL(req.url,base);}catch{return json(res,400,{error:'BAD_URL'});}
 const parts=url.pathname.split('/').filter(Boolean);
 if(req.method==='GET'&&url.pathname==='/health')return json(res,200,{status:'ok',storage:'synthetic'});
 try{
  if(parts[0]==='admin'){
   if(!authorized(req.headers.authorization))return json(res,403,{error:'FORBIDDEN'});
   if(req.method==='POST'&&parts[1]==='sign'){
    const q=await parsed(req);objectPath(q.bucket,q.key);if(!['upload','read'].includes(q.mode))throw Error('BAD_OBJECT');
    const token=crypto.randomBytes(32).toString('base64url'),ttl=q.mode==='upload'?600:Math.max(1,Math.min(3600,Number(q.ttl)||60));
    signed.set(token,{bucket:q.bucket,key:q.key,mode:q.mode,expires:Date.now()+ttl*1000});return json(res,200,{url:`${base}/${q.mode}/${token}`,token});
   }
   if(req.method==='PUT'&&parts[1]==='object'){
    await write(url.searchParams.get('bucket'),url.searchParams.get('key'),await body(req),req.headers['content-type'],true);return json(res,200,{ok:true});
   }
   if(req.method==='GET'&&parts[1]==='object'){
    const item=await read(url.searchParams.get('bucket'),url.searchParams.get('key'));res.writeHead(200,{'Content-Type':item.mime,'Content-Length':item.data.length});return res.end(item.data);
   }
   if(req.method==='POST'&&parts[1]==='copy'){
    const q=await parsed(req),item=await read(q.fromBucket,q.fromKey);await write(q.toBucket,q.toKey,item.data,item.mime,true);return json(res,200,{ok:true});
   }
   if(req.method==='POST'&&parts[1]==='remove'){
    const q=await parsed(req);if(!Array.isArray(q.keys)||q.keys.length>100)throw Error('BAD_OBJECT');
    for(const key of q.keys)await remove(q.bucket,key);return json(res,200,{ok:true});
   }
   if(req.method==='GET'&&parts[1]==='metrics')return json(res,200,{uploads,downloads,bytesWritten});
   return json(res,404,{error:'NOT_FOUND'});
  }
  if(parts[0]==='upload'&&req.method==='PUT'){
   const token=parts[1],entry=signed.get(token);if(!entry||entry.mode!=='upload'||entry.expires<=Date.now())return json(res,403,{error:'INVALID_TOKEN'});
   signed.delete(token);let data=await body(req),mime=req.headers['content-type']||'application/octet-stream';
   if(mime.toLowerCase().startsWith('multipart/form-data')){const fd=await new Request(base,{method:'POST',headers:{'Content-Type':mime},body:data}).formData();const files=[...fd.values()].filter(x=>typeof x!=='string');if(files.length!==1)throw Error('BAD_OBJECT');data=Buffer.from(await files[0].arrayBuffer());mime=files[0].type||'application/octet-stream';}
   await write(entry.bucket,entry.key,data,mime,false);return json(res,200,{Key:entry.key});
  }
  if((req.method==='GET'||req.method==='HEAD')&&(parts[0]==='read'||parts[0]==='public')){
   let bucket,key;if(parts[0]==='read'){const e=signed.get(parts[1]);if(!e||e.mode!=='read'||e.expires<=Date.now())return json(res,403,{error:'INVALID_TOKEN'});bucket=e.bucket;key=e.key;}
   else{bucket=parts[1];key=parts.slice(2).map(decodeURIComponent).join('/');if(bucket!=='media-public')return json(res,404,{error:'NOT_FOUND'});}
   const item=await read(bucket,key);res.writeHead(200,{'Content-Type':item.mime,'Content-Length':item.data.length});return res.end(req.method==='HEAD'?undefined:item.data);
  }
  return json(res,404,{error:'NOT_FOUND'});
 }catch(error){safeError(res,error);}
});
if(require.main===module){
 const ready=db?db.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS stage_media_objects (bucket TEXT NOT NULL, object_key TEXT NOT NULL, bytes BYTEA NOT NULL, mime TEXT NOT NULL, PRIMARY KEY (bucket,object_key))'):fs.mkdir(root,{recursive:true});
 ready.then(()=>server.listen(port,'0.0.0.0')).catch(()=>{process.exitCode=1;});
}
module.exports={server,objectPath,authorized};
