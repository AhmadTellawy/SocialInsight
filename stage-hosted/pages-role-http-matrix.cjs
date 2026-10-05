'use strict';
// Bounded collecting matrix: existing management/team/content/analytics only.
// All requests use real cookie auth and the restricted runtime API. SQL writes
// below seed only this harness's disposable database, never Production.
const crypto = require('node:crypto');
module.exports = async ({ actors, draftPage: page, admin, observer, signedProbe, report, save, postPayload,
  fixturePassword, BrowserClient, apiOrigin, clients }) => {
  const cases = [], semantic = [];
  const guest = new BrowserClient(apiOrigin, '127.5.0.1'); clients.push(guest);
  actors.guest = { client: guest };
  const probe = async (name, actor, route, allowed, method = 'GET', body) => {
    const result = await actors[actor].client.request(route, method, body);
    cases.push({ name, actor: actor === 'candidate' ? 'ANALYST' : actor.toUpperCase(), method,
      route: route.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':fixtureId'), expected: allowed,
      status: result.status, code: result.body.code || result.body.error || null, requestId: result.body.requestId || null,
      transport: result.transport, durationMs: result.durationMs, pass: allowed.includes(result.status) });
    report.roleMatrix = { status: 'RUNNING', cases, semantic }; save(); return result;
  };
  const truth = (name, pass, detail) => { semantic.push({ name, pass: !!pass, ...detail }); save(); };
  const managed = `/pages/manage/${page.id}`;
  const roleFlags = (actor) => ({ member: !['outsider', 'guest'].includes(actor),
    team: ['owner', 'admin'].includes(actor), edit: ['owner', 'admin', 'editor'].includes(actor),
    export: ['owner', 'admin', 'candidate'].includes(actor) });
  const roles = ['owner', 'admin', 'editor', 'candidate', 'outsider', 'guest'];
  // Establish memberships through the public invitation workflow, not SQL.
  for (const [actor, role] of [['admin', 'ADMIN'], ['editor', 'EDITOR'], ['candidate', 'ANALYST']]) {
    const invite = await probe(`invite ${role}`, 'owner', `${managed}/invitations`, [201], 'POST', { recipientId: actors[actor].id, role });
    if (!invite.body.id) throw new Error(`ROLE_BATCH_SETUP_${role}`);
    await probe(`stranger invitation ${role}`, 'outsider', `/pages/invitations/${invite.body.id}/accept`, [404], 'POST', {});
    await probe(`inbox ${role}`, actor, '/pages/invitations', [200]);
    await probe(`pre-membership ${role}`, actor, managed, [403, 404]);
    const accepted = await probe(`accept ${role}`, actor, `/pages/invitations/${invite.body.id}/accept`, [200], 'POST', {});
    if (accepted.status !== 200) throw new Error(`ROLE_BATCH_SETUP_ACCEPT_${role}`);
    await probe(`accept retry ${role}`, actor, `/pages/invitations/${invite.body.id}/accept`, [409], 'POST', {});
    truth(`invitation ${role} atomic audit/outbox`,
      await admin.pageAuditEvent.count({ where: { targetId: invite.body.id, action: 'INVITATION_ACCEPTED' } }) === 1 &&
      await admin.pageEvent.count({ where: { dedupeKey: `${invite.body.id}:ACCEPTED` } }) === 1);
  }
  const drafts = {};
  for (const actor of roles) {
    const f = roleFlags(actor), denied = actor === 'guest' ? [401] : [403, 404];
    await probe('management read', actor, managed, f.member ? [200] : denied);
    await probe('mine', actor, '/pages/mine', actor === 'guest' ? [401] : [200]);
    await probe('info update', actor, managed, f.team ? [200] : denied, 'PATCH', { bio: 'Bounded role batch' });
    await probe('team read', actor, `${managed}/team`, f.team ? [200] : denied);
    await probe('invitation requests', actor, `${managed}/requests?kind=invitation`, f.team ? [200] : denied);
    await probe('transfer requests', actor, `${managed}/requests?kind=transfer`, actor === 'owner' ? [200] : denied);
    await probe('audit read', actor, `${managed}/audit`, f.team ? [200] : denied);
    await probe('draft content list', actor, `${managed}/content?status=DRAFT`, f.edit ? [200] : denied);
    for (const days of [7, 30]) await probe(`analytics ${days} days`, actor, `${managed}/analytics?days=${days}`, f.member ? [200] : denied);
    await probe('analytics CSV Arabic', actor, `${managed}/analytics.csv?lang=ar`, f.export ? [200] : denied);
    const created = await probe('draft create', actor, '/posts', f.edit ? [200, 201] : denied, 'POST',
      postPayload(`role-${actor}`, 'DRAFT', { pageId: page.id, pageCreateKey: crypto.randomUUID() }));
    if (created.body.id) drafts[actor] = created.body;
    if (actor !== 'owner') await probe('lifecycle denial', actor, `${managed}/lifecycle`, denied, 'POST', { action: 'publish' });
  }
  if (drafts.owner) {
    for (const actor of roles) {
      const f = roleFlags(actor), denied = actor === 'guest' ? [401] : [403, 404];
      await probe('draft detail', actor, `${managed}/content/${drafts.owner.id}`, f.edit ? [200] : [404, ...denied]);
      // Boundary intentionally hides a nonpublic Page before requireAuth.
      await probe('draft edit', actor, `/posts/${drafts.owner.id}`, f.edit ? [200] : [404, ...denied], 'PUT', { title: `Edited by ${actor}` });
    }
  }
  await probe('publish content before page publication', 'owner', '/posts', [403, 404, 409], 'POST',
    postPayload('too-early', 'PUBLISHED', { pageId: page.id, pageCreateKey: crypto.randomUUID() }));
  await probe('owner publish page', 'owner', `${managed}/lifecycle`, [200], 'POST', { action: 'publish' });
  const post = await probe('published content create', 'editor', '/posts', [200, 201], 'POST',
    postPayload('published-role', 'PUBLISHED', { pageId: page.id, pageCreateKey: crypto.randomUUID() }));
  // Known aggregate truth must be identical for every analytics-capable role.
  // A different actor owns the event so row-level audit filtering is exercised.
  await admin.pageAuditEvent.create({ data: { pageId: page.id, actorId: actors.outsider.id,
    action: 'FOLLOW_CHANGED', data: { delta: 3 } } });
  for (const actor of ['editor','candidate']) {
    const audit = await signedProbe(actors[actor].id,false,probe=>probe.query('SELECT id FROM public."PageAuditEvent" WHERE "pageId"=$1 AND action=$2',[page.id,'FOLLOW_CHANGED']));
    truth(`private audit rows remain denied ${actor}`,audit.rowCount===0);
  }
  for (const actorId of [null,actors.outsider.id]) {
    let denied=false;
    try { await signedProbe(actorId,false,probe=>probe.query('SELECT public.socialinsight_page_follower_change($1,7)',[page.id])); }
    catch(error){denied=error.code==='42501';}
    truth('unsigned/outsider aggregate RPC denied',denied);
    for(const [sql,values] of [
      ['SELECT public.socialinsight_leave_page_team($1)',[page.id]],
      ['SELECT * FROM public.socialinsight_decide_page_transfer($1,$2)',[crypto.randomUUID(),'accept']]]) {
      let transitionDenied=false;
      try{await signedProbe(actorId,false,probe=>probe.query(sql,values));}catch(error){transitionDenied=error.code==='42501';}
      truth('unsigned/outsider self-service RPC denied',transitionDenied);
    }
  }
  for (const actor of ['owner', 'admin', 'editor', 'candidate']) {
    const stats = await probe('analytics aggregate equivalence', actor, `${managed}/analytics?days=7`, [200]);
    truth(`aggregate truth ${actor}`, stats.body.followerChange === 3 && stats.body.posts === 1,
      { followerChange: stats.body.followerChange, posts: stats.body.posts });
    if (post.body.id) await probe('published detail management', actor, `${managed}/content/${post.body.id}`, [200]);
  }
  if (post.body.id) {
    for (const actor of ['candidate', 'outsider', 'guest']) await probe('content delete denial', actor,
      `/posts/${post.body.id}`, actor === 'guest' ? [401] : [403, 404], 'DELETE', {});
    await probe('content delete allowed', 'admin', `/posts/${post.body.id}`, [200], 'DELETE', {});
    const retained = await admin.post.findUnique({ where: { id: post.body.id } });
    truth('content persisted deletion', !retained || retained.isDeleted);
  }
  await probe('owner unpublish page', 'owner', `${managed}/lifecycle`, [200], 'POST', { action: 'unpublish' });
  const rejected = await probe('rejection invitation', 'admin', `${managed}/invitations`, [201], 'POST', { recipientId: actors.voteFirst.id, role: 'EDITOR' });
  if (rejected.body.id) await probe('invitation reject', 'voteFirst', `/pages/invitations/${rejected.body.id}/reject`, [200], 'POST', {});
  const withdrawn = await probe('withdrawal invitation', 'owner', `${managed}/invitations`, [201], 'POST', { recipientId: actors.erasureFirst.id, role: 'ANALYST' });
  if (withdrawn.body.id) {
    await probe('invitation withdraw', 'owner', `/pages/invitations/${withdrawn.body.id}/withdraw`, [200], 'POST', {});
    await probe('withdrawn accept denial', 'erasureFirst', `/pages/invitations/${withdrawn.body.id}/accept`, [409], 'POST', {});
  }
  await probe('admin cannot promote editor to admin', 'admin', `${managed}/team/${actors.editor.id}`, [403], 'PATCH', { role: 'ADMIN' });
  await probe('owner analyst role change', 'owner', `${managed}/team/${actors.candidate.id}`, [200], 'PATCH', { role: 'EDITOR' });
  await probe('owner role restore', 'owner', `${managed}/team/${actors.candidate.id}`, [200], 'PATCH', { role: 'ANALYST' });
  const removable=await probe('admin invite removable editor','admin',`${managed}/invitations`,[201],'POST',
    {recipientId:actors.source2.id,role:'EDITOR'});
  if(removable.body.id) {
    await probe('removable editor accepts','source2',`/pages/invitations/${removable.body.id}/accept`,[200],'POST',{});
    await probe('editor cannot remove another member','editor',`${managed}/team/${actors.source2.id}`,[403,404],'PATCH',{role:null});
    await probe('admin removes editor','admin',`${managed}/team/${actors.source2.id}`,[200],'PATCH',{role:null});
    await probe('removed editor management denial','source2',managed,[403,404]);
  }
  // Recipient reject/accept must not require Page UPDATE privileges.
  for (const [actor, action] of [['candidate', 'reject'], ['editor', 'accept']]) {
    const transfer = await probe(`transfer start ${actor}`, 'owner', `${managed}/transfer`, [200], 'POST',
      { recipientId: actors[actor].id, password: fixturePassword, confirmHandle: page.handle });
    if (transfer.body.id) {
      await probe('transfer stranger decision denial','outsider',`/pages/transfers/${transfer.body.id}/${action}`,[404],'POST',{});
      await probe('transfer inbox', actor, '/pages/transfers', [200]);
      const decision = await probe(`transfer ${action}`, actor, `/pages/transfers/${transfer.body.id}/${action}`, [200], 'POST', {});
      if (decision.status !== 200 || action === 'reject') {
        if (decision.status !== 200) await probe('transfer fixture withdrawal', 'owner', `/pages/transfers/${transfer.body.id}/withdraw`, [200], 'POST', {});
      } else {
        truth('transfer persisted owner', (await admin.page.findUnique({ where: { id: page.id } }))?.ownerId === actors.editor.id);
        // Return to the original owner through the same real API path.
        const back = await probe('transfer back start', 'editor', `${managed}/transfer`, [200], 'POST',
          { recipientId: actors.owner.id, password: fixturePassword, confirmHandle: page.handle });
        if (back.body.id) await probe('transfer back accept', 'owner', `/pages/transfers/${back.body.id}/accept`, [200], 'POST', {});
      }
    }
  }
  const pendingLeave = await probe('pending transfer before departure','owner',`${managed}/transfer`,[200],'POST',
    {recipientId:actors.editor.id,password:fixturePassword,confirmHandle:page.handle});
  const ownGrant = await probe('admin pending grant before departure','admin',`${managed}/invitations`,[201],'POST',
    {recipientId:actors.voteFirst.id,role:'EDITOR'});
  for (const actor of ['owner', 'outsider', 'guest', 'admin', 'editor', 'candidate']) {
    if(actor==='editor')await admin.user.update({where:{id:actors.owner.id},data:{status:'SUSPENDED'}});
    const leave = await probe('team leave', actor, `${managed}/leave`, actor === 'owner' ? [409] : actor === 'guest' ? [401] : actor === 'outsider' ? [403, 404] : [200], 'POST', {});
    if (leave.status === 200) {
      truth(`membership removed ${actor}`, await admin.pageMembership.count({ where: { pageId: page.id, userId: actors[actor].id } }) === 0);
      await probe('former member management denial', actor, managed, [403, 404]);
      if(actor==='admin'&&ownGrant.body.id)truth('departing sender grant withdrawn',
        (await admin.pageInvitation.findUnique({where:{id:ownGrant.body.id}}))?.status==='WITHDRAWN');
      if(actor==='editor') {
        const hidden=await admin.page.findUnique({where:{id:page.id}});
        truth('last eligible editor departure derives safety only',!!hidden.safetyHiddenAt&&hidden.publicationState==='UNPUBLISHED'&&hidden.ownerId===actors.owner.id&&hidden.platformState==='NONE');
        if(pendingLeave.body.id)truth('departing recipient transfer withdrawn',
          (await admin.pageOwnershipTransfer.findUnique({where:{id:pendingLeave.body.id}}))?.status==='WITHDRAWN');
        await admin.user.update({where:{id:actors.owner.id},data:{status:'ACTIVE'}});
      }
    }
  }
  truth('private transition admissions consumed',(await observer.query('SELECT count(*)::int AS n FROM public.socialinsight_page_transition_admissions')).rows[0].n===0);
  const login = (await observer.query("SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname='pages_rc3_runtime'")).rows[0];
  truth('actual LOGIN restricted', login && Object.values(login).every(value => value === false));
  for(const signature of ['public.socialinsight_leave_page_team(text)','public.socialinsight_decide_page_transfer(text,text)',
    'public.socialinsight_page_follower_change(text,integer)']) {
    const acl=(await observer.query('SELECT count(*)::int AS n FROM pg_proc function CROSS JOIN LATERAL aclexplode(function.proacl) privilege WHERE function.oid=$1::regprocedure AND privilege.grantee<>function.proowner AND privilege.grantee<>(SELECT oid FROM pg_roles WHERE rolname=$2)',[signature,'socialinsight_runtime'])).rows[0].n;
    truth(`RPC owner/runtime-only ACL ${signature}`,acl===0);
  }
  report.roleMatrix.status = [...cases, ...semantic].every(c => c.pass) ? 'PASS' : 'FAIL';
  report.checks.push({ name: 'bounded real HTTP role matrix management/team/content/analytics', pass: report.roleMatrix.status === 'PASS',
    total: cases.length + semantic.length, failed: [...cases, ...semantic].filter(c => !c.pass).length });
  save();
};
