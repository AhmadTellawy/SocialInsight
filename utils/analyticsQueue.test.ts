import assert from 'node:assert/strict';
import test from 'node:test';
import { AnalyticsQueue, ANALYTICS_ACTOR_KEY, ANALYTICS_MAX_EVENTS, ANALYTICS_TTL_MS, type AnalyticsAck } from './analyticsQueue.ts';

class MemoryStore {
  map = new Map<string, string>();
  get length() { return this.map.size; }
  key(index: number) { return [...this.map.keys()][index] ?? null; }
  getItem(key: string) { return this.map.get(key) ?? null; }
  setItem(key: string, value: string) { this.map.set(key, value); }
  removeItem(key: string) { this.map.delete(key); }
}
const NOW = Date.now();
const event = (id: string, now = NOW) => ({ id, timestamp: new Date(now).toISOString(), event_type: 'PROFILE_VISIT' });
const ack = (acceptedIds: string[] = []): AnalyticsAck => ({ acceptedIds, rejected: [] });
const ids = (queue: AnalyticsQueue) => queue.pending().map(item => item.id).sort();
const deferred = () => {
  let resolve!: (value: AnalyticsAck) => void;
  const promise = new Promise<AnalyticsAck>(complete => { resolve = complete; });
  return { promise, resolve };
};

test('offline queue survives reopen and removes only acknowledged IDs', async () => {
  const store = new MemoryStore();
  const queue = new AnalyticsQueue(store, async () => { throw Error('offline'); });
  queue.setActor('a'); queue.enqueue(event('one')); queue.enqueue(event('two'));
  await queue.flush(); assert.equal(queue.pending().length, 2);
  const restored = new AnalyticsQueue(store, async () => ({ ...ack(['one', 'foreign']), retryableIds: ['two'] }));
  restored.setActor('a'); assert.equal(restored.pending().length, 2);
  await restored.flush(); assert.deepEqual(ids(restored), ['two']);
  assert.deepEqual(ids(queue), ['two']);
});

test('lost response retries exact IDs and terminal rejection removes only its entry', async () => {
  const saved = new Set<string>(); let calls = 0;
  const queue = new AnalyticsQueue(new MemoryStore(), async batch => {
    calls++; for (const item of batch) saved.add(item.id);
    if (calls === 1) throw Error('response lost');
    return { acceptedIds: ['one'], rejected: [{ id: 'bad', code: 'INVALID_EVENT' }] };
  });
  queue.setActor('a'); queue.enqueue(event('one')); queue.enqueue(event('bad'));
  await queue.flush(); assert.equal(queue.pending().length, 2);
  await queue.flush(); assert.equal(saved.size, 2); assert.equal(queue.pending().length, 0);
});

test('logout aborts in-flight delivery and stale acknowledgement cannot remove next-account events', async () => {
  const result = deferred(); let signal: AbortSignal | undefined;
  const store = new MemoryStore();
  const queue = new AnalyticsQueue(store, (_batch, sentSignal, actor) => {
    assert.equal(actor, 'a'); signal = sentSignal; return result.promise;
  });
  queue.setActor('a'); queue.enqueue(event('same'));
  const pending = queue.flush(); await Promise.resolve();
  queue.setActor(null); assert.equal(signal?.aborted, true);
  queue.setActor('b'); queue.enqueue(event('same'));
  result.resolve(ack(['same'])); await pending;
  assert.deepEqual(ids(queue), ['same']);
  assert.equal([...store.map.keys()].some(key => key.startsWith('si_pending_analytics_v3:a:')), false);
});

test('size and age are bounded and initial logged-out cleanup leaves only a revocation marker', () => {
  let now = NOW; const store = new MemoryStore();
  const queue = new AnalyticsQueue(store, async () => ack(), () => now);
  queue.setActor('a');
  for (let i = 0; i < ANALYTICS_MAX_EVENTS + 20; i++) queue.enqueue(event(String(i), now));
  assert.equal(queue.pending().length, ANALYTICS_MAX_EVENTS);
  now += ANALYTICS_TTL_MS + 1; queue.enqueue(event('fresh', now));
  assert.deepEqual(ids(queue), ['fresh']);
  const loggedOut = new AnalyticsQueue(store, async () => ack()); loggedOut.setActor(null);
  assert.deepEqual([...store.map.keys()], [ANALYTICS_ACTOR_KEY]);
  assert.equal(JSON.parse(store.getItem(ANALYTICS_ACTOR_KEY)!).actor, null);
});

test('concurrent flushes share a batch and newly queued events survive its ack', async () => {
  const result = deferred(); let sends = 0;
  const queue = new AnalyticsQueue(new MemoryStore(), () => { sends++; return result.promise; });
  queue.setActor('a'); queue.enqueue(event('one'));
  const first = queue.flush(), second = queue.flush(); assert.equal(first, second);
  queue.enqueue(event('two')); result.resolve(ack(['one'])); await first;
  assert.equal(sends, 1); assert.deepEqual(ids(queue), ['two']);
});

test('two instances retain independent enqueues and partial ACKs across reload without resurrecting entries', async () => {
  const store = new MemoryStore(), firstReply = deferred(), secondReply = deferred();
  const first = new AnalyticsQueue(store, (batch, _signal, actor) => {
    assert.equal(actor, 'a'); assert.deepEqual(batch.map(item => item.id), ['one', 'two']); return firstReply.promise;
  });
  const second = new AnalyticsQueue(store, (batch, _signal, actor) => {
    assert.equal(actor, 'a'); assert.deepEqual(batch.map(item => item.id).sort(), ['one', 'three', 'two']); return secondReply.promise;
  });
  first.setActor('a'); second.setActor('a');
  first.enqueue(event('one')); second.enqueue(event('two'));
  assert.deepEqual(ids(first), ['one', 'two']); assert.deepEqual(ids(second), ['one', 'two']);
  const firstSend = first.flush(); await Promise.resolve();
  second.enqueue(event('three')); const secondSend = second.flush(); await Promise.resolve();
  secondReply.resolve(ack(['two'])); await secondSend;
  firstReply.resolve(ack(['one'])); await firstSend;
  assert.deepEqual(ids(first), ['three']); assert.deepEqual(ids(second), ['three']);
  const reload = new AnalyticsQueue(store, async () => ack(['three'])); reload.setActor('a');
  assert.deepEqual(ids(reload), ['three']); await reload.flush();
  first.enqueue(event('four')); assert.deepEqual(ids(second), ['four']);
  assert.deepEqual(ids(reload), ['four']);
});

test('another tab logout storage event aborts active delivery and fences enqueue, pending, flush and ACK', async () => {
  const store = new MemoryStore(), result = deferred(); let signal: AbortSignal | undefined, sends = 0;
  const stale = new AnalyticsQueue(store, (_batch, sentSignal, actor) => {
    assert.equal(actor, 'a'); sends++; signal = sentSignal; return result.promise;
  });
  const active = new AnalyticsQueue(store, async () => ack());
  stale.setActor('a'); active.setActor('a'); stale.enqueue(event('same'));
  const sent = stale.flush(); await Promise.resolve(); active.setActor(null);
  stale.handleStorageChange(ANALYTICS_ACTOR_KEY); assert.equal(signal?.aborted, true);
  active.setActor('b'); active.enqueue(event('same'));
  stale.enqueue(event('after-logout')); stale.setActor('a');
  assert.deepEqual(ids(stale), []); await stale.flush(); assert.equal(sends, 1);
  result.resolve(ack(['same'])); await sent;
  assert.deepEqual(ids(active), ['same']);
  assert.equal(JSON.parse(store.getItem(ANALYTICS_ACTOR_KEY)!).actor, 'b');
});

test('stale ACK after logout and login to the same account cannot remove the new epoch event', async () => {
  const store = new MemoryStore(), result = deferred();
  const stale = new AnalyticsQueue(store, () => result.promise), active = new AnalyticsQueue(store, async () => ack());
  stale.setActor('a'); active.setActor('a'); stale.enqueue(event('same'));
  const sent = stale.flush(); await Promise.resolve();
  active.setActor(null); active.setActor('a'); active.enqueue(event('same'));
  result.resolve(ack(['same'])); await sent;
  assert.deepEqual(ids(stale), []); assert.deepEqual(ids(active), ['same']);
});

test('shared identity is checked without waiting for a storage event and again immediately before send', async () => {
  const store = new MemoryStore(); let sends = 0;
  const stale = new AnalyticsQueue(store, async () => { sends++; return ack(); });
  const active = new AnalyticsQueue(store, async () => ack());
  stale.setActor('a'); active.setActor('a'); stale.enqueue(event('one'));
  const sent = stale.flush(); active.setActor('b');
  await sent; assert.equal(sends, 0);
  stale.enqueue(event('old')); assert.deepEqual(ids(stale), []); assert.deepEqual(ids(active), []);
});

test('clearing storage aborts the old epoch and never revives its persisted entries', async () => {
  const store = new MemoryStore(), result = deferred(); let signal: AbortSignal | undefined;
  const queue = new AnalyticsQueue(store, (_batch, sentSignal) => { signal = sentSignal; return result.promise; });
  queue.setActor('a'); queue.enqueue(event('one')); const sent = queue.flush(); await Promise.resolve();
  store.map.clear(); queue.handleStorageChange(null); assert.equal(signal?.aborted, true);
  result.resolve(ack(['one'])); await sent; queue.enqueue(event('two'));
  assert.deepEqual(ids(queue), []); assert.equal(store.length, 0);
});

test('memory fallback supports bounded batches and per-ID ACKs when storage is absent or disabled', async () => {
  for (const store of [undefined, {
    get length(): number { throw Error('disabled'); }, key(): null { throw Error('disabled'); },
    getItem(): null { throw Error('disabled'); }, setItem() { throw Error('disabled'); }, removeItem() { throw Error('disabled'); }
  }]) {
    let batchSize = 0;
    const queue = new AnalyticsQueue(store, async (batch, _signal, actor) => {
      assert.equal(actor, 'a'); batchSize = batch.length; return ack(batch.map(item => item.id));
    });
    queue.setActor('a'); for (let i = 0; i < 60; i++) queue.enqueue(event(String(i)));
    await queue.flush(); assert.equal(batchSize, 50); assert.equal(queue.pending().length, 10);
    queue.setActor(null); assert.deepEqual(ids(queue), []);
  }
});

test('storage quota failure keeps new entries in memory without overwriting other tab persisted events', async () => {
  class QuotaStore extends MemoryStore {
    full = false;
    setItem(key: string, value: string) {
      if (this.full) throw Error('quota');
      super.setItem(key, value);
    }
  }
  const store = new QuotaStore();
  const first = new AnalyticsQueue(store, async batch => ack(batch.map(item => item.id))), second = new AnalyticsQueue(store, async () => ack());
  first.setActor('a'); second.setActor('a'); second.enqueue(event('persisted')); store.full = true;
  first.enqueue(event('memory')); assert.deepEqual(ids(first), ['memory', 'persisted']);
  await first.flush(); assert.deepEqual(ids(first), []); assert.deepEqual(ids(second), []);
});

test('invalid oversized and expired events are not queued and event IDs retain their first payload', () => {
  const queue = new AnalyticsQueue(new MemoryStore(), async () => ack(), () => NOW); queue.setActor('a');
  queue.enqueue(event('old', NOW - ANALYTICS_TTL_MS - 1)); queue.enqueue(event('future', NOW + 60001));
  queue.enqueue({ ...event('oversized'), value: 'x'.repeat(4096) });
  queue.enqueue({ ...event('same'), target: 'original' }); queue.enqueue({ ...event('same'), target: 'changed' });
  assert.deepEqual(ids(queue), ['same']); assert.equal(queue.pending()[0].target, 'original');
});

test('synchronous sender errors do not leave a permanently locked flush', async () => {
  let sends = 0;
  const queue = new AnalyticsQueue(new MemoryStore(), () => { sends++; throw Error('synchronous'); });
  queue.setActor('a'); queue.enqueue(event('one')); await queue.flush(); await queue.flush();
  assert.equal(sends, 2); assert.deepEqual(ids(queue), ['one']);
});


test('quota at logout revokes other tabs even when the new marker cannot be stored', async () => {
  class QuotaStore extends MemoryStore {
    full = false;
    setItem(key: string, value: string) { if (this.full) throw Error('quota'); super.setItem(key, value); }
  }
  const store = new QuotaStore(), result = deferred(); let signal: AbortSignal | undefined;
  const stale = new AnalyticsQueue(store, (_batch, sentSignal) => { signal = sentSignal; return result.promise; });
  const active = new AnalyticsQueue(store, async () => ack());
  stale.setActor('a'); active.setActor('a'); stale.enqueue(event('one'));
  const sent = stale.flush(); await Promise.resolve(); store.full = true; active.setActor(null);
  stale.handleStorageChange(ANALYTICS_ACTOR_KEY); assert.equal(signal?.aborted, true);
  result.resolve(ack(['one'])); await sent;
  assert.equal(store.length, 0); assert.deepEqual(ids(stale), []);
});

test('joining a shared epoch never overwrites a concurrent logout marker', () => {
  class InterleavedStore extends MemoryStore {
    logoutAfterRead = false;
    getItem(key: string) {
      const value = super.getItem(key);
      if (key === ANALYTICS_ACTOR_KEY && this.logoutAfterRead) {
        this.logoutAfterRead = false;
        super.setItem(key, JSON.stringify({ actor: null, epoch: 'logged-out' }));
      }
      return value;
    }
  }
  const store = new InterleavedStore(), first = new AnalyticsQueue(store, async () => ack());
  first.setActor('a'); first.enqueue(event('one')); store.logoutAfterRead = true;
  const joining = new AnalyticsQueue(store, async () => ack()); joining.setActor('a');
  joining.enqueue(event('two')); assert.deepEqual(ids(joining), []);
  assert.equal(JSON.parse(store.getItem(ANALYTICS_ACTOR_KEY)!).actor, null);
});

for (const initial of ['missing', 'logout'] as const) {
  test('simultaneous account initialization from ' + initial + ' marker preserves both tabs pending events', () => {
    class InterleavedInitializationStore extends MemoryStore {
      afterRead: (() => void) | undefined;
      getItem(key: string) {
        const value = super.getItem(key);
        if (key === ANALYTICS_ACTOR_KEY && this.afterRead) { const callback = this.afterRead; this.afterRead = undefined; callback(); }
        return value;
      }
    }
    const store = new InterleavedInitializationStore();
    if (initial === 'logout') new AnalyticsQueue(store, async () => ack()).setActor(null);
    const first = new AnalyticsQueue(store, async () => ack()), second = new AnalyticsQueue(store, async () => ack());
    store.afterRead = () => { second.setActor('a'); second.enqueue(event('second')); };
    first.setActor('a'); first.enqueue(event('first'));
    assert.deepEqual(ids(first), ['first', 'second']); assert.deepEqual(ids(second), ['first', 'second']);
    const reopened = new AnalyticsQueue(store, async () => ack()); reopened.setActor('a'); assert.deepEqual(ids(reopened), ['first', 'second']);
  });
}
