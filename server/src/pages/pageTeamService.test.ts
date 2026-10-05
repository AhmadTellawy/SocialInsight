import test from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../prisma';
import { Prisma } from '@prisma/client';
import { leavePageTeam, respondPageInvitation, respondPageTransfer } from './pageTeamService';

function fixture(options: { member?: boolean; revokeOnLock?: boolean; inactive?: boolean; auditFails?: boolean } = {}) {
  const events: string[] = [];
  let stored = { member: options.member ?? true, invitation: 'PENDING', transfer: 'PENDING', audits: 0 };
  const transaction = async (action: any, config: any) => {
    assert.equal(config.isolationLevel, 'Serializable');
    let pending = { ...stored };
    const key = { pageId_userId: { pageId: 'page', userId: 'member' } };
    const page = { id: 'page', ownerId: 'owner', purgedAt: null, safetyHiddenAt: null };
    const tx: any = {
      $queryRaw: async (query: any) => {
        const sql = Array.isArray(query) ? query.join('?') : query?.strings?.join('?') || String(query);
        if (sql.includes('pg_try_advisory_xact_lock')) return [{ locked: true }];
        if (sql.includes('pg_advisory_xact_lock')) { events.push('page-advisory'); return []; }
        if (sql.includes('socialinsight_leave_page_team')) {
          events.push('leave-rpc');
          assert.ok(pending.member);
          pending.member=false;pending.invitation='WITHDRAWN';pending.transfer='WITHDRAWN';
          if(options.auditFails)throw new Error('audit unavailable');
          pending.audits++;return [{left:true}];
        } else {
          assert.ok(sql.endsWith('FOR SHARE')); events.push('actor-lock'); events.push('actor-read');
          return [{ id: 'member', status: options.inactive ? 'SUSPENDED' : 'ACTIVE', emailVerifiedAt: null }];
        }
      },
      user: { findUnique: async () => { throw new Error('Actor lock must return its current row without a second fetch'); } },
      page: {
        findUnique: async () => { events.push('page-read'); if(options.revokeOnLock)stored.member=pending.member=false;return page; },
        findUniqueOrThrow: async () => { events.push('safety'); return { ...page, owner: { status: 'ACTIVE' } }; },
      },
      pageMembership: {
        findUnique: async ({ where }: any) => { assert.deepEqual(where, key); events.push('membership-read'); return pending.member ? { userId: 'member' } : null; },
        delete: async ({ where }: any) => { assert.deepEqual(where, key); assert.ok(pending.member); events.push('membership-delete'); pending.member = false; },
      },
      pageInvitation: { updateMany: async ({ where, data }: any) => {
        assert.deepEqual(where, { pageId: 'page', senderId: 'member', status: 'PENDING', role: { in: ['ADMIN', 'EDITOR', 'ANALYST'] } });
        assert.equal(data.status, 'WITHDRAWN'); assert.ok(data.decidedAt instanceof Date);
        events.push('invitation-withdraw'); pending.invitation = data.status;
      } },
      pageOwnershipTransfer: { updateMany: async ({ where, data }: any) => {
        assert.deepEqual(where, { pageId: 'page', recipientId: 'member', status: 'PENDING' });
        assert.equal(data.status, 'WITHDRAWN'); events.push('transfer-withdraw'); pending.transfer = data.status;
      } },
      pageAuditEvent: { create: async ({ data }: any) => {
        assert.equal(data.action, 'MEMBER_LEFT'); assert.equal(data.actorId, 'member'); assert.equal(data.pageId, 'page');
        events.push('audit'); if (options.auditFails) throw new Error('audit unavailable'); pending.audits++;
      } },
    };
    const result = await action(tx); stored = pending; return result;
  };
  return { transaction, events, state: () => ({ ...stored }) };
}

test('Team outsider is denied before membership, invitation, transfer, audit or safety writes', async () => {
  const original = prisma.$transaction, f = fixture({ member: false });
  try {
    (prisma as any).$transaction = f.transaction; const before = f.state();
    await assert.rejects(leavePageTeam('page', 'member'), { code: 'PAGE_PERMISSION_DENIED', status: 403 });
    assert.deepEqual(f.state(), before);
    assert.deepEqual(f.events, ['page-advisory', 'actor-lock', 'actor-read', 'page-read', 'membership-read']);
  } finally { prisma.$transaction = original; }
});

test('Current team member leaves once, withdraws own pending grants and creates one audit', async () => {
  const original = prisma.$transaction, f = fixture();
  try {
    (prisma as any).$transaction = f.transaction;
    assert.deepEqual(await leavePageTeam('page', 'member'), { left: true });
    assert.deepEqual(f.state(), { member: false, invitation: 'WITHDRAWN', transfer: 'WITHDRAWN', audits: 1 });
    assert.deepEqual(f.events, ['page-advisory', 'actor-lock', 'actor-read', 'page-read', 'membership-read', 'leave-rpc']);
    const after = f.state(); f.events.length = 0;
    await assert.rejects(leavePageTeam('page', 'member'), { code: 'PAGE_PERMISSION_DENIED', status: 403 });
    assert.deepEqual(f.state(), after); assert.deepEqual(f.events, ['page-advisory', 'actor-lock', 'actor-read', 'page-read', 'membership-read']);
  } finally { prisma.$transaction = original; }
});

test('Membership removed before Page lock acquisition cannot create a false leave audit', async () => {
  const original = prisma.$transaction, f = fixture({ revokeOnLock: true });
  try {
    (prisma as any).$transaction = f.transaction;
    await assert.rejects(leavePageTeam('page', 'member'), { code: 'PAGE_PERMISSION_DENIED', status: 403 });
    assert.deepEqual(f.state(), { member: false, invitation: 'PENDING', transfer: 'PENDING', audits: 0 });
    assert.deepEqual(f.events, ['page-advisory', 'actor-lock', 'actor-read', 'page-read', 'membership-read']);
  } finally { prisma.$transaction = original; }
});

test('Owner transfer requirement and inactive actor denial remain before membership writes', async () => {
  const original = prisma.$transaction;
  try {
    for (const inactive of [false, true]) {
      const f = fixture({ inactive }); (prisma as any).$transaction = f.transaction; const before = f.state();
      await assert.rejects(leavePageTeam('page', inactive ? 'member' : 'owner'), {
        code: inactive ? 'PAGE_ACTIVE_ACCOUNT_REQUIRED' : 'PAGE_OWNER_MUST_TRANSFER', status: inactive ? 401 : 409,
      });
      assert.deepEqual(f.state(), before); assert.deepEqual(f.events, inactive ? ['page-advisory', 'actor-lock', 'actor-read'] : ['page-advisory', 'actor-lock', 'actor-read', 'page-read']);
    }
  } finally { prisma.$transaction = original; }
});

test('Audit failure rolls back membership removal and pending invitation and transfer withdrawal', async () => {
  const original = prisma.$transaction, f = fixture({ auditFails: true });
  try {
    (prisma as any).$transaction = f.transaction; const before = f.state();
    await assert.rejects(leavePageTeam('page', 'member'), /audit unavailable/);
    assert.deepEqual(f.state(), before); assert.equal(f.events.includes('safety'), false);
  } finally { prisma.$transaction = original; }
});

function decisionFixture(options: { role?: string; status?: string; expired?: boolean; inactive?: boolean; wrongResult?: boolean; deniedRpc?: boolean } = {}) {
  const events: string[] = [];
  let stored = { status: options.status || 'PENDING', member: false, audits: 0, outbox: 0 };
  const invitation = () => ({ id: 'invitation', pageId: 'draft-page', recipientId: 'recipient', senderId: 'sender',
    role: options.role || 'EDITOR', status: stored.status, expiresAt: new Date(Date.now() + (options.expired ? -60000 : 60000)) });
  const transaction = async (work: any) => {
    const pending = { ...stored };
    const tx: any = {
      pageInvitation: { findUnique: async () => invitation(), findUniqueOrThrow: async () => invitation() },
      $queryRaw: async (query: any, ...values: any[]) => {
        const sql = Array.isArray(query) ? query.join('?') : query?.strings?.join('?') || String(query);
        const params = Array.isArray(query) ? values : query.values || values;
        if (sql.includes('pg_try_advisory_xact_lock')) return [{ locked: true }];
        if (sql.includes('pg_advisory_xact_lock')) { events.push('advisory'); return []; }
        if (sql.includes('FROM users')) { events.push('active-account'); return [{ id: params[0], status: options.inactive ? 'SUSPENDED' : 'ACTIVE', emailVerifiedAt: new Date() }]; }
        if (sql.includes('socialinsight_decide_page_invitation')) {
          events.push('decision-rpc');
          if (options.deniedRpc) throw new Prisma.PrismaClientKnownRequestError('denied', { code: 'P2010', clientVersion: '6.12.0', meta: { code: '42501' } });
          assert.deepEqual(params, ['invitation', params[1]]); assert.ok(['accept','reject'].includes(params[1]));
          pending.status = params[1] === 'accept' ? 'ACCEPTED' : 'REJECTED';
          pending.member = params[1] === 'accept'; pending.audits++; pending.outbox++;
          return [{page_id:options.wrongResult?'other-page':'draft-page',decided_status:pending.status,accepted_role:pending.member?invitation().role:null}];
        }
        throw new Error('Recipient must never borrow Page FOR UPDATE or ordinary Page DML');
      },
      page: new Proxy({}, { get() { throw new Error('Recipient Page access must remain in the narrow RPC'); } }),
    };
    const result = await work(tx); stored = pending; return result;
  };
  return { transaction, events, state: () => ({ ...stored }) };
}

test('Draft recipient accepts ADMIN/EDITOR/ANALYST through one atomic RPC without Page UPDATE authority', async () => {
  const original = prisma.$transaction;
  try { for (const role of ['ADMIN','EDITOR','ANALYST']) {
    const f=decisionFixture({role});(prisma as any).$transaction=f.transaction;
    assert.deepEqual(await respondPageInvitation('invitation','recipient','accept'),{status:'ACCEPTED',pageId:'draft-page'});
    assert.deepEqual(f.state(),{status:'ACCEPTED',member:true,audits:1,outbox:1});
    assert.deepEqual(f.events,['advisory','active-account','active-account','decision-rpc']);
    await assert.rejects(respondPageInvitation('invitation','recipient','accept'),{code:'PAGE_INVITATION_EXPIRED',status:409});
    assert.deepEqual(f.state(),{status:'ACCEPTED',member:true,audits:1,outbox:1});
  }} finally { prisma.$transaction=original; }
});

test('Draft recipient rejection records one decision without creating membership or reading Page', async () => {
  const original=prisma.$transaction,f=decisionFixture();
  try {(prisma as any).$transaction=f.transaction;
    assert.deepEqual(await respondPageInvitation('invitation','recipient','reject'),{status:'REJECTED',pageId:'draft-page'});
    assert.deepEqual(f.state(),{status:'REJECTED',member:false,audits:1,outbox:1});
    assert.deepEqual(f.events,['advisory','active-account','decision-rpc']);
  }finally{prisma.$transaction=original;}
});

test('Invitation stranger is denied before coordination, accounts or decision RPC', async () => {
  const original=prisma.$transaction,f=decisionFixture();
  try{(prisma as any).$transaction=f.transaction;const before=f.state();
    await assert.rejects(respondPageInvitation('invitation','stranger','accept'),{code:'PAGE_INVITATION_NOT_FOUND',status:404});
    assert.deepEqual(f.state(),before);assert.deepEqual(f.events,[]);
  }finally{prisma.$transaction=original;}
});

test('Withdrawn, expired and inactive-recipient invitations never reach the transition RPC', async () => {
  const original=prisma.$transaction;
  try{for(const options of [{status:'WITHDRAWN'},{expired:true},{inactive:true}]){
    const f=decisionFixture(options);(prisma as any).$transaction=f.transaction;const before=f.state();
    await assert.rejects(respondPageInvitation('invitation','recipient','accept'));
    assert.deepEqual(f.state(),before);assert.ok(!f.events.includes('decision-rpc'));
  }}finally{prisma.$transaction=original;}
});

test('A mismatched RPC acknowledgement rolls back membership, audit and outbox together', async () => {
  const original=prisma.$transaction,f=decisionFixture({wrongResult:true});
  try{(prisma as any).$transaction=f.transaction;const before=f.state();
    await assert.rejects(respondPageInvitation('invitation','recipient','accept'),{code:'PAGE_INVITATION_REVOKED',status:409});
    assert.deepEqual(f.state(),before);
  }finally{prisma.$transaction=original;}
});

test('Database revalidation denial maps to recoverable invitation conflict, not server500', async () => {
  const original=prisma.$transaction,f=decisionFixture({deniedRpc:true});
  try{(prisma as any).$transaction=f.transaction;const before=f.state();
    await assert.rejects(respondPageInvitation('invitation','recipient','accept'),{code:'PAGE_INVITATION_REVOKED',status:409});
    assert.deepEqual(f.state(),before);
  }finally{prisma.$transaction=original;}
});

test('Transfer recipient decisions reuse signed coordination without borrowing Page UPDATE', async () => {
  const original=prisma.$transaction;
  try {for(const action of ['accept','reject'] as const){
    const events:string[]=[];
    const transfer={pageId:'draft-page',recipientId:'recipient',senderId:'sender',status:'PENDING',expiresAt:new Date(Date.now()+60000)};
    const tx:any={pageOwnershipTransfer:{findUnique:async()=>transfer,findUniqueOrThrow:async()=>transfer},
      $queryRaw:async(query:any,...values:any[])=>{
        const sql=Array.isArray(query)?query.join('?'):query.strings.join('?');
        if(sql.includes('pg_try_advisory'))return [{locked:true}];
        if(sql.includes('pg_advisory')){events.push('coordination');return [];}
        if(sql.includes('FROM users'))return [{status:'ACTIVE',emailVerifiedAt:new Date()}];
        if(sql.includes('socialinsight_decide_page_transfer')){assert.deepEqual(values,['transfer',action]);events.push('decision');return [{page_id:'draft-page',decided_status:action==='accept'?'ACCEPTED':'REJECTED'}];}
        throw new Error('Unexpected Page UPDATE requirement');
      }};
    (prisma as any).$transaction=async(work:any)=>work(tx);
    assert.deepEqual(await respondPageTransfer('transfer','recipient',action),{status:action==='accept'?'ACCEPTED':'REJECTED',pageId:'draft-page'});
    assert.deepEqual(events,['coordination','decision']);events.length=0;
    await assert.rejects(respondPageTransfer('transfer','stranger',action),{code:'PAGE_TRANSFER_NOT_FOUND',status:404});
    assert.deepEqual(events,[]);
  }}finally{prisma.$transaction=original;}
});
