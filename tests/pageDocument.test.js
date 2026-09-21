import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import handler,{pageDocument} from '../api/pages-document.js';
const template='<!doctype html><html><head><title>Opiniup</title></head><body><div id="root"></div><script src="/assets/existing.js"></script></body></html>';
const metadata={title:'<script>alert(1)</script> | Opiniup',description:'" onload="bad & good',canonicalUrl:'https://opiniup.com/pages/example',imageUrl:'https://opiniup.com/logo.png'};
test('server Page document preserves application assets and escapes visible and head fields',()=>{
  const html=pageDocument(template,metadata);
  assert.ok(html.includes('/assets/existing.js'));assert.ok(html.includes('<h1>&lt;script&gt;'));
  assert.equal(html.includes('<script>alert(1)'),false);assert.equal(html.includes('content="" onload='),false);
  assert.ok(html.includes('<link rel="canonical" href="https://opiniup.com/pages/example">'));
  const unavailable=pageDocument(template,null);assert.ok(unavailable.includes('noindex,nofollow'));assert.equal(unavailable.includes('og:title'),false);assert.equal(unavailable.includes('<h1>'),false);
});
test('document adapter redirects only an eligible canonical alias and excludes unavailable metadata',async()=>{
  const previousFetch=globalThis.fetch,previousRead=fs.readFile;let state=200,calls=0;
  fs.readFile=async()=>template;
  globalThis.fetch=async(url,options)=>{calls++;assert.equal(new URL(url).origin,'https://socialinsight-api.onrender.com');assert.equal(options.redirect,'error');return new Response(JSON.stringify(metadata),{status:state});};
  const response=()=>({statusCode:200,headers:{},body:'',setHeader(key,value){this.headers[key]=value;},end(body=''){this.body=body;}});
  try{
    let res=response();await handler({method:'GET',query:{handle:'old_alias'}},res);assert.equal(res.statusCode,302);assert.equal(res.headers.Location,metadata.canonicalUrl);
    state=404;res=response();await handler({method:'GET',query:{handle:'old_alias'}},res);assert.equal(res.statusCode,404);assert.ok(res.body.includes('noindex,nofollow'));assert.equal(res.headers.Location,undefined);assert.equal(res.body.includes(metadata.description),false);
    const before=calls;res=response();await handler({method:'GET',query:{handle:'mine'}},res);assert.equal(calls,before);assert.equal(res.statusCode,200);assert.ok(res.body.includes('noindex,nofollow'));
  }finally{globalThis.fetch=previousFetch;fs.readFile=previousRead;}
});
