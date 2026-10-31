// Loopback-only regression fixtures. Never imported by the production server.
module.exports = ({ app, db, adminDb, requireServer, sessions, origin, uploadsOnHold }) => {
  const { cancelUnattachedVideo } = requireServer('./dist/reels/videoService.js');
  const { runWithPageSystemContext, applyPageDatabaseContext } = requireServer('./dist/pages/pageDatabaseContext.js');
  const handle = work => (req, res, next) => Promise.resolve(work(req, res)).catch(next);
  const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
  app.post('/__test/hold-upload', handle(async (req, res) => {
    const session = await sessions.resolveSession(req); if (!session) return res.sendStatus(401);
    if (!uploadsOnHold.has(session.userId)) uploadsOnHold.set(session.userId, { ...deferred(), entered: false });
    res.json({ ok: true });
  }));
  app.get('/__test/hold-upload', handle(async (req, res) => {
    const session = await sessions.resolveSession(req); if (!session) return res.sendStatus(401);
    res.json({ entered: !!uploadsOnHold.get(session.userId)?.entered, assets: await adminDb.videoAsset.count({ where: { ownerId: session.userId } }) });
  }));
  app.delete('/__test/hold-upload', handle(async (req, res) => {
    const session = await sessions.resolveSession(req); if (!session) return res.sendStatus(401);
    uploadsOnHold.get(session.userId)?.resolve(); uploadsOnHold.delete(session.userId);
    res.json({ ok: true });
  }));
  const waitForWaiter = async pid => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const rows = await adminDb.$queryRaw`SELECT pid FROM pg_stat_activity WHERE ${pid}::integer = ANY(pg_blocking_pids(pid))`;
      if (rows.length) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('Regression did not reach the intended database lock interleaving');
  };
  app.post('/__test/team/:id', handle(async (req, res) => {
    const session = await sessions.resolveSession(req);
    const page = await adminDb.page.findUnique({ where: { id: req.params.id } });
    if (!session || page?.ownerId !== session.userId) return res.sendStatus(403);
    await runWithPageSystemContext(() => adminDb.$transaction(async tx => {
      await applyPageDatabaseContext(tx);
      if (req.body.remove) await tx.pageMembership.deleteMany({ where: { pageId: page.id, userId: req.body.userId } });
      else await tx.pageMembership.upsert({ where: { pageId_userId: { pageId: page.id, userId: req.body.userId } }, update: { role: 'EDITOR' }, create: { pageId: page.id, userId: req.body.userId, role: 'EDITOR' } });
    }));
    res.json({ ok: true });
  }));
  app.post('/__test/cancel-race/:id', handle(async (req, res) => {
    const session = await sessions.resolveSession(req);
    const asset = await adminDb.videoAsset.findUnique({ where: { id: req.params.id }, include: { post: true } });
    if (!session || asset?.ownerId !== session.userId || asset.post || asset.status !== 'READY') return res.sendStatus(403);
    const ready = deferred(), release = deferred();
    const creator = adminDb.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "VideoAsset" WHERE id = ${asset.id} FOR UPDATE`;
      const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
      ready.resolve(pid); await release.promise;
      await tx.videoAsset.update({ where: { id: asset.id }, data: { attachedAt: new Date(), updatedAt: new Date() } });
      return tx.post.create({ data: { title: 'Concurrent publication', description: '', type: 'Poll', authorId: session.userId, presentationFormat: 'REEL', videoAssetId: asset.id, expiresAt: new Date(Date.now() + 86400000) } });
    }, { timeout: 10000 });
    const pid = await ready.promise;
    const cancellation = db.$transaction(tx => cancelUnattachedVideo(tx, asset.id, session.userId)).then(() => 'cancelled', error => error.code);
    try { await waitForWaiter(pid); } finally { release.resolve(); }
    const post = await creator;
    res.json({ cancellation: await cancellation, postId: post.id, asset: await adminDb.videoAsset.findUnique({ where: { id: asset.id } }) });
  }));
  app.post('/__test/update-race/:id', handle(async (req, res) => {
    const session = await sessions.resolveSession(req);
    const post = await adminDb.post.findUnique({ where: { id: req.params.id } });
    const replacement = await adminDb.videoAsset.findUnique({ where: { id: req.body.replacement }, include: { post: true } });
    if (!session || post?.authorId !== session.userId || replacement?.ownerId !== session.userId || replacement.post || replacement.status !== 'READY') return res.sendStatus(403);
    const ready = deferred(), release = deferred();
    const competingWriter = adminDb.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Post" WHERE id = ${post.id} FOR UPDATE`;
      const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
      ready.resolve(pid); await release.promise;
      await tx.videoAsset.update({ where: { id: replacement.id }, data: { attachedAt: new Date() } });
      await tx.post.update({ where: { id: post.id }, data: { videoAssetId: replacement.id, responseCount: 1 } });
    }, { timeout: 10000 });
    const pid = await ready.promise;
    const update = fetch(`${origin}/api/posts/${post.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: req.get('Cookie') || '', 'X-CSRF-Token': req.get('X-CSRF-Token') || '' }, body: JSON.stringify({ description: 'Metadata survives a competing video update' }) });
    try { await waitForWaiter(pid); } finally { release.resolve(); }
    await competingWriter;
    const response = await update;
    res.json({ status: response.status, body: await response.json(), post: await adminDb.post.findUnique({ where: { id: post.id } }) });
  }));
};
