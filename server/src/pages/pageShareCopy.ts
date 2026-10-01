/** Remove a copied Page fragment while preserving text independently added by a share author. */
export function withoutCopiedPageText(value: string, copied: string | null | undefined): string {
  if (!copied) return value;
  return value.split(copied).join('');
}

type ShareSource = { id: string; pageId: string | null; sharedFromId: string | null; sharedRootPageId: string | null };

export function canonicalShareSourceId(source: ShareSource): string {
  return source.pageId ? source.id : (source.sharedFromId || source.id);
}

export function copiedPageRootId(source: ShareSource, canonicalPageId: string | null): string | null {
  return source.pageId || canonicalPageId || source.sharedRootPageId;
}
