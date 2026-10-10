/** Short-lived, memory-only read cache. Never serialize private content to storage. */
export type InteractionPage<T> = { items: T[]; nextCursor: string | null; totalCount?: number };
export type InteractionEntry<T> = InteractionPage<T> & { updatedAt: number; version: number };
const entries = new Map<string, InteractionEntry<any>>();
const listeners = new Set<() => void>();
let generation = 0;
export const interactionKey = (viewer: string | undefined | null, kind: string, id: string) =>
  JSON.stringify([viewer || 'guest', kind, id]);
export const interactionGeneration = () => generation;
export const subscribeInteractions = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const emit = () => listeners.forEach(listener => listener());
export const readInteraction = <T>(key: string): InteractionEntry<T> | undefined => entries.get(key);
export const freshInteraction = <T>(key: string): InteractionEntry<T> | undefined => {
  const entry = readInteraction<T>(key);
  return entry && Date.now() - entry.updatedAt < 30_000 ? entry : undefined;
};
export const writeInteraction = <T>(key: string, page: InteractionPage<T>) => {
  const version = (entries.get(key)?.version || 0) + 1;
  entries.delete(key);
  entries.set(key, { ...page, version, updatedAt: Date.now() });
  while (entries.size > 80) entries.delete(entries.keys().next().value!);
  emit();
};
export const evictInteraction = (key: string) => { entries.delete(key); generation++; emit(); };
export const clearInteractions = () => { entries.clear(); generation++; emit(); };

/** A fresh feed/detail read can refresh cached counts, but an older read must
 * never roll back a comment mutation confirmed while that read was in flight. */
export const captureInteractionVersions = () => ({ generation, versions: new Map(Array.from(entries, ([key, entry]) => [key, entry.version])) });
export function reconcilePostCommentCounts(viewer: string | undefined, posts: any[], snapshot: ReturnType<typeof captureInteractionVersions>) {
  if (snapshot.generation !== generation) return;
  let changed = false;
  const apply = (post: any) => {
    if (!post) return;
    const key = interactionKey(viewer, 'comments', post.id);
    const entry = entries.get(key);
    if (entry && entry.version === snapshot.versions.get(key) && Number.isInteger(post.commentsCount) && post.commentsCount >= 0 && post.commentsCount !== entry.totalCount) {
      entries.set(key, { ...entry, totalCount: post.commentsCount, version: entry.version + 1 });
      changed = true;
    }
    if (post.sharedFrom) apply(post.sharedFrom);
  };
  posts.forEach(apply);
  if (changed) emit();
}
