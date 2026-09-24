import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';

test('broker and fixed health import graphs never load Sharp or the legacy native runner',async()=>{
  const seen=new Set();
  async function visit(file) {
    if(seen.has(file))return;seen.add(file);
    const code=await fs.readFile(file,'utf8');
    assert.doesNotMatch(code,/(?:from\s*|import\s*\(|require\s*\()\s*['"]sharp['"]/,file);
    assert.doesNotMatch(code,/from\s*['"].*(?:converter|processRunner)\.js['"]/,file);
    for(const match of code.matchAll(/from\s*['"](\.\/[^'"]+\.js)['"]/g))await visit(path.resolve(path.dirname(file),match[1]));
  }
  for(const file of ['src/index.js','src/bootstrap.js','src/fixedHealthcheck.js'])await visit(path.resolve(file));
  assert.ok(seen.has(path.resolve('src/health.js')));
  assert.ok(seen.has(path.resolve('src/startupNativeProbe.js')));
  const health=await fs.readFile('src/health.js','utf8');
  assert.doesNotMatch(health,/\bspawn\(/);
});
