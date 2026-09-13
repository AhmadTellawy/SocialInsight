import { useRef, useState } from 'react';
import type { Survey } from '../types';

type SavePost = (data: Partial<Survey>) => void | Promise<void>;

// The caller owns navigation: a rejected save must never close the editor.
export function usePostSaveFeedback(persistPost: SavePost, persistDraft: SavePost | undefined,
  message: (key: string) => string) {
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const saving = useRef(false);
  const save = async (data: Partial<Survey>, draft: boolean) => {
    if (saving.current) throw new Error(message('postOptions.saving'));
    saving.current = true;
    setIsSaving(true);
    setError(null);
    try {
      const persist = draft ? persistDraft : persistPost;
      if (!persist) throw new Error(message('postOptions.saveUnavailable'));
      await persist(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : message(draft ? 'postOptions.draftFailed' : 'postOptions.publishFailed'));
      throw cause;
    } finally {
      saving.current = false;
      setIsSaving(false);
    }
  };
  return { error, isSaving, onSubmit: (data: Partial<Survey>) => save(data, false), onSaveDraft: (data: Partial<Survey>) => save(data, true) };
}
