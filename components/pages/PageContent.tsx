import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BusinessPage, pageRequest } from '../../services/pagesApi';
import { normalizeSurvey, Survey } from '../../types';
import type { PageCardProps } from './PagesWorkspace';
import { SurveyCard } from '../SurveyCard';
import { PostAnalysis } from '../PostAnalysis';
import { PageEmpty, PageError, PageLoading, usePageText } from './PageUi';
import { ApiError, authFetch, getGuestId } from '../../services/api';
import { pageCardCallbacks, replacePagePost, updatePageProgress } from '../../utils/pageCardState';

/** Both public and managed lists own state independently from App's feed. */
export function usePageCardState(posts: Survey[], setPosts: React.Dispatch<React.SetStateAction<Survey[]>>,
  cardProps: PageCardProps, setError: (error: unknown) => void, scope: string, managementPageId?: string) {
  const current = useRef({ posts, scope });
  current.current = { posts, scope };
  const requests = useRef(new Map<string, AbortController>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requests.current.forEach(controller => controller.abort());
      requests.current.clear();
    };
  }, [scope]);
  const refresh = async (targetId: string) => {
    if (!mounted.current || current.current.scope !== scope) return false as const;
    // Re-fetch each visible wrapper through its own access boundary, never inject
    // a canonical DTO into a wrapper that may have become inaccessible.
    const ids = current.current.posts.filter(post => post.id === targetId || post.sharedFrom?.id === targetId).map(post => post.id);
    const refreshed = await Promise.all(ids.map(async id => {
      requests.current.get(id)?.abort();
      const controller = new AbortController(); requests.current.set(id, controller);
      try {
        let raw: unknown;
        if (managementPageId) raw = await pageRequest('/manage/' + managementPageId + '/content/' + id, 'GET', undefined, controller.signal);
        else {
          const params = cardProps.userProfile?.id ? '' : '?guestId=' + encodeURIComponent(getGuestId());
          const response = await authFetch('/api/posts/' + encodeURIComponent(id) + params, { signal: controller.signal, cache: 'no-store' });
          if (!response.ok) throw new ApiError('Page post unavailable', response.status);
          raw = await response.json();
        }
        if (!controller.signal.aborted && current.current.scope === scope) {
          const fresh = normalizeSurvey(raw);
          setPosts(previous => replacePagePost(previous, fresh));
          return fresh;
        }
      } catch (error) {
        if (controller.signal.aborted || current.current.scope !== scope) return;
        if (error instanceof ApiError && [401, 403, 404].includes(error.status)) setPosts(previous => previous.filter(post => post.id !== id));
        setError(error);
      } finally {
        if (requests.current.get(id) === controller) requests.current.delete(id);
      }
    }));
    return refreshed.length && refreshed.every((post): post is Survey => !!post) ? refreshed : false as const;
  };
  return pageCardCallbacks(cardProps, {
    refresh, error: setError,
    progress: (id, progress) => setPosts(previous => updatePageProgress(previous, id, progress)),
    remove: (id, ids) => {
      const deleted = new Set([id, ...(ids || [])]);
      setPosts(previous => previous.filter(post => !deleted.has(post.id)));
    }
  });
}

export function PageContent({page,cardProps}:{page:BusinessPage;cardProps:PageCardProps}){
  const {text,ar}=usePageText();const [status,setStatus]=useState('PUBLISHED'),[posts,setPosts]=useState<Survey[]>([]),[next,setNext]=useState<string|null>(null);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null);
  const [analysis,setAnalysis]=useState<string|null>(null);
  const liveCardProps=usePageCardState(posts,setPosts,cardProps,setError,[page.id,page.role,status,cardProps.userProfile?.id].join(':'),page.id);
  const load=useCallback(async(cursor='',signal?:AbortSignal)=>{
    setError(null);if(!cursor)setLoading(true);else setBusy(true);
    try{const result=await pageRequest<{items:any[];nextCursor:string|null}>('/manage/'+page.id+'/content?status='+status+(cursor?'&cursor='+encodeURIComponent(cursor):''),'GET',undefined,signal);
      if(!signal?.aborted){setPosts(previous=>cursor?[...previous,...result.items.map(normalizeSurvey)]:result.items.map(normalizeSurvey));setNext(result.nextCursor);}}
    catch(error){if(!signal?.aborted){setError(error);setPosts([]);setNext(null);}}finally{if(!signal?.aborted){setLoading(false);setBusy(false);}}
  },[page.id,page.role,status]);
  useEffect(()=>{const abort=new AbortController();void load('',abort.signal);return()=>abort.abort();},[load]);
  return <section><div className="pages-row"><h2>{text('Page content','محتوى الصفحة')}</h2><select className="pages-button" aria-label={text('Content status','حالة المحتوى')} value={status} onChange={event=>setStatus(event.target.value)}><option value="PUBLISHED">{text('Published','منشور')}</option>{page.role!=='ANALYST'&&<option value="DRAFT">{text('Drafts','المسودات')}</option>}</select></div>
    {error&&<PageError error={error} retry={()=>void load()}/>}{loading?<PageLoading/>:posts.length?<div className="pages-posts" style={{maxWidth:660,margin:'auto'}}>{posts.map(post=><article key={post.id}>
      {(post as any).managementLastActor&&<p className="pages-muted">{text('Last managed by','آخر إجراء بواسطة')} {(post as any).managementLastActor.name} · {new Date((post as any).managementLastActor.at).toLocaleString(ar?'ar':'en')}</p>}
      {status==='DRAFT'?<div className="pages-panel pages-panel-body"><p className="pages-kicker">{post.type}</p><h3>{post.title}</h3>{page.capabilities?.includes('manageContent')&&<button className="pages-button primary" onClick={()=>cardProps.onEditDraft?.(post)}>{text('Continue editing','متابعة التحرير')}</button>}</div>:<SurveyCard {...liveCardProps} privatePageContext survey={post}/>}
      {status==='PUBLISHED'&&<><button className="pages-button" onClick={()=>setAnalysis(analysis===post.id?null:post.id)}>{analysis===post.id?text('Close results','إغلاق النتائج'):text('View results','عرض النتائج')}</button>{analysis===post.id&&<PostAnalysis survey={post} privatePageId={page.id}/>}</>}
    </article>)}</div>:!error&&<PageEmpty title={text('No content here yet','لا يوجد محتوى هنا بعد')} description={text('Create content using the app’s existing post types and settings.','أنشئ المحتوى باستخدام أنواع المنشورات وإعداداتها الموجودة في التطبيق.')}>
      {page.capabilities?.includes('manageContent')&&<Link className="pages-button primary" to={'/create/poll?pageId='+page.id}>{text('Create poll','إنشاء استطلاع')}</Link>}</PageEmpty>}
    {next&&<button className="pages-button" disabled={busy} onClick={()=>void load(next)}>{text('Load more','تحميل المزيد')}</button>}
  </section>;
}
