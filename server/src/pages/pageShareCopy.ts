/** Copied fields on Page-derived shares are immutable; captions hold authored text. */
export function withoutCopiedPageText(value: string, copied: string | null | undefined): string {
  return copied == null ? value : '';
}

type ShareSource = { id: string; pageId: string | null; sharedFromId: string | null; sharedRootPageId: string | null };

export function canonicalShareSourceId(source: ShareSource): string {
  return source.pageId ? source.id : (source.sharedFromId || source.id);
}

export function copiedPageRootId(source: ShareSource, canonicalPageId: string | null): string | null {
  return source.pageId || canonicalPageId || source.sharedRootPageId;
}
