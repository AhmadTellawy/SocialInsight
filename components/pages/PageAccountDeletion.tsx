import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { authFetch } from '../../services/api';
import { usePageText } from './PageUi';

export function PageAccountDeletion({userId,onReady,refreshKey=0}:{userId:string;refreshKey?:number;onReady:(ids:string[]|null)=>void}) {
  const {text}=usePageText();
  const [pages,setPages]=useState<Array<{id:string;name:string;handle:string}>|null>(null);
  const [error,setError]=useState(false),[retry,setRetry]=useState(0),[confirmed,setConfirmed]=useState(false);
  useEffect(()=>{
    const abort=new AbortController();onReady(null);setPages(null);setError(false);setConfirmed(false);
    authFetch('/api/users/'+encodeURIComponent(userId)+'/page-deletion-impact',{cache:'no-store',signal:abort.signal})
      .then(async response=>{if(!response.ok)throw Error();return response.json();})
      .then(result=>{if(!abort.signal.aborted){setPages(result.pages);if(!result.pages.length)onReady([]);}})
      .catch(()=>{if(!abort.signal.aborted)setError(true);});
    return()=>abort.abort();
  },[userId,retry,refreshKey]);
  if(error)return <p role="alert" className="my-3 text-sm text-red-700">{text('Unable to check your Pages.','تعذر التحقق من صفحاتك.')} <button className="min-h-11 underline" type="button" onClick={()=>setRetry(value=>value+1)}>{text('Retry','إعادة المحاولة')}</button></p>;
  if(!pages)return <p role="status" className="my-3 text-sm">{text('Checking Page ownership…','جارٍ التحقق من ملكية الصفحات…')}</p>;
  if(!pages.length)return null;
  return <section className="my-4 space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-start text-sm">
    <p>{text('Before deleting your account, transfer these Pages to an eligible team member, or request their deletion below.','قبل حذف حسابك، انقل هذه الصفحات إلى عضو فريق مؤهل، أو اطلب حذفها أدناه.')}</p>
    <ul>{pages.map(page=><li key={page.id}><Link className="inline-block min-h-11 py-2 font-semibold text-blue-700 underline" to={'/pages/manage/'+page.id+'?tab=settings'}>{page.name}</Link></li>)}</ul>
    <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 h-5 w-5" checked={confirmed} onChange={event=>{setConfirmed(event.target.checked);onReady(event.target.checked?pages.map(page=>page.id):null);}}/><span>{text('Request deletion of these Pages with my account. They will be hidden immediately and processed after 30 days. My account cannot be restored through this app; Page recovery during this period requires authorized support.','أطلب حذف هذه الصفحات مع حسابي. ستُخفى فوراً وتُعالج بعد 30 يوماً. لا توجد استعادة للحساب عبر التطبيق؛ استعادة الصفحة خلال المهلة تحتاج معالجة دعم مخولة.')}</span></label>
  </section>;
}
