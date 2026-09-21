import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import prisma from '../prisma';
import { pageMediaBytes, pageMediaPresentation } from './pageMediaService';
import { getMediaReadPresentation, importPageInlineMedia, promoteMediaAsset, serializeMediaAsset,
  commitPreparedMedia, restrictMediaAsset, markMediaAttached, finalizeMediaUpload, purgeMediaAsset,
  recoverStoppedMediaScopeOperation, retrySettledMediaScopeCleanup, mediaScopeRuntimeId } from '../services/mediaService';
import { setMediaStorageForTests, MediaStorage } from '../services/mediaStorage';
import { MEDIA_CONFIG } from '../config/media';

// Prisma delegates are proxies; node.mock.method cannot discover their methods.
const stub=(t:any,target:any,key:string,implementation:any)=>{
  const original=target[key];target[key]=implementation;t.after(()=>{target[key]=original;});
};

test('Page media uses current roles, post relations and feature gate, rechecking after storage I/O', async t => {
  const enabled=process.env.PAGES_ENABLED, allowlist=process.env.PAGES_TEST_USERS;
  process.env.PAGES_ENABLED='true'; delete process.env.PAGES_TEST_USERS;
  const page={id:'page',ownerId:'owner',avatarMediaId:'avatar',coverMediaId:null,purgedAt:null,
    publicationState:'PUBLISHED',platformState:'NONE',safetyHiddenAt:null,deletionRequestedAt:null};
  const variant={kind:'LARGE',isPublic:false,width:100,height:100,mime:'image/webp',storageBucket:'private',storageKey:'asset.webp'};
  let asset:any={id:'asset',pageId:'page',page,status:'ATTACHED',accessScope:'RESTRICTED',aspectRatio:1,
    variants:[variant],postAttachment:{postId:'post'}};
  let role:string|null='EDITOR', active=true, blocked=false, visible=false, postStatus='PUBLISHED', deleted=false, postPage='page';
  let reads=0, afterDownload:()=>void=()=>{};
  stub(t,prisma.mediaAsset,'findUnique',async()=>asset);
  stub(t,prisma,'$transaction',async(action:any)=>action(prisma));
  stub(t,prisma.pageBlock,'findFirst',async()=>blocked?{userId:'viewer'}:null);
  stub(t,prisma.user,'findUnique',async()=>({status:active?'ACTIVE':'SUSPENDED'}));
  stub(t,prisma.pageMembership,'findUnique',async()=>role?{role}:null);
  stub(t,prisma.post,'findUnique',async()=>({pageId:postPage,isDeleted:deleted,status:postStatus}));
  stub(t,prisma.post,'count',async()=>visible?1:0);
  stub(t,prisma.page,'count',async()=>visible?1:0);
  setMediaStorageForTests({download:async()=>{reads++;afterDownload();return Buffer.from('image');},
    getPublicUrl:()=>{throw new Error('No public media allowed');}} as unknown as MediaStorage);
  const denied=async()=>assert.rejects(()=>pageMediaBytes('asset','viewer'));
  try {
    const meta=await pageMediaPresentation('asset','viewer');
    assert.equal(meta.src,'/api/media/asset/content'); assert.equal(meta.requiresAuth,true); assert.equal(reads,0);
    assert.equal((await pageMediaBytes('asset','viewer')).bytes.toString(),'image');
    role=null; await denied();
    visible=true; await pageMediaBytes('asset'); visible=false;
    role='EDITOR'; active=false; await denied(); active=true;
    blocked=true; await denied(); blocked=false;
    deleted=true; await denied(); deleted=false;
    postPage='other-page'; await denied(); postPage='page';
    role='ANALYST'; await pageMediaBytes('asset','viewer');
    postStatus='DRAFT'; await denied(); postStatus='PUBLISHED';
    asset={...asset,postAttachment:null,questionFor:{postId:null,section:{postId:'post'}}};
    await pageMediaBytes('asset','viewer');
    asset={...asset,questionFor:null,optionFor:{question:{postId:null,section:{postId:'post'}}}};
    await pageMediaBytes('asset','viewer');
    role=null;visible=true;asset.altText='Internal option label';
    asset.optionFor.question.optionPresentation='image';asset.optionFor.question.showOptionNames=false;
    assert.equal((await pageMediaPresentation('asset')).altText,null);
    role='ANALYST';visible=false;
    afterDownload=()=>{role=null;}; await denied(); afterDownload=()=>{}; role='EDITOR';
    process.env.PAGES_ENABLED='false'; const priorReads=reads; await denied();
    await assert.rejects(()=>getMediaReadPresentation('asset','viewer'),(e:any)=>e.statusCode===404);
    assert.equal(reads,priorReads);
    process.env.PAGES_TEST_USERS='viewer'; await pageMediaBytes('asset','viewer');
    await assert.rejects(()=>pageMediaBytes('asset'));
    await assert.rejects(()=>promoteMediaAsset('asset'),(e:any)=>e.code==='PAGE_MEDIA_MUST_REMAIN_PRIVATE');
    const dto=serializeMediaAsset({...asset,accessScope:'PUBLIC',variants:[variant,{...variant,isPublic:true}]} as any);
    assert.equal(dto?.access,'RESTRICTED'); assert.equal(dto?.requiresAuth,true);
  } finally {
    if(enabled===undefined)delete process.env.PAGES_ENABLED;else process.env.PAGES_ENABLED=enabled;
    if(allowlist===undefined)delete process.env.PAGES_TEST_USERS;else process.env.PAGES_TEST_USERS=allowlist;
    setMediaStorageForTests(undefined);
  }
});

test('Page inline compatibility upload uses real shared processing and only private storage; corrupt sources clean up',async t=>{
  const enabled=process.env.PAGES_ENABLED;process.env.PAGES_ENABLED='true';
  let asset:any, variants:any[]=[], sequence=0;
  const objects=new Map<string,Buffer>(); const buckets:string[]=[];
  const tx:any={mediaAsset:{update:async({data}:any)=>{asset={...asset,...data};return {...asset,variants};}},
    mediaVariant:{deleteMany:async()=>{variants=[];},createMany:async({data}:any)=>{variants=data;}}};
  stub(t,prisma.mediaAsset,'create',async({data}:any)=>{asset={id:'inline-'+(++sequence),status:'TEMPORARY',...data};return asset;});
  stub(t,prisma.mediaAsset,'findUnique',async()=>({...asset,variants}));
  stub(t,prisma.mediaAsset,'update',async({data}:any)=>{asset={...asset,...data};return asset;});
  stub(t,prisma.mediaAsset,'updateMany',async({data}:any)=>{asset={...asset,...data};return {count:1};});
  stub(t,prisma.mediaVariant,'deleteMany',async()=>{variants=[];return {count:1};});
  stub(t,prisma,'$transaction',async(input:any)=>typeof input==='function'?input(tx):Promise.all(input));
  setMediaStorageForTests({upload:async(bucket,key,body)=>{buckets.push(bucket);objects.set(bucket+'/'+key,body);},
    download:async(bucket,key)=>{const body=objects.get(bucket+'/'+key);assert.ok(body);return body;},
    remove:async(bucket,keys)=>{keys.forEach(key=>objects.delete(bucket+'/'+key));},
    createSignedUpload:async()=>{throw new Error('unused');},copy:async()=>{throw new Error('unused');},
    createSignedReadUrl:async()=>{throw new Error('unused');},getPublicUrl:()=>{throw new Error('unused');},
    provisionBuckets:async()=>{throw new Error('unused');}});
  try {
    const png=await sharp({create:{width:120,height:100,channels:3,background:'#0070ba'}}).png().toBuffer();
    const id=await importPageInlineMedia('actor','POST','data:image/png;base64,'+png.toString('base64'));
    assert.equal(id,'inline-1');assert.equal(asset.status,'READY');assert.equal(asset.aspectRatio,1.2);
    assert.ok(asset.expiresAt);assert.ok(variants.length>0);assert.ok(variants.every(v=>!v.isPublic));
    assert.ok(buckets.every(bucket=>bucket===MEDIA_CONFIG.buckets.originals||bucket===MEDIA_CONFIG.buckets.private));
    assert.equal(objects.has(MEDIA_CONFIG.buckets.originals+'/actor/inline-1/upload.png'),false);
    await assert.rejects(()=>importPageInlineMedia('actor','POST','https://tracker.example/x'));
    await assert.rejects(()=>importPageInlineMedia('actor','POST','data:image/jpeg;base64,'+png.toString('base64')),(e:any)=>e.code==='MIME_MISMATCH');
    assert.equal(asset.status,'DELETED');
    assert.ok([...objects.keys()].every(key=>!key.includes('inline-2')));
  } finally {
    if(enabled===undefined)delete process.env.PAGES_ENABLED;else process.env.PAGES_ENABLED=enabled;
    setMediaStorageForTests(undefined);
  }
});

test('durable scope barrier rejects Page attachment during public I/O and recovers only settled or stopped operations',async t=>{
  let asset:any, variants:any[]=[], clock=0, transactionDepth=0;
  const objects=new Map<string,Buffer>();
  const reset=()=>{
    asset={id:'race',ownerId:'actor',pageId:null,status:'READY',accessScope:'OWNER_ONLY',errorCode:null,
      updatedAt:new Date(++clock),deletedAt:null,uploadBucket:'originals',uploadKey:'source',sourceMime:'image/png'};
    variants=[{mediaAssetId:'race',kind:'LARGE',width:100,height:100,mime:'image/webp',byteSize:5,
      isPublic:false,storageBucket:'private',storageKey:'source.webp'}];objects.clear();
  };
  reset();
  // Evaluate the actual Prisma CAS predicate rather than unconditionally accepting
  // updateMany. This also checks the relation predicate for stale public copies.
  const matches=(record:any,where:any):boolean=>Object.entries(where||{}).every(([key,value]:[string,any])=>{
    if(key==='AND')return (Array.isArray(value)?value:[value]).every(v=>matches(record,v));
    if(key==='OR')return value.some((v:any)=>matches(record,v));
    if(key==='NOT')return !matches(record,value);
    if(key==='variants')return (!value.none||!variants.some(v=>matches(v,value.none)))&&(!value.some||variants.some(v=>matches(v,value.some)));
    const actual=record[key]??null;
    if(value instanceof Date)return actual instanceof Date&&actual.getTime()===value.getTime();
    if(value&&typeof value==='object') {
      if(value.in)return value.in.includes(actual);
      if(Object.prototype.hasOwnProperty.call(value,'not'))return actual!==value.not;
      if(value.startsWith)return typeof actual==='string'&&actual.startsWith(value.startsWith);
    }
    return actual===value;
  });
  const find=async()=>({...structuredClone(asset),variants:structuredClone(variants)});
  const updateMany=async({where,data}:any)=>{
    if(!matches(asset,where))return {count:0};
    asset={...asset,...data,updatedAt:new Date(++clock)};return {count:1};
  };
  stub(t,prisma.mediaAsset,'findUnique',find);stub(t,prisma.mediaAsset,'findUniqueOrThrow',find);
  stub(t,prisma.mediaAsset,'updateMany',updateMany);
  stub(t,prisma.mediaVariant,'findMany',async({where}:any)=>structuredClone(variants.filter(v=>matches(v,where))));
  stub(t,prisma.mediaVariant,'createMany',async({data}:any)=>{
    for(const record of data)if(!variants.some(v=>v.storageBucket===record.storageBucket&&v.storageKey===record.storageKey))variants.push(record);
    return {count:data.length};
  });
  stub(t,prisma.mediaVariant,'deleteMany',async({where}:any)=>{
    const count=variants.length;variants=variants.filter(v=>!matches(v,where));return {count:count-variants.length};
  });
  stub(t,prisma,'$transaction',async(action:any)=>{
    const beforeAsset=structuredClone(asset),beforeVariants=structuredClone(variants);transactionDepth++;
    try{return await action(prisma);}catch(error){asset=beforeAsset;variants=beforeVariants;throw error;}finally{transactionDepth--;}
  });
  let blockUpload=false, rejectUpload=false, rejectRemoval=false, uploadCount=0;
  let entered:()=>void=()=>{},release:()=>void=()=>{};
  let enteredPromise=Promise.resolve(),releasePromise=Promise.resolve();
  const pauseUpload=()=>{
    blockUpload=true;enteredPromise=new Promise<void>(resolve=>{entered=resolve;});
    releasePromise=new Promise<void>(resolve=>{release=resolve;});
  };
  setMediaStorageForTests({
    download:async()=>{assert.equal(transactionDepth,0,'no storage I/O in DB transaction');return Buffer.from('image');},
    upload:async(bucket,key,body)=>{
      assert.equal(transactionDepth,0);assert.equal(asset.status,'PROCESSING');
      assert.ok(variants.some(v=>v.isPublic&&v.storageBucket===bucket&&v.storageKey===key),'key durably registered before upload');
      uploadCount++;if(blockUpload){entered();await releasePromise;}
      objects.set(bucket+'/'+key,body);if(rejectUpload)throw new Error('uncertain upload response');
    },
    remove:async(bucket,keys)=>{assert.equal(transactionDepth,0);if(rejectRemoval)throw new Error('storage unavailable');keys.forEach(key=>objects.delete(bucket+'/'+key));},
    createSignedUpload:async()=>{throw new Error('unused');},copy:async()=>{throw new Error('unused');},
    createSignedReadUrl:async()=>{throw new Error('unused');},getPublicUrl:()=>{throw new Error('unused');},provisionBuckets:async()=>{}
  });
  const prepared={assetIds:['race'],scope:'RESTRICTED' as const,promotedAssetIds:[]};
  const attachPage=()=>prisma.$transaction(async tx=>{
    await commitPreparedMedia(tx,prepared);await tx.mediaAsset.updateMany({where:{id:'race'},data:{pageId:'page'}});
  });
  try {
    pauseUpload();const promotion=promoteMediaAsset('race');await enteredPromise;
    assert.equal(asset.status,'PROCESSING');assert.ok(asset.errorCode.startsWith('MEDIA_SCOPE:'));
    await assert.rejects(attachPage);await assert.rejects(()=>markMediaAttached(['race'],'RESTRICTED'));
    await assert.rejects(()=>restrictMediaAsset('race'));
    await assert.rejects(()=>finalizeMediaUpload('actor','race',{}));await assert.rejects(()=>purgeMediaAsset('race'));
    assert.equal(await retrySettledMediaScopeCleanup('race'),false,'cannot retry an active upload');
    await assert.rejects(()=>recoverStoppedMediaScopeOperation('race',asset.errorCode,
      {runtimeId:mediaScopeRuntimeId,confirmedStopped:true,evidenceRef:'test/live-runtime'}));
    release();await promotion;blockUpload=false;
    assert.equal(asset.status,'READY');assert.equal(asset.accessScope,'PUBLIC');assert.equal(objects.size,1);
    await assert.rejects(attachPage,'stale private preparation cannot attach a now-public asset');
    await restrictMediaAsset('race');assert.equal(objects.size,0);await attachPage();
    const before=uploadCount;await assert.rejects(()=>promoteMediaAsset('race'));assert.equal(uploadCount,before);

    reset();rejectUpload=true;rejectRemoval=true;
    await assert.rejects(()=>promoteMediaAsset('race'));
    assert.equal(asset.status,'PROCESSING');assert.equal(objects.size,1);assert.ok(variants.some(v=>v.isPublic));
    await assert.rejects(attachPage);await assert.rejects(()=>purgeMediaAsset('race'));
    rejectUpload=false;rejectRemoval=false;
    assert.equal(await retrySettledMediaScopeCleanup('race'),true);
    assert.equal(asset.status,'READY');assert.equal(objects.size,0);await attachPage();

    reset();const stoppedRuntime='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const oldToken=`MEDIA_SCOPE:${stoppedRuntime}:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb:PROMOTE:READY:OWNER_ONLY`;
    asset.status='PROCESSING';asset.errorCode=oldToken;
    variants.push({...variants[0],isPublic:true,storageBucket:MEDIA_CONFIG.buckets.public,storageKey:'orphan-public'});
    objects.set(MEDIA_CONFIG.buckets.public+'/orphan-public',Buffer.from('image'));
    await assert.rejects(()=>recoverStoppedMediaScopeOperation('race',oldToken,
      {runtimeId:'wrong-runtime',confirmedStopped:true,evidenceRef:'test/stopped-runtime'}));
    assert.equal(asset.errorCode,oldToken);assert.equal(objects.size,1);
    const receipt=await recoverStoppedMediaScopeOperation('race',oldToken,
      {runtimeId:stoppedRuntime,confirmedStopped:true,evidenceRef:'test/stopped-runtime'});
    assert.equal(receipt.recoveredRuntimeId,stoppedRuntime);assert.equal(asset.status,'READY');assert.equal(objects.size,0);
    await assert.rejects(()=>recoverStoppedMediaScopeOperation('race',oldToken,
      {runtimeId:stoppedRuntime,confirmedStopped:true,evidenceRef:'test/stopped-runtime'}),'stale recovery token cannot run twice');
    await attachPage();
  } finally { release();setMediaStorageForTests(undefined); }
});
