import test from 'node:test';
import assert from 'node:assert/strict';
import { getPageAnalytics, pageAnalyticsCsv } from './pageAnalyticsService';
import { runWithPageDatabaseContext, runWithPageTransaction } from './pageDatabaseContext';

test('Analytics reuses active route transaction without nested $transaction or Page UPDATE', async () => {
  for(const role of ['OWNER','ADMIN','EDITOR','ANALYST']) {
    const queries:string[]=[];
    const tx:any={
      $queryRaw:async(query:any)=>{
        const sql=Array.isArray(query)?query.join('?'):query.strings.join('?');queries.push(sql);
        assert.ok(!sql.includes('FOR UPDATE'));
        if(sql.includes('pg_try_advisory'))return [{locked:true}];
        if(sql.includes('FROM "Page"'))return [{id:'page',ownerId:role==='OWNER'?'actor':'owner',purgedAt:null}];
        if(sql.includes('FROM users'))return [{id:'actor',status:'ACTIVE'}];
        if(sql.includes('FROM "Response"'))return [{responses:BigInt(4),uniqueParticipants:BigInt(2)}];
        if(sql.includes('socialinsight_page_follower_change'))return [{delta:BigInt(3)}];
        return [];
      },
      user:{findUnique:async()=>({status:'ACTIVE'})},
      pageMembership:{findUnique:async()=>({role})},
      pageFollow:{count:async()=>5},post:{count:async()=>1},
      get $transaction(){throw new Error('Nested transaction must not be attempted');},
    };
    const stats=await runWithPageDatabaseContext({actorId:'actor',staff:false,system:false,testUser:false},
      ()=>runWithPageTransaction(tx,()=>getPageAnalytics('page','actor',7)));
    assert.deepEqual([stats.followers,stats.followerChange,stats.posts,stats.responses,stats.uniqueParticipants],[5,3,1,4,2]);
    assert.ok(queries.some(sql=>sql.includes('pg_advisory_xact_lock_shared')));
    assert.ok(!queries.some(sql=>sql.includes('FROM "PageAuditEvent"')),'No private audit-row read for analytics');
    assert.ok(pageAnalyticsCsv(stats,'ar').startsWith('\ufeff'));
    if(role==='EDITOR')await assert.rejects(runWithPageTransaction(tx,()=>getPageAnalytics('page','actor',30,true)),{code:'PAGE_PERMISSION_DENIED',status:403});
  }
});
