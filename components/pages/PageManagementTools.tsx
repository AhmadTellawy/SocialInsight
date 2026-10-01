import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BusinessPage, pageRequest, pagesApi } from '../../services/pagesApi';
import { PageCaseForm } from './PageCases';
import { PageEmpty, PageError, PageLoading, usePageText } from './PageUi';

type CursorRows<T>={items:T[];nextCursor:string|null};
export type TeamUser={id:string;name:string;handle:string;status?:string;emailConfirmed?:boolean};
export type TeamMember={userId:string;role:string;user:TeamUser};
export type TeamRows=CursorRows<TeamMember>&{owner:TeamUser};

// Lists keep a bounded first page and fetch subsequent pages only on request.
export function useManagementList<T>(path:string) {
  const [items,setItems]=useState<T[]>([]),[next,setNext]=useState<string|null>(null);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null);
  const alive=useRef<AbortController|null>(null);
  const load=useCallback(async(cursor='')=>{
    const signal=alive.current?.signal;if(!signal||signal.aborted)return;
    setBusy(true);setError(null);
    try{const result=await pageRequest<CursorRows<T>>(path+(cursor?(path.includes('?')?'&':'?')+'cursor='+encodeURIComponent(cursor):''),'GET',undefined,signal);
      if(!signal.aborted){setItems(previous=>cursor?[...previous,...result.items]:result.items);setNext(result.nextCursor);}
    }catch(error){if(!signal.aborted)setError(error);}finally{if(!signal.aborted){setLoading(false);setBusy(false);}}
  },[path]);
  useEffect(()=>{const controller=new AbortController();alive.current=controller;setItems([]);setNext(null);setLoading(true);void load();return()=>controller.abort();},[load]);
  return {items,setItems,next,loading,busy,error,setError,load};
}

export function roleName(role:string,text:(en:string,ar:string)=>string){return ({OWNER:text('Owner','المالك'),ADMIN:text('Admin','مدير'),EDITOR:text('Editor','محرر'),ANALYST:text('Analyst','محلل')} as Record<string,string>)[role]||text('Team member','عضو فريق');}

export function PageSentRequests({page,kind,revision=0}:{page:BusinessPage;kind:'invitation'|'transfer';revision?:number}) {
  const {text,ar}=usePageText();
  type RequestRow={id:string;role?:string;expiresAt:string;status?:string;recipient:TeamUser|null;canWithdraw:boolean};
  const list=useManagementList<RequestRow>('/manage/'+page.id+'/requests?kind='+kind+'&revision='+revision);
  const [pending,setPending]=useState<string|null>(null),[notice,setNotice]=useState('');
  return <section style={{marginTop:28}}><h3 className="pages-heading" style={{fontSize:20}}>{kind==='invitation'?text('Sent invitations','الدعوات المرسلة'):text('Ownership transfer requests','طلبات نقل الملكية')}</h3>
    {list.error&&<PageError error={list.error} retry={()=>void list.load()}/>}{list.loading?<PageLoading/>:list.items.length?list.items.map(item=><div className="pages-row" key={item.id}>
      <div><strong>{item.recipient?.name||text('Account unavailable','الحساب غير متاح')}</strong>{item.recipient?.handle&&<p dir="ltr" className="pages-handle">@{item.recipient.handle}</p>}
        <p className="pages-muted">{item.role&&<>{roleName(item.role,text)} · </>}{item.status==='ACCEPTED'?text('Accepted','مقبولة'):item.status==='REJECTED'?text('Declined','مرفوضة'):item.status==='WITHDRAWN'?text('Withdrawn','مسحوبة'):new Date(item.expiresAt).getTime()<=Date.now()?text('Expired','منتهية'):text('Awaiting acceptance','بانتظار القبول')}</p>
        <small className="pages-muted">{text('Expires','تنتهي')}: <time dateTime={item.expiresAt}>{new Date(item.expiresAt).toLocaleString(ar?'ar':'en')}</time></small></div>
      {item.canWithdraw&&<button className="pages-button" disabled={!!pending||list.busy} onClick={async()=>{setPending(item.id);list.setError(null);setNotice('');try{if(kind==='invitation')await pagesApi.invitation(item.id,'withdraw');else await pagesApi.transferResponse(item.id,'withdraw');setNotice(text('Request withdrawn','تم سحب الطلب'));await list.load();}catch(error){list.setError(error);}finally{setPending(null);}}}>{pending===item.id?text('Withdrawing…','جارٍ السحب…'):text('Withdraw request','سحب الطلب')}</button>}
    </div>):!list.error&&<p className="pages-muted">{text('No requests to show.','لا توجد طلبات للعرض.')}</p>}
    {list.next&&<button className="pages-button" disabled={list.busy||!!pending} onClick={()=>void list.load(list.next!)}>{text('Load more requests','تحميل طلبات إضافية')}</button>}<p role="status" className="pages-muted">{notice}</p>
  </section>;
}

export function PageBlocks({page}:{page:BusinessPage}) {
  const {text}=usePageText();const list=useManagementList<{userId:string;user:TeamUser}>('/manage/'+page.id+'/blocks');
  const [handle,setHandle]=useState(''),[candidate,setCandidate]=useState<TeamUser|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const block=async(userId:string,blocked:boolean)=>{setBusy(true);list.setError(null);setNotice('');try{await pageRequest('/manage/'+page.id+'/blocks','POST',{userId,blocked});setCandidate(null);setHandle('');setNotice(blocked?text('Account blocked from the Page.','تم حظر الحساب من الصفحة.'):text('Account unblocked. Following is not restored automatically.','تم إلغاء الحظر. لا تُستعاد المتابعة تلقائياً.'));await list.load();}catch(error){list.setError(error);}finally{setBusy(false);}};
  return <section className="pages-panel pages-panel-body"><h2 className="pages-heading" style={{fontSize:22}}>{text('Blocked accounts','الحسابات المحظورة')}</h2><p className="pages-muted">{text('Page blocks prevent access and interaction with this Page. They do not block accounts from your personal profile.','يمنع حظر الصفحة الوصول والتفاعل معها. ولا يغيّر قائمة الحظر في حسابك الشخصي.')}</p>
    {list.error&&<PageError error={list.error} retry={()=>void list.load()}/>}
    <form onSubmit={async event=>{event.preventDefault();setBusy(true);setCandidate(null);setNotice('');list.setError(null);try{const result=await pageRequest<{candidate:TeamUser|null}>('/manage/'+page.id+'/team-candidate?handle='+encodeURIComponent(handle));setCandidate(result.candidate);if(!result.candidate)setNotice(text('No available account matches this exact handle.','لا يوجد حساب متاح بهذا المعرّف بالضبط.'));}catch(error){list.setError(error);}finally{setBusy(false);}}}>
      <label className="pages-field">{text('Find an account by exact handle','العثور على حساب بالمعرّف الكامل')}<input dir="ltr" autoCapitalize="none" required maxLength={50} value={handle} onChange={event=>{setHandle(event.target.value);setCandidate(null);}}/></label><button className="pages-button" style={{marginTop:12}} disabled={busy}>{text('Find account','العثور على الحساب')}</button>
    </form>
    {candidate&&<div className="pages-notice"><strong>{candidate.name}</strong><p dir="ltr">@{candidate.handle}</p><button disabled={busy} className="pages-button danger" onClick={()=>{if(window.confirm(text('Block this account from the Page?','هل تريد حظر هذا الحساب من الصفحة؟')))void block(candidate.id,true);}}>{text('Block from Page','حظر من الصفحة')}</button></div>}
    {list.loading?<PageLoading/>:list.items.length?list.items.map(item=><div className="pages-row" key={item.userId}><div><strong>{item.user.name}</strong><p className="pages-handle" dir="ltr">@{item.user.handle}</p></div><button disabled={busy||list.busy} className="pages-button" onClick={()=>void block(item.userId,false)}>{text('Unblock','إلغاء الحظر')}</button></div>):!list.error&&<PageEmpty title={text('No blocked accounts','لا توجد حسابات محظورة')} description={text('Accounts blocked by the Page will appear here.','ستظهر هنا الحسابات التي تحظرها الصفحة.')}/>}
    {list.next&&<button className="pages-button" disabled={busy||list.busy} onClick={()=>void list.load(list.next!)}>{text('Load more accounts','تحميل حسابات إضافية')}</button>}<p className="pages-muted" role="status">{notice}</p>
  </section>;
}

const auditLabels:Record<string,[string,string]>={
  PAGE_INFO_UPDATED:['Page details updated','تحديث معلومات الصفحة'],PAGE_HANDLE_CHANGED:['Page handle changed','تغيير معرّف الصفحة'],PAGE_PUBLISH:['Page published','نشر الصفحة'],PAGE_UNPUBLISH:['Page unpublished','إلغاء نشر الصفحة'],PAGE_DELETE:['Page deletion requested','طلب حذف الصفحة'],PAGE_CANCEL_DELETE:['Page deletion cancelled','إلغاء طلب حذف الصفحة'],PAGE_ACCOUNT_DELETION_REQUESTED:['Owner account deletion requested','طلب حذف حساب المالك'],PAGE_SAFETY_HIDDEN:['Page hidden for safety','إخفاء الصفحة للحماية'],PAGE_SAFETY_RESTORED:['Page safety hold removed','رفع إخفاء الحماية'],MEMBER_INVITED:['Team invitation sent','إرسال دعوة للفريق'],MEMBER_ROLE_CHANGED:['Team role changed','تغيير دور عضو'],USER_BLOCKED:['Account blocked from Page','حظر حساب من الصفحة'],USER_UNBLOCKED:['Account unblocked from Page','إلغاء حظر حساب من الصفحة'],OWNERSHIP_TRANSFER_REQUESTED:['Ownership transfer requested','طلب نقل الملكية'],OWNERSHIP_TRANSFER_ACCEPTED:['Ownership transferred','نقل الملكية'],OWNERSHIP_TRANSFER_REJECTED:['Ownership transfer declined','رفض نقل الملكية'],OWNERSHIP_TRANSFER_WITHDRAWN:['Ownership transfer withdrawn','سحب طلب نقل الملكية'],OWNERSHIP_TRANSFER_EXPIRED:['Ownership transfer expired','انتهاء طلب نقل الملكية'],
  PAGE_CREATED:['Page created','إنشاء الصفحة'],INFO_UPDATED:['Page details updated','تحديث معلومات الصفحة'],MEDIA_UPDATED:['Page images updated','تحديث صور الصفحة'],HANDLE_CHANGED:['Page handle changed','تغيير معرّف الصفحة'],
  PUBLISHED:['Page published','نشر الصفحة'],UNPUBLISHED:['Page unpublished','إلغاء نشر الصفحة'],DELETION_REQUESTED:['Page deletion requested','طلب حذف الصفحة'],DELETION_CANCELLED:['Page deletion cancelled','إلغاء طلب حذف الصفحة'],
  INVITATION_CREATED:['Team invitation sent','إرسال دعوة للفريق'],INVITATION_ACCEPTED:['Team invitation accepted','قبول دعوة الفريق'],INVITATION_REJECTED:['Team invitation declined','رفض دعوة الفريق'],INVITATION_WITHDRAWN:['Team invitation withdrawn','سحب دعوة الفريق'],INVITATION_REVOKED:['Team invitation cancelled','إلغاء دعوة الفريق'],INVITATION_EXPIRED:['Team invitation expired','انتهاء دعوة الفريق'],
  MEMBER_CHANGED:['Team role changed','تغيير دور عضو'],MEMBER_REMOVED:['Team access removed','إزالة صلاحية عضو'],MEMBER_LEFT:['Member left the team','مغادرة عضو للفريق'],
  TRANSFER_REQUESTED:['Ownership transfer requested','طلب نقل الملكية'],TRANSFER_ACCEPTED:['Ownership transferred','نقل الملكية'],TRANSFER_REJECTED:['Ownership transfer declined','رفض نقل الملكية'],TRANSFER_WITHDRAWN:['Ownership transfer withdrawn','سحب طلب نقل الملكية'],TRANSFER_EXPIRED:['Ownership transfer expired','انتهاء طلب نقل الملكية'],
  BLOCK_CHANGED:['Page block settings changed','تغيير حظر الصفحة'],SAFETY_HIDDEN:['Page hidden for safety','إخفاء الصفحة للحماية'],SAFETY_RESTORED:['Page safety hold removed','رفع إخفاء الحماية'],CONTENT_CREATED:['Page post created','إنشاء منشور للصفحة'],CONTENT_UPDATED:['Page post updated','تحديث منشور للصفحة'],CONTENT_DELETED:['Page post deleted','حذف منشور للصفحة'],COMMENT_DELETED:['Comment removed','إزالة تعليق'],ACCOUNT_DELETION_REQUESTED:['Owner account deletion requested','طلب حذف حساب المالك']
};
export function PageActivity({page}:{page:BusinessPage}) {
  const {text,ar}=usePageText();const [filter,setFilter]=useState('');const list=useManagementList<{id:string;action:string;createdAt:string}>('/manage/'+page.id+'/audit');
  const label=(action:string)=>auditLabels[action]?text(...auditLabels[action]):text('Page management action','إجراء لإدارة الصفحة');
  const rows=list.items.filter(item=>label(item.action).toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()));
  return <section className="pages-panel pages-panel-body"><h2 className="pages-heading" style={{fontSize:22}}>{text('Activity log','سجل النشاط')}</h2>
    <label className="pages-field" style={{marginTop:16}}>{text('Filter loaded activity','تصفية النشاط المحمّل')}<input type="search" value={filter} onChange={event=>setFilter(event.target.value)}/></label>
    {list.error&&<PageError error={list.error} retry={()=>void list.load()}/>}{list.loading?<PageLoading/>:rows.length?rows.map(item=><div className="pages-row" key={item.id}><span>{label(item.action)}</span><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString(ar?'ar':'en')}</time></div>):!list.error&&<PageEmpty title={text('No matching activity','لا يوجد نشاط مطابق')} description={text('Management actions appear here. Load more to include earlier activity in the filter.','تظهر هنا إجراءات الإدارة. حمّل المزيد لتشمل التصفية نشاطاً أقدم.')}/>}
    {list.next&&<button className="pages-button" disabled={list.busy} onClick={()=>void list.load(list.next!)}>{text('Load earlier activity','تحميل نشاط أقدم')}</button>}
  </section>;
}

export function PageSupport({page}:{page:BusinessPage}) {
  const {text,ar}=usePageText();const [form,setForm]=useState(false);const list=useManagementList<{id:string;decisionReason?:string;createdAt:string}>('/manage/'+page.id+'/cases');
  return <section className="pages-panel pages-panel-body"><h2 className="pages-heading" style={{fontSize:22}}>{text('Decisions and support','القرارات والدعم')}</h2>
    <p className="pages-muted">{text('Read platform decisions and appeal them. Reporter identities and private investigation details are confidential.','اطّلع على قرارات المنصة واستأنفها. تبقى هوية المُبلّغ وتفاصيل التحقيق الخاصة سرية.')}</p>
    <div className="pages-actions" style={{margin:'16px 0'}}><button className="pages-button" aria-expanded={form} onClick={()=>setForm(value=>!value)}>{form?text('Close support form','إغلاق نموذج الدعم'):text('Ownership and access support','دعم الملكية والوصول')}</button><Link to="/pages/cases" className="pages-button">{text('My support requests','طلبات الدعم الخاصة بي')}</Link></div>
    {form&&<PageCaseForm pageId={page.id} kind="OWNERSHIP"/>}
    {list.error&&<PageError error={list.error} retry={()=>void list.load()}/>}{list.loading?<PageLoading/>:list.items.length?list.items.map(item=><div className="pages-row" key={item.id}><div><p style={{whiteSpace:'pre-wrap'}}>{item.decisionReason||text('Page decision','قرار متعلق بالصفحة')}</p><time className="pages-muted" dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleDateString(ar?'ar':'en')}</time></div><Link className="pages-button" to={'/pages/cases/'+item.id}>{text('View decision and appeal','عرض القرار والاستئناف')}</Link></div>):!list.error&&<PageEmpty title={text('No decisions to show','لا توجد قرارات للعرض')} description={text('Platform decisions affecting this Page will appear here.','ستظهر هنا قرارات المنصة المتعلقة بالصفحة.')}/>}
    {list.next&&<button className="pages-button" disabled={list.busy} onClick={()=>void list.load(list.next!)}>{text('Load more decisions','تحميل قرارات إضافية')}</button>}
  </section>;
}
