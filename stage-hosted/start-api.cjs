'use strict';
// Stage-only bootstrap. Shipping product modules are loaded from the unchanged build.
const assert=require('node:assert/strict');
const NAME='si-pages-qa-api-20260926',MEDIA='si-pages-qa-media-20260926',WEB='https://si-pages-qa-web-20260926.onrender.com';
assert.equal(process.env.STAGE_ONLY,'true');
assert.equal(process.env.RENDER_SERVICE_NAME,NAME);
assert.equal(process.env.RENDER_EXTERNAL_HOSTNAME,`${NAME}.onrender.com`);
assert.equal(process.env.CLIENT_URL,WEB);
assert.ok(process.env.DATABASE_URL?.startsWith('postgresql://')||process.env.DATABASE_URL?.startsWith('postgres://'));
assert.equal(process.env.DIRECT_URL,process.env.DATABASE_URL);
assert.ok(!/supabase/i.test(process.env.DATABASE_URL));
assert.equal(new URL(process.env.DATABASE_URL).pathname,'/si_pages_qa');
assert.ok(process.env.STAGE_MEDIA_ADMIN_KEY?.length>=32);
// The service's real health check requires storage configuration. The storage
// implementation itself is replaced before the compiled application imports it.
process.env.SUPABASE_URL=`https://${MEDIA}.onrender.com`;
process.env.SUPABASE_SERVICE_ROLE_KEY=process.env.STAGE_MEDIA_ADMIN_KEY;
const webpush=require('../server/node_modules/web-push');
const vapid=webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY=vapid.publicKey;
process.env.VAPID_PRIVATE_KEY=vapid.privateKey;
process.env.VAPID_SUBJECT='mailto:privacy@opiniup.com';
const {setMediaStorageForTests}=require('../server/dist/services/mediaStorage.js');
setMediaStorageForTests(require('./stage-media-adapter.cjs')());
require('./seed-synthetic.cjs')().then(()=>{
 const {httpServer}=require('../server/dist/app.js');
 const port=process.env.PORT||3001;
 httpServer.listen(port,()=>console.log(`Stage API listening on port ${port}`));
}).catch(()=>{process.exitCode=1;});
