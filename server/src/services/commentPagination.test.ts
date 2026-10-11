import test from 'node:test';
import assert from 'node:assert/strict';
import {replyCursor,replyCursorWhere} from './commentPagination';
test('reply cursor orders equal timestamps by immutable id',()=>{
 const date=new Date('2026-10-11T00:00:00.000Z');
 assert.deepEqual(replyCursorWhere(replyCursor({createdAt:date,id:'abc'})),{OR:[{createdAt:{gt:date}},{createdAt:date,id:{gt:'abc'}}]});
});
test('malformed reply cursors cannot silently coerce dates or bypass bounds',()=>{
 for(const value of ['!','x'.repeat(257),Buffer.from('[null,"a"]').toString('base64url'),Buffer.from('[0,"a"]').toString('base64url'),Buffer.from('["2026-10-11",""]').toString('base64url')])assert.throws(()=>replyCursorWhere(value),/INVALID_REPLY_CURSOR/);
 assert.deepEqual(replyCursorWhere(),{});
});

test('root boundary descends without looking up the possibly deleted cursor row',()=>{
 const createdAt=new Date('2026-10-11T00:00:00.000Z');
 assert.deepEqual(replyCursorWhere(replyCursor({createdAt,id:'root'}),'desc'),{OR:[{createdAt:{lt:createdAt}},{createdAt,id:{lt:'root'}}]});
});
