import type {Prisma} from '@prisma/client';
import {AggregateResults} from './aggregateResults';
import {AnalysisResults} from './analysisResults';
export type AnalysisSnapshot={overall:ReturnType<AggregateResults['toJSON']>;analysis:AnalysisResults|null;bytes:number};
const entries=new Map<string,{value:AnalysisSnapshot;at:number}>();
let bytes=0;
const MAX_BYTES=32*1024*1024;
export async function analysisCacheKey(client:Pick<Prisma.TransactionClient,'$queryRaw'>,postId:string,scope:string){
  if(process.env.ANALYSIS_CACHE_ENABLED!=='true')return null;
  const rows=await client.$queryRaw<Array<{revision:string}>>`SELECT
    COALESCE((SELECT revision::text FROM public."AnalysisRevision" WHERE key=${'post:'+postId}),'0') || ':' ||
    COALESCE((SELECT revision::text FROM public."AnalysisRevision" WHERE key='demographics'),'0') AS revision`;
  return JSON.stringify([postId,scope,rows[0].revision,new Date().toISOString().slice(0,10)]);
}
export function readAnalysisSnapshot(key:string|null){
  if(!key)return undefined;const entry=entries.get(key);if(!entry)return undefined;
  if(Date.now()-entry.at>30000){bytes-=entry.value.bytes;entries.delete(key);return undefined;}
  entries.delete(key);entries.set(key,entry);return entry.value;
}
export function writeAnalysisSnapshot(key:string|null,value:AnalysisSnapshot){
  if(!key || !value.analysis || value.bytes>MAX_BYTES/2)return;
  bytes-=entries.get(key)?.value.bytes || 0;entries.delete(key);entries.set(key,{value,at:Date.now()});bytes+=value.bytes;
  while(entries.size>12 || bytes>MAX_BYTES){const oldest=entries.keys().next().value!;bytes-=entries.get(oldest)!.value.bytes;entries.delete(oldest);}
}

const pending=new Map<string,Promise<AnalysisSnapshot>>();
/** Shared aggregate construction is scoped by actor, authority and database revision. */
export async function sharedAnalysisSnapshot(key:string|null,build:()=>Promise<AnalysisSnapshot>):Promise<AnalysisSnapshot>{
  const cached=readAnalysisSnapshot(key);if(cached)return cached;
  if(!key)return build();
  const existing=pending.get(key);if(existing)return existing;
  if(pending.size>=24)return build();
  const promise=build().then(value=>{writeAnalysisSnapshot(key,value);return value;}).finally(()=>{if(pending.get(key)===promise)pending.delete(key);});
  pending.set(key,promise);return promise;
}

export class AnalysisBusyError extends Error {
  constructor() { super('ANALYSIS_BUSY'); }
}

/** Queue before opening a transaction: waiting reads must not occupy pool slots
 * or start authorization snapshots. The queue stores work only, never results. */
export function createAnalysisAdmission(limit = 2, maxQueued = 32, waitMs = 30_000) {
  let active = 0;
  type Waiter = { resolve: () => void; timer: ReturnType<typeof setTimeout> };
  const waiting: Waiter[] = [];
  return async function admit<T>(work: () => Promise<T>): Promise<T> {
    if (active < limit) active++;
    else {
      if (waiting.length >= maxQueued) throw new AnalysisBusyError();
      await new Promise<void>((resolve, reject) => {
        const waiter: Waiter = { resolve, timer: setTimeout(() => {
          const index = waiting.indexOf(waiter);
          if (index >= 0) waiting.splice(index, 1);
          reject(new AnalysisBusyError());
        }, waitMs) };
        waiting.push(waiter);
      });
    }
    try { return await work(); }
    finally {
      const next = waiting.shift();
      if (next) { clearTimeout(next.timer); next.resolve(); }
      else active--;
    }
  };
}

export const withAnalysisAdmission = createAnalysisAdmission();
