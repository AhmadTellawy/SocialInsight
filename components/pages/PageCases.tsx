import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { pageRequest } from '../../services/pagesApi';
import { PageEmpty, PageError, PageLoading, usePageText } from './PageUi';

type CaseRecord={id:string;pageId:string;kind?:string;reason?:string;detail?:string;status:string;decision?:string;decisionReason?:string;createdAt:string;page?:{name:string;handle:string};assigneeId?:string;postId?:string;evidence?:Array<{text:string}>};
export function PageCaseForm({pageId,kind='REPORT',parentId,postId}:{pageId:string;kind?:'REPORT'|'APPEAL'|'OWNERSHIP';parentId?:string;postId?:string}){
  const {text}=usePageText(),navigate=useNavigate();const [reason,setReason]=useState(''),[detail,setDetail]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null);
  return <form className="pages-panel pages-panel-body pages-form" onSubmit={async event=>{event.preventDefault();setBusy(true);setError(null);try{
    const result=await pageRequest<CaseRecord>('/'+pageId+'/cases','POST',{kind,reason,detail,...(parentId?{parentId}:{}),...(postId?{postId}:{})});navigate('/pages/cases/'+result.id);
  }catch(error){setError(error);}finally{setBusy(false);}}}>
    <h2 className="pages-heading">{kind==='APPEAL'?text('Appeal a decision','استئناف القرار'):kind==='OWNERSHIP'?text('Ownership and access support','دعم الملكية والوصول'):text('Report this Page','الإبلاغ عن الصفحة')}</h2>
    <p className="pages-muted">{text('The platform support team reviews your request. Your identity and investigation details are not shared with the Page team.','يراجع فريق دعم المنصة طلبك. لا تُكشف هويتك أو تفاصيل التحقيق لفريق الصفحة.')}</p>
    {error&&<PageError error={error}/>}<label>{text('Reason','السبب')}<input required minLength={3} maxLength={120} value={reason} onChange={event=>setReason(event.target.value)}/></label>
    <label>{text('What happened?','ما الذي حدث؟')}<textarea required minLength={10} maxLength={3000} rows={5} value={detail} onChange={event=>setDetail(event.target.value)}/></label>
    <p className="pages-muted">{text('Include only information needed for review. Do not send passwords or verification codes.','أرسل المعلومات اللازمة للمراجعة فقط. لا ترسل كلمات مرور أو رموز تحقق.')}</p>
    <button className="pages-button primary" disabled={busy}>{busy?text('Sending…','جارٍ الإرسال…'):text('Submit request','إرسال الطلب')}</button>
  </form>;
}

export function PageCases({staff=false,caseId,userId}:{staff?:boolean;caseId?:string;userId:string}){
  const {text,ar}=usePageText();const [rows,setRows]=useState<CaseRecord[]>([]),[current,setCurrent]=useState<CaseRecord|null>(null),[next,setNext]=useState<string|null>(null);
  const [loading,setLoading]=useState(true),[error,setError]=useState<unknown>(null),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0),[staffAccess,setStaffAccess]=useState<{review:boolean;ownership:boolean}|null>(null);
  const [action,setAction]=useState('DISMISS'),[reason,setReason]=useState(''),[recipientId,setRecipientId]=useState(''),[password,setPassword]=useState(''),[evidence,setEvidence]=useState(''),[verified,setVerified]=useState(false);
  const load=async(cursor='',signal?:AbortSignal)=>{
    if(staff)setStaffAccess(await pageRequest('/staff/access','GET',undefined,signal));
    if(caseId)setCurrent(await pageRequest('/cases/'+caseId,'GET',undefined,signal));
    else {const result=await pageRequest<{items:CaseRecord[];nextCursor:string|null}>((staff?'/staff/cases':'/cases')+(cursor?'?cursor='+encodeURIComponent(cursor):''),'GET',undefined,signal);setRows(previous=>cursor?[...previous,...result.items]:result.items);setNext(result.nextCursor);}
  };
  useEffect(()=>{const abort=new AbortController();setRows([]);setCurrent(null);setStaffAccess(null);setLoading(true);setError(null);
    void load('',abort.signal).catch(error=>{if(!abort.signal.aborted)setError(error);}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});
    return()=>abort.abort();},[staff,caseId,userId,retry]);
  if(loading)return <PageLoading/>;
  return <main className="pages-content"><div className="pages-hero"><div><p className="pages-kicker">{staff?text('PLATFORM SUPPORT','دعم المنصة'):text('MY REQUESTS','طلباتي')}</p><h1 className="pages-heading">{caseId?text('Request details','تفاصيل الطلب'):text('Reports and support','البلاغات والدعم')}</h1></div><Link className="pages-button" to={staff?'/pages/staff':'/pages/mine'}>{text('Back','رجوع')}</Link></div>
    {error&&<PageError error={error} retry={()=>setRetry(value=>value+1)}/>}
    {current?<><article className="pages-panel pages-panel-body"><p className="pages-muted" dir="ltr">#{current.id}</p><h2>{current.page?.name||current.reason||text('Page decision','قرار متعلق بالصفحة')}</h2>
      <p>{text('Status','الحالة')}: {current.status==='CLOSED'?text('Closed','مغلق'):current.status==='IN_REVIEW'?text('Under review','قيد المراجعة'):text('Received','تم الاستلام')}</p>
      {current.detail&&<p style={{whiteSpace:'pre-wrap'}}>{current.detail}</p>}{current.postId&&<Link to={'/post/'+current.postId}>{text('Open related post','فتح المنشور المرتبط')}</Link>}
      {current.decisionReason&&<div className="pages-notice">{current.decisionReason}</div>}
      {staffAccess&&current.evidence?.map((item,index)=><p key={index} style={{whiteSpace:'pre-wrap'}}>{item.text}</p>)}
    </article>
    {!staff&&current.status==='CLOSED'&&<PageCaseForm pageId={current.pageId} kind="APPEAL" parentId={current.id}/>}
    {staffAccess&&current.status!=='CLOSED'&&<form className="pages-form pages-panel pages-panel-body" onSubmit={async event=>{event.preventDefault();setBusy(true);setError(null);try{
      await pageRequest('/staff/cases/'+current.id+'/decision','POST',{action,reason,...(['OWNERSHIP_TRANSFER','CANCEL_DELETION'].includes(action)?{recipientId:recipientId||undefined,password,evidence,verificationConfirmed:verified}:{})});setPassword('');setRetry(value=>value+1);
    }catch(error){setError(error);}finally{setBusy(false);}}}>
      <button type="button" className="pages-button" disabled={busy} onClick={async()=>{setBusy(true);try{await pageRequest('/staff/cases/'+current.id+'/assign','POST',{assigneeId:userId});setRetry(value=>value+1);}catch(error){setError(error);}finally{setBusy(false);}}}>{text('Assign to me','إسناد الحالة إليّ')}</button>
      <label>{text('Decision','القرار')}<select value={action} onChange={event=>setAction(event.target.value)}>{[['DISMISS','No action','لا إجراء'],['RESTRICT','Restrict new publishing','تقييد النشر الجديد'],['SUSPEND','Suspend Page','تعليق الصفحة'],['RESTORE','Remove platform restriction','رفع قيد المنصة'],...(current.postId?[['HIDE_POST','Hide post','إخفاء المنشور'],['RESTORE_POST','Restore post','استعادة المنشور']]:[]),...(staffAccess.ownership?[['OWNERSHIP_TRANSFER','Resolve ownership','معالجة الملكية'],['CANCEL_DELETION','Cancel pending Page deletion','إلغاء طلب حذف الصفحة']]:[])].map(([id,en,arabic])=><option value={id} key={id}>{text(en,arabic)}</option>)}</select></label>
      <label>{text('Reason shared with affected users','السبب الذي سيظهر للمعنيين')}<textarea required minLength={10} maxLength={2000} value={reason} onChange={event=>setReason(event.target.value)}/></label>
      {['OWNERSHIP_TRANSFER','CANCEL_DELETION'].includes(action)&&<>{action==='OWNERSHIP_TRANSFER'&&<label>{text('Verified recipient account ID','معرّف حساب المستلم المتحقق منه')}<input required value={recipientId} onChange={event=>setRecipientId(event.target.value)}/></label>}
        <label>{text('Restricted verification evidence','أدلة التحقق المقيدة')}<textarea required minLength={20} maxLength={3000} value={evidence} onChange={event=>setEvidence(event.target.value)}/></label>
        <label><input type="checkbox" required checked={verified} onChange={event=>setVerified(event.target.checked)}/>{text('I verified the ownership claim and recipient independently of name/email similarity.','تحققت من طلب الملكية والمستلم ولم أعتمد على تشابه الاسم أو البريد.')}</label>
        <label>{text('Your current password','كلمة مرورك الحالية')}<input type="password" autoComplete="current-password" required value={password} onChange={event=>setPassword(event.target.value)}/></label></>}
      <button className="pages-button primary" disabled={busy}>{busy?text('Saving…','جارٍ الحفظ…'):text('Record decision','تسجيل القرار')}</button>
    </form>}</>:
      !error&&<>{rows.length?<div className="pages-panel pages-panel-body">{rows.map(item=><Link className="pages-row" key={item.id} to={(staff?'/pages/staff/':'/pages/cases/')+item.id}><span>{item.page?.name||item.reason||text('Page request','طلب صفحة')}</span><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleDateString(ar?'ar':'en')}</time></Link>)}</div>:<PageEmpty title={text('No requests to show','لا توجد طلبات للعرض')} description={text('Requests and decisions will appear here.','ستظهر هنا الطلبات والقرارات.')}/>}{next&&<button className="pages-button" disabled={busy} onClick={async()=>{setBusy(true);try{await load(next);}catch(error){setError(error);}finally{setBusy(false);}}}>{text('Load more','تحميل المزيد')}</button>}</>}
  </main>;
}
