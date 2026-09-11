export type QueuedAnalyticsEvent = { id: string; timestamp: string; [key: string]: unknown };
export type AnalyticsAck = { acceptedIds: string[]; rejected: { id: string | null; code: string }[]; retryableIds?: string[] };
export const ANALYTICS_TTL_MS = 24 * 60 * 60 * 1000;
export const ANALYTICS_MAX_EVENTS = 200;
export const ANALYTICS_ACTOR_KEY = 'si_analytics_actor_v3';
const PREFIX = 'si_pending_analytics_v3:';
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
type ActorEpoch = { actor: string | null; epoch: string };
type Sender = (batch: QueuedAnalyticsEvent[], signal: AbortSignal, expectedActorId: string) => Promise<AnalyticsAck>;

// A deterministic namespace lets simultaneous logins from the same predecessor share pending events.
// This is a local storage identifier; the server authenticates the actor independently.
function nextActorEpoch(previous: string | undefined, actor: string) {
  let hash = 144066263297769815596495629667062367629n;
  for (const character of JSON.stringify([previous ?? null, actor])) {
    hash = BigInt.asUintN(128, (hash ^ BigInt(character.codePointAt(0)!)) * 309485009821345068724781371n);
  }
  return hash.toString(16).padStart(32, '0');
}

export class AnalyticsQueue {
  private binding: ActorEpoch | null = null;
  // Only failed storage writes live here. Never re-persist an acknowledged shared entry from a stale cache.
  private memory = new Map<string, QueuedAnalyticsEvent>();
  private shared = false;
  private fenced = false;
  private generation = 0;
  private sending: Promise<void> | null = null;
  private abort: AbortController | null = null;

  constructor(private readonly storage: Store | undefined, private readonly send: Sender, private readonly now = Date.now) {}

  private readActor(): ActorEpoch | null {
    const parsed = JSON.parse(this.storage?.getItem(ANALYTICS_ACTOR_KEY) || 'null');
    if (!parsed) return null;
    if ((parsed.actor !== null && typeof parsed.actor !== 'string') || typeof parsed.epoch !== 'string' || !parsed.epoch) throw new Error('Invalid analytics actor marker');
    return { actor: parsed.actor, epoch: parsed.epoch };
  }

  private invalidate() {
    this.abort?.abort();
    this.abort = null;
    this.sending = null;
    this.generation++;
    this.memory.clear();
    this.fenced = true;
  }

  private isCurrent() {
    if (!this.binding || this.fenced) return false;
    try {
      const current = this.readActor();
      if (current ? current.actor !== this.binding.actor || current.epoch !== this.binding.epoch : this.shared) {
        this.invalidate();
        return false;
      }
    } catch {
      // If storage worked before, an unreadable identity must not silently authorize a send.
      if (this.shared) { this.invalidate(); return false; }
    }
    return true;
  }

  private namespace() {
    return PREFIX + encodeURIComponent(this.binding!.actor!) + ':' + this.binding!.epoch + ':';
  }

  private keys() {
    const keys = new Set<string>();
    for (let i = 0; this.storage && i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (key) keys.add(key);
    }
    return [...keys];
  }

  private remove(key: string) {
    if (!this.isCurrent()) return;
    try { this.storage?.removeItem(key); } catch { /* Expiry and later retries remain bounded in memory. */ }
  }

  private valid(event: QueuedAnalyticsEvent) {
    if (!event || typeof event.id !== 'string' || !event.id || typeof event.timestamp !== 'string') return false;
    const timestamp = Date.parse(event.timestamp), now = this.now();
    return Number.isFinite(timestamp) && now - timestamp <= ANALYTICS_TTL_MS && timestamp <= now + 60000 && JSON.stringify(event).length <= 4096;
  }

  setActor(actor: string | null) {
    // Repeated calls from a stale view cannot re-adopt an account after another tab's logout/login.
    if (actor !== null && this.binding?.actor === actor) { this.isCurrent(); return; }
    this.invalidate();
    let current: ActorEpoch | null = null;
    try { current = this.readActor(); } catch { /* Storage may be disabled from the start. */ }
    const binding = actor !== null && current?.actor === actor ? current : { actor, epoch: actor === null ? crypto.randomUUID() : nextActorEpoch(current?.epoch, actor) };
    this.binding = binding;
    this.shared = false;
    this.fenced = false;
    try {
      if (this.storage) {
        // Joining this epoch must not overwrite a logout marker written concurrently by another tab.
        if (binding !== current) this.storage.setItem(ANALYTICS_ACTOR_KEY, JSON.stringify(binding));
        this.shared = true;
      }
    } catch {
      // Quota must not leave the old account authorized. Removal also notifies other tabs to abort.
      try { this.storage?.removeItem(ANALYTICS_ACTOR_KEY); } catch { /* isCurrent fails closed if the previous identity remains. */ }
    }
    if (!this.isCurrent()) return;
    const namespace = actor === null ? null : this.namespace();
    try {
      for (const key of this.keys()) {
        if ((key.startsWith(PREFIX) && (!namespace || !key.startsWith(namespace))) || key.startsWith('si_pending_analytics_v2:')) this.remove(key);
      }
    } catch { /* Memory-only mode remains available. */ }
    this.pending();
  }

  handleStorageChange(key: string | null) {
    if (key === null || key === ANALYTICS_ACTOR_KEY) this.isCurrent();
  }

  enqueue(event: QueuedAnalyticsEvent) {
    if (!this.binding?.actor || !this.isCurrent()) return;
    let copy: QueuedAnalyticsEvent;
    try { if (!this.valid(event)) return; copy = JSON.parse(JSON.stringify(event)); } catch { return; }
    if (this.memory.has(copy.id)) return;
    const key = this.namespace() + encodeURIComponent(copy.id);
    try {
      // IDs are immutable. Each key changes independently, so another tab's enqueue/ACK is never overwritten.
      if (this.storage?.getItem(key)) return;
      if (!this.isCurrent()) return;
      if (this.storage) { this.storage.setItem(key, JSON.stringify(copy)); this.memory.delete(copy.id); }
      else if (!this.memory.has(copy.id)) this.memory.set(copy.id, copy);
    } catch { if (!this.memory.has(copy.id)) this.memory.set(copy.id, copy); }
    if (!this.isCurrent()) {
      try { this.storage?.removeItem(key); } catch { /* This old epoch is no longer readable by any active queue. */ }
      return;
    }
    this.pending();
  }

  pending(): QueuedAnalyticsEvent[] {
    if (!this.binding?.actor || !this.isCurrent()) return [];
    const namespace = this.namespace(), items = new Map<string, QueuedAnalyticsEvent>();
    try {
      for (const key of this.keys()) {
        if (!key.startsWith(namespace)) continue;
        try {
          const event = JSON.parse(this.storage!.getItem(key) || 'null');
          if (this.valid(event) && key === namespace + encodeURIComponent(event.id)) items.set(event.id, event);
          else this.remove(key);
        } catch { this.remove(key); }
      }
    } catch { /* Use events whose writes failed when storage is unavailable. */ }
    for (const [id, event] of this.memory) {
      if (!this.valid(event)) this.memory.delete(id);
      else if (!items.has(id)) items.set(id, event);
    }
    const sorted = [...items.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.id.localeCompare(b.id));
    for (const event of sorted.slice(0, Math.max(0, sorted.length - ANALYTICS_MAX_EVENTS))) {
      this.memory.delete(event.id);
      this.remove(namespace + encodeURIComponent(event.id));
    }
    if (!this.isCurrent()) return [];
    return sorted.slice(-ANALYTICS_MAX_EVENTS).map(event => JSON.parse(JSON.stringify(event)));
  }

  flush(): Promise<void> {
    if (!this.isCurrent()) return Promise.resolve();
    if (this.sending) return this.sending;
    const batch = this.pending().slice(0, 50);
    if (!this.binding?.actor || !batch.length) return Promise.resolve();
    const generation = this.generation, expectedActorId = this.binding.actor, namespace = this.namespace();
    const ids = new Set(batch.map(event => event.id)), abort = new AbortController();
    this.abort = abort;
    this.sending = (async () => {
      // Also makes synchronous send failures settle after this.sending has been assigned.
      await Promise.resolve();
      try {
        if (generation !== this.generation || !this.isCurrent() || abort.signal.aborted) return;
        const ack = await this.send(batch, abort.signal, expectedActorId);
        if (generation !== this.generation || !this.isCurrent() || abort.signal.aborted || !ack || !Array.isArray(ack.acceptedIds) || !Array.isArray(ack.rejected)) return;
        const removed = new Set([...ack.acceptedIds, ...ack.rejected.map(event => event?.id)].filter((id): id is string => typeof id === 'string' && ids.has(id)));
        for (const id of removed) {
          if (generation !== this.generation || !this.isCurrent()) return;
          this.memory.delete(id);
          this.remove(namespace + encodeURIComponent(id));
        }
      } catch { /* Keep until a per-ID acknowledgement or bounded expiry. */ }
      finally { if (generation === this.generation) { this.sending = null; this.abort = null; } }
    })();
    return this.sending;
  }
}
