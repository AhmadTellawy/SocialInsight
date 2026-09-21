import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, BriefcaseBusiness, Check, ExternalLink, MoreHorizontal, Plus, Search, Share2 } from 'lucide-react';
import { ApiError, authFetch } from '../../services/api';
import { BusinessPage, BlockedPage, PageInvitation, pagesApi, syncPageFollowState } from '../../services/pagesApi';
import { normalizeSurvey, Survey, UserProfile } from '../../types';
import { SurveyCard } from '../SurveyCard';
import { PageCreate } from './PageCreate';
import { PageManage } from './PageManage';
import { PageCases, PageCaseForm } from './PageCases';
import { roleName, useManagementList } from './PageManagementTools';
import { PageAbout, PageAvatar, PageEmpty, PageError, PageIdentityImage, PageLoading, PageTopbar, usePageText } from './PageUi';
import './pages.css';
import { PageMetadata } from './PageMetadata';
import { usePageCardState } from './PageContent';

export type PageCardProps = Omit<React.ComponentProps<typeof SurveyCard>,'survey'|'onContentClick'>;
export interface PagesWorkspaceProps { userProfile?:UserProfile|null;cardProps:PageCardProps;onPostClick:(id:string)=>void; }

function PageCard({page}:{page:BusinessPage;key?:React.Key}) {
  const {text}=usePageText();
  return <article className="pages-panel pages-card"><div className="pages-card-cover">{page.coverMediaId&&<PageIdentityImage mediaId={page.coverMediaId} media={page.coverMedia} alt=""/>}</div><div className="pages-panel-body"><div className="pages-card-avatar"><PageAvatar page={page} small/></div>
    <h2 className="pages-card-title"><Link to={page.role&&(page.publicationState!=='PUBLISHED'||page.deletionRequestedAt||page.platformState==='SUSPENDED'||page.safetyHidden)?'/pages/manage/'+page.id:'/pages/'+page.handle}>{page.name}</Link></h2><span className="pages-handle" dir="ltr">@{page.handle}</span><p className="pages-muted">{page.bio}</p>
    <div className="pages-actions"><span className="pages-tag">{text('Page','صفحة')}</span>{page.role && <span className="pages-tag">{({OWNER:text('Owner','المالك'),ADMIN:text('Admin','مدير'),EDITOR:text('Editor','محرر'),ANALYST:text('Analyst','محلل')})[page.role]}</span>}
    {page.publicationState && <span className="pages-tag pages-status">{page.deletionRequestedAt?text('Deletion requested','قيد الحذف'):page.platformState==='SUSPENDED'?text('Suspended','موقوفة'):page.safetyHidden?text('Hidden for safety','مخفية للحماية'):page.publicationState==='PUBLISHED'?text('Published','منشورة'):page.publicationState==='DRAFT'?text('Draft','مسودة'):text('Unpublished','غير منشورة')}</span>}</div>
    {page.followersCount!==undefined && <p className="pages-muted">{page.followersCount.toLocaleString()} {text('followers','متابع')}</p>}
    <div className="pages-actions">{page.role?<><Link className="pages-button primary" to={'/pages/manage/'+page.id}>{text('Manage page','إدارة الصفحة')}</Link>{page.publicationState==='PUBLISHED'&&!page.deletionRequestedAt&&page.platformState!=='SUSPENDED'&&!page.safetyHidden&&<Link className="pages-button" to={'/pages/'+page.handle}>{text('View','عرض')}</Link>}</>:<Link className="pages-button" to={'/pages/'+page.handle}>{text('Visit page','زيارة الصفحة')}<ArrowRight size={16}/></Link>}</div>
  </div></article>;
}

function ReceivedPageRequests({kind}:{kind:'invitation'|'transfer'}) {
  const {text,ar}=usePageText();const list=useManagementList<PageInvitation>(kind==='transfer'?'/transfers':'/invitations');
  const [pending,setPending]=useState<string|null>(null),[acceptedPage,setAcceptedPage]=useState<string|null>(null),[notice,setNotice]=useState('');
  const respond=async(item:PageInvitation,action:'accept'|'reject')=>{
    if(kind==='transfer'&&action==='accept'&&!window.confirm(text('Accept ownership of ','هل تريد قبول ملكية ')+item.page.name+' (@'+item.page.handle+')?'))return;
    setPending(item.id);list.setError(null);setNotice('');setAcceptedPage(null);
    try{const result=kind==='transfer'?await pagesApi.transferResponse(item.id,action):await pagesApi.invitation(item.id,action);list.setItems(rows=>rows.filter(row=>row.id!==item.id));setNotice(action==='accept'?text('Request accepted. Your access is now active.','تم قبول الطلب وأصبحت صلاحيتك فعّالة.'):text('Request declined.','تم رفض الطلب.'));if(action==='accept')setAcceptedPage(result.pageId);}catch(error){list.setError(error);}finally{setPending(null);}
  };
  return <section className="pages-panel pages-panel-body" style={{marginBottom:20}}><h2 className="pages-heading" style={{fontSize:22}}>{kind==='transfer'?text('Ownership transfers','طلبات نقل الملكية'):text('Team invitations','دعوات الفريق')}</h2>
    {list.error&&<PageError error={list.error} retry={()=>void list.load()}/>}{list.loading?<PageLoading/>:list.items.length?list.items.map(item=><article className="pages-row" key={item.id}><div><h3 style={{fontWeight:800}}>{item.page.name}</h3><p className="pages-handle" dir="ltr">@{item.page.handle}</p>{item.role&&<p className="pages-muted">{roleName(item.role,text)}</p>}<p className="pages-muted">{text('Expires','تنتهي')}: <time dateTime={item.expiresAt}>{new Date(item.expiresAt).toLocaleString(ar?'ar':'en')}</time></p></div><div className="pages-actions"><button disabled={!!pending||list.busy} className="pages-button primary" onClick={()=>void respond(item,'accept')}>{text('Accept','قبول')}</button><button disabled={!!pending||list.busy} className="pages-button" onClick={()=>void respond(item,'reject')}>{text('Decline','رفض')}</button></div></article>):!list.error&&<p className="pages-muted">{kind==='transfer'?text('No pending ownership requests.','لا توجد طلبات نقل ملكية معلّقة.'):text('No pending team invitations.','لا توجد دعوات فريق معلّقة.')}</p>}
    {list.next&&<button disabled={!!pending||list.busy} className="pages-button" onClick={()=>void list.load(list.next!)}>{kind==='transfer'?text('Load more transfers','تحميل طلبات نقل إضافية'):text('Load more invitations','تحميل دعوات إضافية')}</button>}<p className="pages-muted" role="status">{notice}</p>{acceptedPage&&<Link className="pages-button primary" to={'/pages/manage/'+acceptedPage}>{text('Manage page','إدارة الصفحة')}</Link>}
  </section>;
}

function BlockedPages({userId}:{userId:string}) {
  const {text}=usePageText();const list=useManagementList<BlockedPage>('/blocks');const [busy,setBusy]=useState<string|null>(null),[notice,setNotice]=useState('');
  return <main className="pages-content"><div className="pages-hero"><h1 className="pages-heading">{text('Blocked pages','الصفحات المحظورة')}</h1><Link className="pages-button" to="/pages/mine">{text('My pages','صفحاتي')}</Link></div><p className="pages-muted">{text('Unblocking allows access again. It does not follow the Page automatically.','يسمح إلغاء الحظر بالوصول مجدداً، ولا يعيد متابعة الصفحة تلقائياً.')}</p>
    {list.error&&<PageError error={list.error} retry={()=>void list.load()}/>}{list.loading?<PageLoading/>:list.items.length?<div className="pages-panel pages-panel-body">{list.items.map(page=><div className="pages-row" key={page.id}><div><strong>{page.name}</strong><p dir="ltr" className="pages-handle">@{page.handle}</p></div><button disabled={!!busy||list.busy} className="pages-button" onClick={async()=>{setBusy(page.id);list.setError(null);setNotice('');try{await pagesApi.block(page.id,false);syncPageFollowState(page.id,userId,false);list.setItems(rows=>rows.filter(row=>row.id!==page.id));setNotice(text('Page unblocked: ','تم إلغاء حظر الصفحة: ')+page.name);}catch(error){list.setError(error);}finally{setBusy(null);}}}>{busy===page.id?text('Unblocking…','جارٍ إلغاء الحظر…'):text('Unblock','إلغاء الحظر')}</button></div>)}</div>:!list.error&&<PageEmpty title={text('No blocked pages','لا توجد صفحات محظورة')} description={text('Pages you block will appear here.','ستظهر هنا الصفحات التي تحظرها.')}/>}
    {list.next&&<button className="pages-button" disabled={!!busy||list.busy} onClick={()=>void list.load(list.next!)}>{text('Load more pages','تحميل صفحات إضافية')}</button>}<p role="status" className="pages-muted">{notice}</p>
  </main>;
}

function PageAccountLinks({userId}:{userId:string}) {
  const {text}=usePageText();const [staff,setStaff]=useState(false);
  useEffect(()=>{const abort=new AbortController();setStaff(false);const load=()=>void pagesApi.staffAccess(abort.signal).then(value=>{if(!abort.signal.aborted)setStaff(value.review===true);}).catch(()=>{if(!abort.signal.aborted)setStaff(false);});load();window.addEventListener('focus',load);const timer=setInterval(load,30000);return()=>{abort.abort();clearInterval(timer);window.removeEventListener('focus',load);};},[userId]);
  return <nav className="pages-content pages-actions" style={{paddingTop:14,paddingBottom:0}} aria-label={text('Page account tools','أدوات حساب الصفحات')}><Link className="pages-button" to="/pages/cases">{text('Reports and support','البلاغات والدعم')}</Link><Link className="pages-button" to="/pages/blocks">{text('Blocked pages','الصفحات المحظورة')}</Link>{staff&&<Link className="pages-button" to="/pages/staff">{text('Platform support queue','طلبات دعم المنصة')}</Link>}</nav>;
}

function PageDirectory({mine,userProfile,invitationsOnly=false}:{mine:boolean;userProfile?:UserProfile|null;invitationsOnly?:boolean}) {
  const {text}=usePageText();const [query,setQuery]=useSearchParams();const tab=invitationsOnly?'invitations':query.get('tab')||'explore';
  const [items,setItems]=useState<BusinessPage[]>([]),[next,setNext]=useState<string|null>(null);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null);
  const [search,setSearch]=useState(query.get('q')||'');
  const fetchPage=useCallback(async(cursor='',signal?:AbortSignal)=>{
    setError(null);if(mine&&tab==='invitations'){setLoading(false);return;}if(!cursor)setLoading(true);else setBusy(true);
    try{const params=new URLSearchParams(query);if(cursor)params.set('cursor',cursor);const result=mine?await pagesApi.mine(cursor,signal):await pagesApi.explore(params,signal);if(!signal?.aborted){setItems(old=>cursor?[...old,...result.items.filter(item=>!old.some(previous=>previous.id===item.id))]:result.items);setNext(result.nextCursor);}}
    catch(error){if(!signal?.aborted){setError(error);if(error instanceof ApiError&&[401,403].includes(error.status))setItems([]);}}
    finally{if(!signal?.aborted){setLoading(false);setBusy(false);}}
  },[mine,query.toString(),tab,userProfile?.id]);
  useEffect(()=>{const abort=new AbortController();setItems([]);setNext(null);void fetchPage('',abort.signal);return()=>abort.abort();},[fetchPage]);
  useEffect(()=>{setSearch(query.get('q')||'');},[query.toString()]);
  return <main className="pages-content"><div className="pages-hero"><div className="pages-hero-copy"><p className="pages-kicker">{mine?text('YOUR PAGES & TEAMS','صفحاتك وفرقك'):text('DISCOVER ON OPINIUP','اكتشف على OPINIUP')}</p><h1 className="pages-heading">{mine?text('My pages','صفحاتي'):text('Ideas grow with a community','أفكار تنمو بمشاركة جمهورها')}</h1><p className="pages-muted">{mine?text('Your managed pages and team invitations, all in one place.','الصفحات التي تديرها ودعوات الفرق، في مكان واحد.'):text('Meet projects, organizations and creators. Follow their questions and add your perspective.','تعرّف على مشاريع ومؤسسات وصنّاع محتوى. تابع أسئلتهم وشارك برأيك.')}</p></div><Link className="pages-button primary" to="/pages/create"><Plus size={18}/>{text('Create a page','إنشاء صفحة')}</Link></div>
    <nav className="pages-tabs" aria-label={text('Page lists','قوائم الصفحات')}>{(mine?[['explore',text('Managed pages','الصفحات المُدارة')],['invitations',text('Invitations','الدعوات')]]:[['explore',text('Explore','استكشاف')],['following',text('Following','أتابعها')]]).map(([value,label])=><Link key={value} aria-current={tab===value?'page':undefined} to={(mine?'/pages/mine':'/pages')+'?tab='+value}>{label}</Link>)}{mine&&<Link to="/pages?tab=following">{text('Pages I follow','الصفحات التي أتابعها')}</Link>}</nav>
    {!mine&&<form className="pages-search" onSubmit={event=>{event.preventDefault();setQuery({tab,...(search.trim()?{q:search.trim()}:{})});}}><Search size={19}/><input aria-label={text('Search pages','البحث عن صفحات')} placeholder={text('Search by name or handle','ابحث بالاسم أو المعرّف')} value={search} onChange={event=>setSearch(event.target.value)}/><button className="pages-icon" aria-label={text('Search','بحث')}><ArrowRight size={18}/></button></form>}
    {error&&<PageError error={error} retry={()=>void fetchPage()}/>}
    {mine&&tab==='invitations'?<React.Fragment key={userProfile?.id}><ReceivedPageRequests kind="transfer"/><ReceivedPageRequests kind="invitation"/></React.Fragment>:loading?<PageLoading/>:items.length?<div className="pages-grid">{items.map(page=><PageCard key={page.id} page={page}/>)}</div>:!error&&<PageEmpty title={mine?text('Your next chapter starts here','صفحتك القادمة تبدأ هنا'):text('No pages found','لم نعثر على صفحات')} description={mine?text('Create a page for your work, or accept an invitation to join a team.','أنشئ صفحة لعملك أو اقبل دعوة للانضمام إلى فريق.'):text('Try another search, or discover pages to follow.','جرّب بحثاً آخر أو اكتشف صفحات تتابعها.')}><Link className="pages-button primary" to={mine?'/pages/create':'/pages'}>{mine?text('Create a page','إنشاء صفحة'):text('Explore pages','استكشاف الصفحات')}</Link></PageEmpty>}
    {next&&tab!=='invitations'&&<div className="pages-actions" style={{justifyContent:'center',marginTop:24}}><button className="pages-button" disabled={busy} onClick={()=>void fetchPage(next)}>{busy?text('Loading…','جارٍ التحميل…'):text('Load more','عرض المزيد')}</button></div>}
  </main>;
}

function PublicPage({handle,userProfile,cardProps,onPostClick}:PagesWorkspaceProps & {handle:string;key?:React.Key}) {
  const {text}=usePageText();const navigate=useNavigate();const [query]=useSearchParams();const tab=query.get('tab')||'posts';
  const [page,setPage]=useState<BusinessPage|null>(null),[posts,setPosts]=useState<Survey[]>([]);
  const [loading,setLoading]=useState(true),[error,setError]=useState<unknown>(null),[postError,setPostError]=useState<unknown>(null);
  const [postsLoading,setPostsLoading]=useState(true),[next,setNext]=useState<string|null>(null),[busy,setBusy]=useState(false),[copied,setCopied]=useState(false);
  const liveCardProps=usePageCardState(posts,setPosts,cardProps,setPostError,[handle,tab,userProfile?.id].join(':'));
  const loadPage=useCallback(async(signal?:AbortSignal)=>{try{const value=await pagesApi.get(handle,signal);if(signal?.aborted)return;setPage(value);setError(null);if(value.redirected)navigate('/pages/'+value.canonicalHandle+(tab==='posts'?'':'?tab='+tab),{replace:true});}catch(error){if(!signal?.aborted){setPage(null);setPosts([]);setError(error);}}finally{if(!signal?.aborted)setLoading(false);}},[handle,userProfile?.id,tab]);
  useEffect(()=>{const abort=new AbortController();setPage(null);setPosts([]);setLoading(true);void loadPage(abort.signal);const timer=setInterval(()=>{if(document.visibilityState==='visible')void loadPage(abort.signal);},30000);return()=>{abort.abort();clearInterval(timer);};},[loadPage]);
  const loadPosts=useCallback(async(cursor='',signal?:AbortSignal)=>{
    if(!page||!['posts','polls'].includes(tab))return;setPostsLoading(true);setPostError(null);
    try{const params=new URLSearchParams({pageId:page.id,...(tab==='polls'?{type:'Poll'}:{}),...(cursor?{cursor}:{})});const response=await authFetch('/api/posts?'+params,{signal,cache:'no-store'});if(!response.ok)throw new ApiError('Page posts unavailable',response.status);const data=await response.json();const rows=(Array.isArray(data)?data:data.data||data.items).map((item:any)=>normalizeSurvey(item));if(signal?.aborted)return;setPosts(old=>cursor?[...old,...rows]:rows);setNext(data.nextCursor||response.headers.get('X-Next-Cursor'));}catch(error){if(!signal?.aborted)setPostError(error);}finally{if(!signal?.aborted)setPostsLoading(false);}
  },[page?.id,tab,userProfile?.id]);
  useEffect(()=>{const abort=new AbortController();setPosts([]);void loadPosts('',abort.signal);return()=>abort.abort();},[loadPosts]);
  useEffect(()=>{if(!page?.id||!userProfile?.id)return;const listener=(event:Event)=>{const detail=(event as CustomEvent).detail;if(detail?.isPage&&detail.targetUserId===page.id&&detail.viewerId===userProfile.id){setPage(current=>current?{...current,following:detail.followStatus==='ACTIVE'}:current);void loadPage();}};window.addEventListener('onFollowStateChange',listener);return()=>window.removeEventListener('onFollowStateChange',listener);},[page?.id,userProfile?.id,loadPage]);
  const follow=async()=>{if(!userProfile){navigate('/login?returnTo='+encodeURIComponent('/pages/'+handle));return;}if(!page||busy)return;setBusy(true);try{const result=await pagesApi.follow(page.id,page.following?'unfollow':'follow');setPage(current=>current?.id===page.id?{...current,...result}:current);syncPageFollowState(page.id,userProfile.id!,result.following);}catch(error){setPostError(error);}finally{setBusy(false);}};
  const share=async()=>{if(!page)return;const url=window.location.origin+'/pages/'+page.handle;try{if(navigator.share)await navigator.share({title:page.name,text:page.bio,url});else{await navigator.clipboard.writeText(url);setCopied(true);}}catch(error){if((error as Error).name!=='AbortError')setPostError(error);}};
  const userAction=async(action:'mute'|'block')=>{if(!page||busy)return;if(!userProfile){navigate('/login?returnTo='+encodeURIComponent('/pages/'+handle));return;}setBusy(true);setPostError(null);try{if(action==='block'){if(!window.confirm(text('Block this Page? You can unblock it from Blocked pages.','هل تريد حظر الصفحة؟ يمكنك إلغاء حظرها من الصفحات المحظورة.')))return;await pagesApi.block(page.id,true);syncPageFollowState(page.id,userProfile.id!,false);navigate('/pages/blocks');}else{await pagesApi.follow(page.id,page.muted?'unmute':'mute');setPage(current=>current?.id===page.id?{...current,muted:!page.muted}:current);}}catch(error){setPostError(error);}finally{setBusy(false);}};
  if(loading)return <PageLoading/>;
  if(error||!page)return <main className="pages-content"><PageError error={error} retry={()=>void loadPage()}/><Link className="pages-button" to="/pages">{text('Explore pages','استكشاف الصفحات')}</Link></main>;
  const cta=page.cta==='WEBSITE'?page.website:page.cta==='EMAIL'&&page.publicEmail?'mailto:'+page.publicEmail:page.cta==='PHONE'&&page.publicPhone?'tel:'+page.publicPhone.replace(/[ ()-]/g,''):null;
  return <main className="pages-content"><div className="pages-panel">
    {page.managesPage&&<div className="pages-notice" style={{margin:0,borderRadius:0}}><div className="pages-row" style={{padding:0,border:0}}><span>{text('You have access to manage this page. You are viewing its public profile.','لديك صلاحية لإدارة هذه الصفحة. تشاهد الآن ملفها العام.')}</span><Link className="pages-button" to={'/pages/manage/'+page.id}>{text('Manage','إدارة')}</Link></div></div>}
    <div className="pages-cover">{page.coverMediaId&&<PageIdentityImage mediaId={page.coverMediaId} media={page.coverMedia} alt="" eager/>}</div>
    <section className="pages-public-heading"><PageAvatar page={page} eager/><h1 className="pages-public-title">{page.name}</h1><span className="pages-handle" dir="ltr">@{page.handle}</span><div className="pages-public-meta"><span className="pages-tag"><BriefcaseBusiness size={13}/>&nbsp;{text('Page','صفحة')}</span><span className="pages-muted">{page.followersCount?.toLocaleString()} {text('followers','متابع')}</span></div><p className="pages-muted" style={{maxWidth:680}}>{page.bio}</p>
    <div className="pages-actions"><button disabled={busy} className={'pages-button '+(page.following?'':'primary')} onClick={()=>void follow()}>{page.following?<Check size={17}/>:<Plus size={17}/>} {page.following?text('Following','تتابعها'):text('Follow','متابعة')}</button><button className="pages-button" onClick={()=>void share()}><Share2 size={17}/>{text('Share','مشاركة')}</button>{cta&&<a className="pages-button" href={cta} target={page.cta==='WEBSITE'?'_blank':undefined} rel="noopener noreferrer"><ExternalLink size={16}/>{page.cta==='WEBSITE'?text('Visit website','زيارة الموقع'):page.cta==='EMAIL'?text('Email','بريد إلكتروني'):text('Call','اتصال')}</a>}
      <details><summary className="pages-icon" aria-label={text('More page actions','المزيد من إجراءات الصفحة')}><MoreHorizontal size={21}/></summary><div className="pages-actions">{page.following&&<button disabled={busy} className="pages-button" onClick={()=>void userAction('mute')}>{page.muted?text('Unmute','إلغاء الكتم'):text('Mute','كتم')}</button>}<button disabled={busy} className="pages-button" onClick={()=>void userAction('block')}>{text('Block page','حظر الصفحة')}</button><Link className="pages-button" to={'/pages/'+page.handle+'?tab=report'}>{text('Report page','الإبلاغ عن الصفحة')}</Link></div></details>
    </div>{copied&&<p role="status" className="pages-muted">{text('Link copied','تم نسخ الرابط')}</p>}</section></div>
    <div className="pages-public-body"><section className="pages-posts"><nav className="pages-tabs" aria-label={text('Page sections','أقسام الصفحة')}>{[['posts',text('Posts','المنشورات')],['polls',text('Polls','الاستطلاعات')],['about',text('About','حول')]].map(([value,label])=><Link key={value} aria-current={tab===value?'page':undefined} to={'/pages/'+page.handle+'?tab='+value}>{label}</Link>)}</nav>
      {postError&&<PageError error={postError} retry={()=>void loadPosts()}/>}
      {tab==='report'?(userProfile?<PageCaseForm pageId={page.id}/>:<Link className="pages-button primary" to={'/login?returnTo='+encodeURIComponent('/pages/'+page.handle+'?tab=report')}>{text('Sign in to report','سجّل الدخول للإبلاغ')}</Link>):tab==='about'?<PageAbout page={page}/>:<>{postsLoading&&!posts.length?<PageLoading/>:posts.length?posts.map(post=><SurveyCard key={post.id} {...liveCardProps} survey={post} onContentClick={()=>onPostClick(post.id)}/>):!postError&&<PageEmpty title={text('The conversation starts here','الحوار يبدأ من هنا')} description={text('New posts from this page will appear here.','ستظهر هنا المنشورات الجديدة لهذه الصفحة.')}/>}{next&&<button className="pages-button" disabled={postsLoading} onClick={()=>void loadPosts(next)}>{text('Load more','عرض المزيد')}</button>}</>}
    </section><aside><PageAbout page={page}/></aside></div>
  </main>;
}

export function PagesWorkspace(props:PagesWorkspaceProps) {
  const {ar,text}=usePageText();const location=useLocation();const parts=location.pathname.split('/').filter(Boolean);const path=parts[1]||'';
  const privateRoute=['create','mine','manage','staff','cases','invitations','blocks'].includes(path);
  const heading=useRef<HTMLDivElement>(null);
  useEffect(()=>{heading.current?.scrollTo({top:0});},[location.pathname]);
  return <div ref={heading} className="pages-shell flex-1 overflow-y-auto" dir={ar?'rtl':'ltr'}><PageMetadata/><PageTopbar signedIn={!!props.userProfile}/>{props.userProfile?.id&&<PageAccountLinks userId={props.userProfile.id}/>}
    {privateRoute&&!props.userProfile?<main className="pages-content"><PageEmpty title={text('Sign in to manage your pages','سجّل الدخول لإدارة صفحاتك')} description={text('Use your personal account to create and manage pages.','استخدم حسابك الشخصي لإنشاء الصفحات وإدارتها.')}><Link className="pages-button primary" to={'/login?returnTo='+encodeURIComponent(location.pathname+location.search)}>{text('Sign in','تسجيل الدخول')}</Link></PageEmpty></main>:
    path==='blocks'?<React.Fragment key={props.userProfile!.id}><BlockedPages userId={props.userProfile!.id!}/></React.Fragment>:path==='staff'||path==='cases'?<PageCases staff={path==='staff'} caseId={parts[2]} userId={props.userProfile!.id!}/>:path==='create'?<PageCreate/>:path==='manage'&&parts[2]?<PageManage pageId={parts[2]} userProfile={props.userProfile!} cardProps={props.cardProps}/>:path==='mine'||path==='invitations'?<PageDirectory mine userProfile={props.userProfile} invitationsOnly={path==='invitations'}/>:!path?<PageDirectory mine={false} userProfile={props.userProfile}/>:<PublicPage key={path} handle={decodeURIComponent(path)} {...props}/>}
  </div>;
}
