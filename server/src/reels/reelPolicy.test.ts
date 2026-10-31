import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { validateReelInput, validateReelSubmission } from './reelPolicy';
import { verifyStreamWebhook, streamProvider, reelsConfigured, videoMaintenanceConfigured } from './streamProvider';
import { assertAttachableVideo, cancelUnattachedVideo } from './videoService';
const valid = () => ({ presentationFormat: 'REEL', videoAssetId: '00000000-0000-4000-8000-000000000001', type: 'Poll', title: 'Choose', options: [{ id:'a', text:'A' }, { id:'b', text:'B' }], targetAudience:'Public', demographics:[] });

test('a quiz requires distinct option IDs and exactly one explicit correct answer', () => {
  for (const question of [
    { options: [{ text: 'A' }, { text: 'B' }] },
    { correctOptionId: '', options: [{ id: '', text: 'A' }, { id: 'b', text: 'B' }] },
    { correctOptionId: 'a', options: [{ id: 'a', text: 'A' }, { id: 'a', text: 'B' }] },
    { correctOptionId: 'missing', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] }
  ]) assert.throws(() => validateReelInput({ ...valid(), type: 'Quiz', sections: [{ questions: [{ text: 'Choose', type: 'multiple_choice', ...question }] }] }), { code: 'REEL_CORRECT_ANSWER' });
});

test('deleted or replaced attachments never revert to an uploader-owned fresh upload', async () => {
  let asset: any = { id: 'video', ownerId: 'former-editor', status: 'READY', attachedAt: new Date(), post: null };
  const tx: any = { $queryRaw: async () => [], videoAsset: { findUnique: async () => asset, update: async ({ data }: any) => { Object.assign(asset, data); return asset; } } };
  await assert.rejects(assertAttachableVideo(tx, 'video', 'former-editor'), { code: 'REEL_VIDEO_NOT_READY' });
  asset.post = { id: 'page-post' };
  await assert.doesNotReject(assertAttachableVideo(tx, 'video', 'current-editor', 'page-post'));
  asset = { ...asset, attachedAt: null, post: null };
  await assert.doesNotReject(assertAttachableVideo(tx, 'video', 'former-editor'));
  assert.ok(asset.attachedAt instanceof Date);
});

test('cancellation rechecks attachment after a competing creator releases the video lock', async () => {
  let attached = false, updates = 0;
  const tx: any = {
    $queryRaw: async () => { attached = true; return []; },
    videoAsset: { findUnique: async () => ({ ownerId: 'owner', status: 'READY', post: attached ? { id: 'post' } : null }), update: async () => { updates++; } }
  };
  await assert.rejects(cancelUnattachedVideo(tx, 'video', 'owner'), { code: 'VIDEO_UNAVAILABLE' });
  assert.equal(updates, 0);
});
test('disabling Reel creation does not disable retention of existing videos', () => {
  const keys = ['REELS_ENABLED','STREAM_ACCOUNT_ID','STREAM_API_TOKEN'] as const;
  const previous = keys.map(key => process.env[key]);
  try {
    process.env.REELS_ENABLED='false'; process.env.STREAM_ACCOUNT_ID='test'; process.env.STREAM_API_TOKEN='test';
    assert.equal(reelsConfigured(),false); assert.equal(videoMaintenanceConfigured(),true);
    delete process.env.STREAM_API_TOKEN; assert.equal(videoMaintenanceConfigured(),false);
  } finally { keys.forEach((key,index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key]=previous[index]; }); }
});
test('text-only policy rejects hidden image representations as well as active questions', () => {
  for (const image of [{image:'data:image/png;base64,x'}, {imageMediaId:'asset'}, {mediaAssetIds:['asset']}, {optionPresentation:'image'}]) {
    assert.throws(() => validateReelInput({...valid(),sections:[{questions:[{text:'Hidden',options:[{text:'A',...image}]}]}]}));
  }
  assert.doesNotThrow(() => validateReelInput(valid()));
  assert.throws(() => validateReelInput({...valid(),allowUserOptions:true}));
  assert.throws(() => validateReelInput({...valid(),targetAudience:'Custom Domain'}));
});
test('all required questions and option membership are checked before committing', () => {
  const questions=[{id:'q1',isRequired:true,type:'multiple_choice',options:[{id:'a'},{id:'b'}]},{id:'q2',isRequired:true,type:'multiple_choice',options:[{id:'c'},{id:'d'}]}];
  assert.throws(() => validateReelSubmission(questions,[{questionId:'q1',optionId:'a'}],[],false,true));
  assert.throws(() => validateReelSubmission(questions,[{questionId:'q1',optionId:'c'},{questionId:'q2',optionId:'a'}],[],false,true));
  assert.throws(() => validateReelSubmission(questions,[],['a','b','c'],true,true));
  assert.doesNotThrow(() => validateReelSubmission(questions,[],['a','c'],false,true));
});
test('malformed and excessive nested content returns a bounded policy error', () => {
  for (const value of [{ sections: {} }, { sections: [null] }, { sections: [{ questions: 'wrong' }] }, { title: 42 }, { options: [null, {}] }]) {
    assert.throws(() => validateReelInput({ ...valid(), ...value }), (error: any) => error.name !== 'TypeError' && error.status === 400);
  }
  let nested: any = {};
  for (let index = 0; index < 30; index++) nested = { nested };
  assert.throws(() => validateReelInput({ ...valid(), nested }), { code: 'REEL_INPUT_LIMIT' });
});
test('webhook verifies exact bytes, rejects stale/future/replayed tampered signatures', () => {
  const now=1700000000000,body=Buffer.from('{"uid":"abc"}\n'),secret='local-test';
  const sign=(time:number)=>`time=${time},sig1=${createHmac('sha256',secret).update(`${time}.`).update(body).digest('hex')}`;
  assert.equal(verifyStreamWebhook(body,sign(now/1000),secret,now),true);
  assert.equal(verifyStreamWebhook(Buffer.from(body.toString().trim()),sign(now/1000),secret,now),false);
  assert.equal(verifyStreamWebhook(body,sign(now/1000-301),secret,now),false);
  assert.equal(verifyStreamWebhook(body,sign(now/1000+301),secret,now),false);
  assert.equal(verifyStreamWebhook(body,'time=0,sig1=00',secret,now),false);
});
test('provider reserves private resumable uploads with a durable creator correlation', async () => {
  const original=global.fetch; let captured: RequestInit | undefined;
  global.fetch=(async(_url:any,init:any)=>{captured=init;return new Response(null,{status:201,headers:{Location:'https://upload.videodelivery.net/tus','stream-media-id':'a'.repeat(32)}});}) as any;
  try { await streamProvider.createUpload(1024,'asset-id',new Date('2030-01-01')); const headers=captured!.headers as Record<string,string>; assert.equal(headers['Upload-Creator'],'asset-id'); assert.match(headers['Upload-Metadata'],/requiresignedurls/); assert.equal(headers['Upload-Length'],'1024'); assert.equal(headers['Tus-Resumable'],'1.0.0'); }
  finally { global.fetch=original; }
});
