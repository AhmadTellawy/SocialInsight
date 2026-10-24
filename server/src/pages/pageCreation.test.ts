import test from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../prisma';
import { createPage } from './pageService';
import { pageCreateSchema, pageHandleSchema, pagePatchSchema, pageWebUrlSchema } from './pageValidation';
const minimal={name:'صفحة اختبار',category:'creator',representationConfirmed:true,requestId:'12345678-1234-4123-8123-123456789abc'};
test('minimal creation needs no bio, handle, photos or contact; editing can clear bio',()=>{
  const value=pageCreateSchema.parse(minimal);
  assert.equal(value.bio,'');assert.equal(value.handle,undefined);assert.equal(value.publicEmail,null);
  assert.equal(pagePatchSchema.safeParse({bio:''}).success,true);
  assert.equal(pagePatchSchema.safeParse({bio:'مرحبا\nبكم'}).success,true);
  assert.equal(pagePatchSchema.safeParse({bio:'ا'.repeat(161)}).success,false);
  assert.deepEqual(pagePatchSchema.parse({name:'صفحة'}),{name:'صفحة'});
  for(const field of ['name','category','representationConfirmed','requestId']){
    const invalid:any={...minimal};delete invalid[field];assert.equal(pageCreateSchema.safeParse(invalid).success,false,field);
  }
});
test('contacts normalize common input while rejecting malicious URLs and malformed phone',()=>{
  const value=pagePatchSchema.parse({website:'example.com',publicPhone:'+٩٦٢ ۷۹ ١٢٣٤٥٦٧'});
  assert.equal(value.website,'https://example.com');assert.equal(value.publicPhone,'+962 79 1234567');
  for(const url of ['javascript:alert(1)','data:text/html,hi','file:///secret','https://user:password@example.com','//example.com'])assert.equal(pageWebUrlSchema.safeParse(url).success,false,url);
  for(const phone of ['-----','(+)- ','1234','abcde'])assert.equal(pagePatchSchema.safeParse({publicPhone:phone}).success,false,phone);
  assert.equal(pagePatchSchema.safeParse({bio:'نص\u202eمضلل'}).success,false);
});
test('service allocates a unique handle and replay returns the same draft without creating another',async()=>{
  const original=prisma.$transaction;
  let stored:any=null,creates=0,lookups=0;
  const tx:any={
    $queryRaw:async()=>[{locked:true,id:'owner',status:'ACTIVE',emailVerifiedAt:new Date()}],
    page:{findUnique:async()=>stored,count:async()=>0,create:async({data}:any)=>{creates++;stored={...data,id:'page',createdAt:new Date(),publicationState:'DRAFT',platformState:'NONE'};return stored;}},
    pageHandle:{findUnique:async()=>++lookups===1?{handle:'collision'}:null},
    pageAuditEvent:{create:async()=>({})},
  };
  try{
    (prisma as any).$transaction=async(action:any)=>action(tx);
    const first=await createPage('owner',minimal);
    assert.equal(pageHandleSchema.safeParse(first.handle).success,true);assert.equal(lookups,2);assert.equal(first.bio,'');
    const second=await createPage('owner',minimal);
    assert.equal(second.handle,first.handle);assert.equal(creates,1);assert.equal(stored.publicationState,'DRAFT');
  }finally{(prisma as any).$transaction=original;}
});
