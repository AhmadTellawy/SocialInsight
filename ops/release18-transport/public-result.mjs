import fs from 'node:fs';
import path from 'node:path';
import { SERVICE,FROZEN_BINDING,UUID,COMMIT,must,digest,directory,readRegular,canonical,sha256,checkedProjection } from './contract.mjs';
function successHtml(record,json) {
  const escaped=json.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  return '<!doctype html><meta charset="utf-8"><title>Stage database preparation</title><h1>Stage database preparation passed</h1><p>No database mutation or application deployment.</p><a href="'+record+'">Minimized result JSON</a><pre>'+escaped+'</pre>\n';
}
function place(runnerRoot,runId,value,io=fs) {
  directory(runnerRoot);
  must(typeof runId==='string'&&runId.length===36&&UUID.test(runId),'PUBLIC_RUN_INVALID');
  const root=path.resolve(runnerRoot,'../public-result');
  if(!io.existsSync(root))io.mkdirSync(root,{mode:0o755});
  directory(root);
  if(process.platform==='linux')must(fs.statSync(root).uid===process.getuid()&&(fs.statSync(root).mode&0o022)===0,'PUBLIC_DIRECTORY_PERMISSIONS_INVALID');
  const record='result-'+runId+'.json',json=canonical(value)+'\n';
  const pending=path.join(root,'.index-'+runId+'.pending'),index=path.join(root,'index.html');
  if(io.existsSync(index))readRegular(index,1048576);
  io.writeFileSync(path.join(root,record),json,{flag:'wx',mode:0o644});
  const html=successHtml(record,json);
  io.writeFileSync(pending,html,{flag:'wx',mode:0o644});
  io.renameSync(pending,index);
  return {recordWritten:true,indexPublished:true};
}
function checkedCaptureSummary(summary) {
  const expected=['event','status','runId','evidenceSha256','proofSha256','databaseMutation','applicationDeployment'];
  must(summary&&Object.keys(summary).every(k=>expected.includes(k)||k==='reviewedProjection')&&expected.every(k=>Object.hasOwn(summary,k)),'PUBLIC_SUMMARY_INVALID');
  must(summary.event==='RELEASE18_TRANSPORT_CAPTURE'&&summary.status==='PASSED'&&summary.databaseMutation===false&&summary.applicationDeployment===false,'PUBLIC_SUMMARY_INVALID');
  digest(summary.evidenceSha256);digest(summary.proofSha256);
  const safe={event:'RELEASE18_TRANSPORT_CAPTURE',status:'PASSED',runId:summary.runId,evidenceSha256:summary.evidenceSha256,proofSha256:summary.proofSha256,databaseMutation:false,applicationDeployment:false};
  if(summary.reviewedProjection) {
    must(Object.keys(summary.reviewedProjection).length===2,'PUBLIC_PROJECTION_INVALID');
    safe.reviewedProjection=checkedProjection(summary.reviewedProjection.evidence,summary.reviewedProjection.prismaTransportProof);
    must(safe.reviewedProjection.evidence.runId===summary.runId&&safe.reviewedProjection.prismaTransportProof.evidenceSha256===summary.evidenceSha256&&sha256(canonical(safe.reviewedProjection.prismaTransportProof))===summary.proofSha256,'PUBLIC_PROJECTION_INVALID');
  }
  return safe;
}
export function publishCapture(summary,runnerRoot,io) { return place(runnerRoot,summary.runId,checkedCaptureSummary(summary),io); }
export function publishCache(summary,runnerRoot,io) {
  const keys=['event','status','phase','runId','serviceId','opsRevision','sourceBindingSha256','runnerSourceSha256','cacheManifestSha256','files','bytes','databaseMutation','applicationDeployment'];
  must(summary&&Object.keys(summary).length===keys.length&&keys.every(k=>Object.hasOwn(summary,k)),'PUBLIC_CACHE_INVALID');
  must(['CACHE_PREPARED','CACHE_ROUNDTRIP'].includes(summary.phase)&&summary.event==='RELEASE18_TOOLCHAIN_CACHE'&&summary.status==='PASSED'&&summary.serviceId===SERVICE&&summary.sourceBindingSha256===FROZEN_BINDING&&summary.opsRevision?.length===40&&COMMIT.test(summary.opsRevision)&&summary.databaseMutation===false&&summary.applicationDeployment===false,'PUBLIC_CACHE_INVALID');
  for(const key of ['runnerSourceSha256','cacheManifestSha256'])digest(summary[key]);
  must(Number.isSafeInteger(summary.files)&&summary.files>0&&summary.files<=15000&&Number.isSafeInteger(summary.bytes)&&summary.bytes>=0&&summary.bytes<=536870912,'PUBLIC_CACHE_INVALID');
  const safe={event:'RELEASE18_TOOLCHAIN_CACHE',status:'PASSED',phase:summary.phase,runId:summary.runId,serviceId:SERVICE,opsRevision:summary.opsRevision,sourceBindingSha256:FROZEN_BINDING,runnerSourceSha256:summary.runnerSourceSha256,cacheManifestSha256:summary.cacheManifestSha256,files:summary.files,bytes:summary.bytes,databaseMutation:false,applicationDeployment:false};
  return place(runnerRoot,summary.runId,safe,io);
}

function privateDirectory(dir) {
  directory(dir);
  if(process.platform==='linux')must(fs.statSync(dir).uid===process.getuid()&&(fs.statSync(dir).mode&0o077)===0,'QUARANTINE_DIRECTORY_INVALID');
}
export function revokeCapturePublication(summary,runnerRoot,io=fs) {
  const safe=checkedCaptureSummary(summary),runId=safe.runId;
  const root=path.resolve(runnerRoot,'../public-result');
  if(!io.existsSync(root))io.mkdirSync(root,{mode:0o755});
  directory(root);
  if(process.platform==='linux')must(fs.statSync(root).uid===process.getuid()&&(fs.statSync(root).mode&0o022)===0,'PUBLIC_DIRECTORY_PERMISSIONS_INVALID');
  const quarantineBase=path.resolve(runnerRoot,'../.release18-rejected-output');
  if(!io.existsSync(quarantineBase))io.mkdirSync(quarantineBase,{mode:0o700});
  privateDirectory(quarantineBase);
  const quarantine=path.join(quarantineBase,runId);
  must(!io.existsSync(quarantine),'PUBLIC_QUARANTINE_ALREADY_EXISTS');
  io.mkdirSync(quarantine,{mode:0o700});privateDirectory(quarantine);
  const record='result-'+runId+'.json',json=canonical(safe)+'\n',html=successHtml(record,json);
  let count=0;
  for(const [name,expected] of [[record,json],['.index-'+runId+'.pending',html],['index.html',html]]) {
    const source=path.join(root,name);
    if(!io.existsSync(source))continue;
    const bytes=readRegular(source,1048576);
    must(sha256(bytes)===sha256(expected),'PUBLIC_OUTPUT_OWNERSHIP_UNKNOWN');
    const target=path.join(quarantine,name);
    must(!io.existsSync(target),'PUBLIC_QUARANTINE_ALREADY_EXISTS');
    io.renameSync(source,target);count++;
  }
  const failed={event:'RELEASE18_TRANSPORT_CAPTURE',status:'FAILED_OR_UNKNOWN',runId,proofAvailable:false,databaseMutation:false,applicationDeployment:false};
  const failedName='failed-'+runId+'.json',failedJson=canonical(failed)+'\n';
  io.writeFileSync(path.join(root,failedName),failedJson,{flag:'wx',mode:0o644});
  const pending=path.join(root,'.failed-'+runId+'.pending');
  io.writeFileSync(pending,'<!doctype html><meta charset="utf-8"><title>Stage preparation failed</title><h1>Stage preparation failed</h1><p>FAILED_OR_UNKNOWN. No usable proof. Independent disposition required.</p><a href="'+failedName+'">Minimized failure result</a>\n',{flag:'wx',mode:0o644});
  must(!io.existsSync(path.join(root,'index.html')),'PUBLIC_OUTPUT_OWNERSHIP_UNKNOWN');
  io.renameSync(pending,path.join(root,'index.html'));
  return {status:'REVOKED',successFilesQuarantined:count,failedOutputPrepared:true};
}
