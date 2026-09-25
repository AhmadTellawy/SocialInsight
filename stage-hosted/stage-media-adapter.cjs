'use strict';
const assert=require('node:assert/strict');
module.exports=function createStageAdapter(){
 const secret=process.env.STAGE_MEDIA_ADMIN_KEY;
 assert.equal(process.env.STAGE_ONLY,'true');
 assert.equal(process.env.RENDER_SERVICE_NAME,'si-pages-qa-api-20260926');
 assert.ok(secret?.length>=32);
 // Free Render web services cannot receive private-network traffic. The
 // separate synthetic media service uses its fixed public TLS hostname.
 const publicBase='https://si-pages-qa-media-20260926.onrender.com';
 async function call(action,method,data,query=''){
  const headers={Authorization:`Bearer ${secret}`};let body;
  if(data!==undefined){if(Buffer.isBuffer(data)){body=data;headers['Content-Type']='application/octet-stream';}else{body=JSON.stringify(data);headers['Content-Type']='application/json';}}
  let response;
  try{response=await fetch(`${publicBase}/admin/${action}${query}`,{method,headers,body,signal:AbortSignal.timeout(12000)});}
  catch(error){console.error(JSON.stringify({event:'stage_media_call_failed',action,reason:error?.name||'NETWORK'}));throw error;}
  if(!response.ok){console.error(JSON.stringify({event:'stage_media_call_failed',action,status:response.status}));throw Error(`STAGE_MEDIA_HTTP_${response.status}`);}
  if(action==='object'&&method==='GET')return Buffer.from(await response.arrayBuffer());
  return response.json();
 }
 const q=(bucket,key)=>`?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(key)}`;
 return {
  async createSignedUpload(bucket,key){const result=await call('sign','POST',{bucket,key,mode:'upload'});return {path:key,token:result.token,signedUrl:result.url};},
  download:(bucket,key)=>call('object','GET',undefined,q(bucket,key)),
  upload:(bucket,key,data,mime)=>call('object','PUT',data,q(bucket,key)),
  copy:(fromBucket,fromKey,toBucket,toKey)=>call('copy','POST',{fromBucket,fromKey,toBucket,toKey}),
  remove:(bucket,keys)=>call('remove','POST',{bucket,keys}),
  async createSignedReadUrl(bucket,key,expiresIn){return (await call('sign','POST',{bucket,key,mode:'read',ttl:expiresIn})).url;},
  getPublicUrl(bucket,key){assert.equal(bucket,'media-public');return `${publicBase}/public/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;},
  async provisionBuckets(){return;}
 };
};
