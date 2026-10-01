import type { Survey } from '../types';
import type { PageCardProps } from '../components/pages/PagesWorkspace';

export type PageLikeState = { isLiked: boolean; likes: number };
export type PageLikeResult = void | boolean | PageLikeState;

/** Serializes one card's toggles and explicitly settles even unchanged DTO values. */
export async function settlePageLike(lock: { current: boolean }, previous: PageLikeState,
  submit: () => PageLikeResult | Promise<PageLikeResult>, apply: (state: PageLikeState) => void,
  failed: () => void) {
  if (lock.current) return;
  lock.current = true;
  apply({ isLiked: !previous.isLiked, likes: Math.max(0, previous.likes + (previous.isLiked ? -1 : 1)) });
  try {
    const result = await submit();
    if (result === false) throw new Error('Page like was not confirmed');
    if (result && typeof result === 'object') apply(result);
  } catch {
    apply(previous);
    failed();
  } finally { lock.current = false; }
}

export async function settlePageVote(submit: () => ReturnType<NonNullable<PageCardProps['onVote']>>, rollback: () => void) {
  try { const result = await submit(); if (result === false) rollback(); return result; }
  catch { rollback(); return false; }
}

/** Replace the complete visible DTO so redacted results never survive a refresh. */
export function replacePagePost(posts: Survey[], fresh: Survey): Survey[] {
  return posts.map(post => post.id !== fresh.id ? post : {
    ...fresh,
    ...(!fresh.hasParticipated && post.userProgress ? { userProgress: post.userProgress } : {}),
    ...(fresh.sharedFrom && !fresh.sharedFrom.hasParticipated && post.sharedFrom?.userProgress
      ? { sharedFrom: { ...fresh.sharedFrom, userProgress: post.sharedFrom.userProgress } } : {})
  });
}

export function updatePageProgress(posts: Survey[], id: string, progress: Parameters<NonNullable<PageCardProps['onSurveyProgress']>>[1]): Survey[] {
  const update = (post: Survey): Survey => ({ ...post, userProgress: {
    currentQuestionIndex: progress.index, answers: progress.answers,
    followUpAnswers: progress.followUpAnswers || {}, historyStack: progress.historyStack || [],
    isAnonymous: progress.isAnonymous ?? post.userProgress?.isAnonymous ?? false
  } });
  return posts.map(post => post.id === id ? update(post) : post.sharedFrom?.id === id
    ? { ...post, sharedFrom: update(post.sharedFrom) } : post);
}

/** Parent mutations retain ownership of API writes. Reconcile only after they settle. */
export function pageCardCallbacks(parent: PageCardProps, actions: {
  refresh: (id: string) => Promise<void | false | Survey[]>;
  progress: NonNullable<PageCardProps['onSurveyProgress']>;
  remove: NonNullable<PageCardProps['onDelete']>;
  error: (error: unknown) => void;
}): PageCardProps {
  return {
    ...parent,
    onVote: parent.onVote ? async (...args) => {
      try { return await parent.onVote!(...args); }
      catch (error) { actions.error(error); return false; }
      finally { await actions.refresh(args[0]); }
    } : undefined,
    onLike: parent.onLike ? async (id, liked) => {
      let result: PageLikeResult = false;
      try { result = await parent.onLike!(id, liked); }
      catch (error) { actions.error(error); }
      try {
        const refreshed = await actions.refresh(id);
        if (refreshed === false) return false;
        if (Array.isArray(refreshed)) {
          const direct = refreshed.find(post => post.id === id);
          const target = direct || refreshed.find(post => post.sharedFrom?.id === id)?.sharedFrom;
          return target ? { isLiked: !!target.isLiked, likes: target.likes || 0 } : false;
        }
        return result;
      } catch (error) { actions.error(error); return false; }
    } : undefined,
    onSurveyProgress: (id, progress) => {
      actions.progress(id, progress);
      parent.onSurveyProgress?.(id, progress);
    },
    onShareToFeed: parent.onShareToFeed ? async (...args) => {
      try { return await parent.onShareToFeed!(...args); }
      finally { await actions.refresh(args[0].id); }
    } : undefined,
    onSaveChange: (id, saved) => {
      parent.onSaveChange?.(id, saved);
      void actions.refresh(id);
    },
    onDelete: (id, ids) => {
      actions.remove(id, ids);
      parent.onDelete?.(id, ids);
    }
  };
}
