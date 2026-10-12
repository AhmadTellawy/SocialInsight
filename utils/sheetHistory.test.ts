import test from 'node:test';
import assert from 'node:assert/strict';

async function fixture() {
  const target = new EventTarget();
  const entries = [{ state: { idx: 0, key: 'post' } as Record<string, unknown>, url: '/post/test' }];
  let index = 0;
  const pending: (() => void)[] = [];
  const history = {
    get state() { return entries[index].state; },
    pushState(state: Record<string, unknown>, _title: string, url?: string) {
      entries.splice(index + 1);
      entries.push({ state, url: url || entries[index].url }); index++;
    },
    replaceState(state: Record<string, unknown>, _title: string, url?: string) {
      entries[index] = { state, url: url || entries[index].url };
    },
    forward() {
      pending.push(() => {
        if (index >= entries.length - 1) return;
        index++;
        const event = new Event('popstate');
        Object.defineProperty(event, 'state', { value: history.state });
        target.dispatchEvent(event);
      });
    },
    back() {
      pending.push(() => {
        if (!index) return;
        index--;
        const event = new Event('popstate');
        Object.defineProperty(event, 'state', { value: history.state });
        target.dispatchEvent(event);
      });
    }
  };
  class Element {
    focused = false;
    blur() { this.focused = false; }
    focus() { this.focused = true; }
    matches() { return false; }
    contains(value: unknown) { return value === this; }
  }
  const saved = new Map(['window', 'history', 'document', 'HTMLElement'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, { window: target, history, document: { activeElement: null }, HTMLElement: Element });
  const module = await import('./sheetHistory.ts?test=' + Math.random());
  module.installSheetHistory();
  const routePops: string[] = [];
  target.addEventListener('popstate', () => routePops.push(entries[index].url));
  const flush = () => { let count = 0; while (pending.length) { assert.ok(++count < 20); pending.shift()!(); } };
  const restore = () => { for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } };
  return { module, history, flush, restore, routePops, url: () => entries[index].url };
}

test('return from an author through retired participant sheets updates the router', async () => {
  const f = await fixture();
  try {
    const release = f.module.registerSheetHistory({ id: 'participants', close() {}, element: () => null, disabled: () => false });
    f.history.pushState({ idx: 1, key: 'author' }, '', '/@author');
    release();
    f.history.back(); f.flush();
    assert.equal(f.url(), '/post/test');
    assert.deepEqual(f.routePops, ['/post/test']);
  } finally { f.restore(); }
});

test('closing nested sheets drains only sheet entries without remounting the route', async () => {
  const f = await fixture();
  try {
    const parent = f.module.registerSheetHistory({ id: 'comments', close() {}, element: () => null, disabled: () => false });
    const child = f.module.registerSheetHistory({ id: 'options', close() {}, element: () => null, disabled: () => false });
    child(); parent(); f.flush();
    assert.equal(f.url(), '/post/test');
    assert.deepEqual(f.routePops, []);
    f.history.pushState({ idx: 1, key: 'author' }, '', '/@author');
    f.history.back(); f.flush();
    assert.deepEqual(f.routePops, ['/post/test']);
  } finally { f.restore(); }
});

test('browser Back closes an open sheet without a router pop', async () => {
  const f = await fixture();
  try {
    let closed = 0;
    const release = f.module.registerSheetHistory({ id: 'likes', close() { closed++; }, element: () => null, disabled: () => false });
    f.history.back(); f.flush(); release(); f.flush();
    assert.equal(closed, 1);
    assert.deepEqual(f.routePops, []);
  } finally { f.restore(); }
});

test('a disabled sheet restores its consumed entry and remains open', async () => {
  const f = await fixture();
  try {
    let closed = 0;
    const release = f.module.registerSheetHistory({ id: 'submission', close() { closed++; }, element: () => null, disabled: () => true });
    f.history.back(); f.flush();
    assert.equal(closed, 0);
    assert.equal(f.history.state.__opiniupSheet, 'submission');
    assert.deepEqual(f.routePops, []);
    release(); f.flush();
    assert.deepEqual(f.routePops, []);
  } finally { f.restore(); }
});

for (const nested of [false, true]) test('Forward crosses retired sheets after Back, nested=' + nested, async () => {
  const f = await fixture();
  try {
    const parent = f.module.registerSheetHistory({ id: 'participants', close() {}, element: () => null, disabled: () => false });
    const child = nested ? f.module.registerSheetHistory({ id: 'participant-options', close() {}, element: () => null, disabled: () => false }) : undefined;
    f.history.pushState({ idx: 1, key: 'author' }, '', '/@author');
    child?.(); parent();
    f.history.back(); f.flush();
    assert.equal(f.url(), '/post/test');
    f.history.forward(); f.flush();
    assert.equal(f.url(), '/@author');
    f.history.back(); f.flush();
    assert.equal(f.url(), '/post/test');
    assert.deepEqual(f.routePops, ['/post/test', '/@author', '/post/test']);
  } finally { f.restore(); }
});

test('Back can escape a closed nested tail after Forward reaches the end', async () => {
 const f=await fixture();try {
  f.history.replaceState({idx:0,key:'home'},'', '/');f.history.pushState({idx:1,key:'post'},'', '/post/test');
  const a=f.module.registerSheetHistory({id:'parent',close(){},element:()=>null,disabled:()=>false});
  const b=f.module.registerSheetHistory({id:'child',close(){},element:()=>null,disabled:()=>false});
  b();a();f.flush();f.history.forward();f.flush();f.history.back();f.flush();f.history.back();f.flush();
  assert.equal(f.url(),'/');assert.equal(f.routePops.at(-1),'/');
 }finally{f.restore();}
});
test('Back crosses retired sheets after route replacement keeps the same router index',async()=>{
 const f=await fixture();try{
  f.history.replaceState({idx:0,key:'home'},'', '/');f.history.pushState({idx:1,key:'post'},'', '/post/test');
  const a=f.module.registerSheetHistory({id:'parent',close(){},element:()=>null,disabled:()=>false});
  const b=f.module.registerSheetHistory({id:'child',close(){},element:()=>null,disabled:()=>false});
  f.history.replaceState({idx:1,key:'author'},'','/@author');b();a();f.flush();
  f.history.back();f.flush();assert.equal(f.url(),'/post/test');assert.equal(f.routePops.at(-1),'/post/test');
  f.history.forward();f.flush();assert.equal(f.url(),'/@author');
 }finally{f.restore();}
});
