import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import express, { RequestHandler } from 'express';
import { PagePolicyError } from '../pages/pagePolicy';

test('Page media cache controls cover success, authorization denial and provider errors over HTTP', async t => {
  const saved = new Map<string, NodeModule | undefined>();
  const mock = (name:string, value:unknown) => { const id=require.resolve(name);saved.set(id,require.cache[id]);require.cache[id]={id,filename:id,loaded:true,exports:value} as NodeModule; };
  const unused:RequestHandler=(_req,res)=>{res.sendStatus(204);};
  let outcome:'ok'|'denied'|'provider'='ok', calls=0;
  const bytes=Buffer.from([137,80,78,71,13,10,26,10]);
  mock('../controllers/mediaController',Object.fromEntries(['cancelMedia','finalizeMedia','getMedia','getMediaConfig','startMediaUpload'].map(k=>[k,unused])));
  const optional:RequestHandler=(req,res,next)=>{if(req.get('Authorization')==='Bearer invalid'){res.status(401).json({error:'Invalid token'});return;}next();};
  mock('../middleware/authMiddleware',{optionalAuth:optional,requireAuth:optional});
  mock('../pages/pageMediaService',{pageMediaBytes:async()=>{calls++;if(outcome==='denied')throw new PagePolicyError('PAGE_MEDIA_UNAVAILABLE',404);if(outcome==='provider')throw Error('Synthetic provider diagnostic must not leak');return {bytes,mime:'image/png'};}});
  const routePath=require.resolve('./mediaRoutes');saved.set(routePath,require.cache[routePath]);delete require.cache[routePath];
  const app=express();app.use((_req,res,next)=>{res.vary('Origin');next();});app.use('/api/media',require('./mediaRoutes').default);
  const server=http.createServer(app);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const get=(authorization?:string)=>new Promise<{status:number;headers:http.IncomingHttpHeaders;body:Buffer}>((resolve,reject)=>{const req=http.get({host:'127.0.0.1',port:(server.address() as AddressInfo).port,path:'/api/media/synthetic/content',agent:false,headers:authorization?{Authorization:authorization}:{}},res=>{const chunks:Buffer[]=[];res.on('data',chunk=>chunks.push(Buffer.from(chunk)));res.on('end',()=>resolve({status:res.statusCode!,headers:res.headers,body:Buffer.concat(chunks)}));});req.on('error',reject);});
  const controls=(headers:http.IncomingHttpHeaders)=>{assert.equal(headers['cache-control'],'private, no-store');assert.equal(headers['x-content-type-options'],'nosniff');const vary=String(headers.vary).toLowerCase().split(',').map(v=>v.trim());assert(vary.includes('authorization'));assert(vary.includes('origin'));};
  try {
    await t.test('success preserves exact bytes and existing Vary Origin',async()=>{outcome='ok';const r=await get();assert.equal(r.status,200);assert.deepEqual(r.body,bytes);assert.match(String(r.headers['content-type']),/^image\/png/);controls(r.headers);});
    await t.test('authorization denial is generic and non-cacheable',async()=>{outcome='denied';const r=await get();assert.equal(r.status,404);assert.deepEqual(JSON.parse(r.body.toString()),{code:'PAGE_MEDIA_UNAVAILABLE',error:'Image unavailable'});controls(r.headers);});
    await t.test('provider failure is generic and non-cacheable',async()=>{outcome='provider';const r=await get();assert.equal(r.status,404);assert.equal(r.body.includes('provider'),false);controls(r.headers);});
    await t.test('early authentication response receives the same controls without media access',async()=>{const before=calls;const r=await get('Bearer invalid');assert.equal(r.status,401);assert.equal(calls,before);controls(r.headers);});
  } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));for(const[id,prior]of saved){if(prior)require.cache[id]=prior;else delete require.cache[id];}}
});
