'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
assert.equal(process.env.STAGE_ONLY,'true');
assert.equal(process.env.RENDER_SERVICE_NAME,'si-pages-qa-web-20260926');
assert.equal(process.env.VITE_API_URL,'https://si-pages-qa-api-20260926.onrender.com/api');
assert.ok(fs.existsSync('dist/index.html'));
fs.writeFileSync('dist/robots.txt','User-agent: *\nDisallow: /\n');
