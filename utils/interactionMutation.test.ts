import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreVote, updatePost, updateComment } from './interactionMutation.ts';
test('failed vote leaves concurrent likes/comments, a different post and unrelated shares intact', () => {
  const before: any = {id:'p', likes:2, commentsCount:3, participants:7, hasParticipated:false};
  const current: any = {...before, likes:3, commentsCount:4, participants:8, hasParticipated:true};
  const other: any = {id:'other', hasParticipated:true};
  const rows = [current, other, {id:'share', sharedFrom:current}].map(p => updatePost(p as any,'p', p=>restoreVote(p,before)));
  assert.equal(rows[0].likes,3); assert.equal(rows[0].commentsCount,4); assert.equal(rows[0].participants,7);
  assert.equal(rows[1],other); assert.equal(rows[2].sharedFrom?.hasParticipated,false);
});
test('comment-like rollback changes only the target, including nested replies', () => {
  const rows:any = [{id:'a', text:'new edit', replies:[{id:'b',isLiked:true,likes:2}]}];
  const result=updateComment(rows,'b', c=>({...c,isLiked:false,likes:c.likes-1}));
  assert.equal(result[0].text,'new edit'); assert.equal(result[0].replies?.[0].likes,1);
});
