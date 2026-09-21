import React, { useEffect, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '../../services/api';
import { BusinessPage, pageRequest, pagesApi } from '../../services/pagesApi';
import { MediaDraft } from '../../types';
import { MediaPicker } from '../media/MediaPicker';
import { MediaImage } from '../media/MediaImage';
import { mediaDraftsAreReady, readyMediaAssetIds } from '../../utils/mediaDrafts';
import { emptyPageInfo, infoFromPage, PageAbout, PageAvatar, PageError, PageFields, PageLoading, usePageText } from './PageUi';

export function PageCreate() {
  const {text}=usePageText(); const navigate=useNavigate(); const [query,setQuery]=useSearchParams();
  const draftId=query.get('draft'); const requestedStep=Number(query.get('step'));
  const step=draftId&&[1,2,3].includes(requestedStep)?requestedStep:1;
  const [info,setInfo]=useState({...emptyPageInfo}); const [handle,setHandle]=useState('');
  const [confirmed,setConfirmed]=useState(false); const [page,setPage]=useState<BusinessPage|null>(null);
  const [busy,setBusy]=useState(false); const [loading,setLoading]=useState(!!draftId); const [error,setError]=useState<unknown>(null);
  const [avatar,setAvatar]=useState<MediaDraft[]>([]),[cover,setCover]=useState<MediaDraft[]>([]);
  const requestId=useRef(crypto.randomUUID()); const heading=useRef<HTMLHeadingElement>(null);
  const leaveSaved=useRef(false);
  const unsaved=JSON.stringify(info)!==JSON.stringify(page?infoFromPage(page):emptyPageInfo)||avatar.length>0||cover.length>0||(!page&&(!!handle||confirmed));
  const blocker=useBlocker(({currentLocation,nextLocation})=>{
    if(leaveSaved.current){leaveSaved.current=false;return false;}
    return unsaved&&currentLocation.pathname!==nextLocation.pathname;
  });
  useEffect(()=>{if(!unsaved)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[unsaved]);
  useEffect(()=>{if(blocker.state!=='blocked')return;if(window.confirm(text('Discard your unsaved Page changes?','هل تريد تجاهل تعديلات الصفحة غير المحفوظة؟')))blocker.proceed();else blocker.reset();},[blocker,text]);
  const handleInvalid=error instanceof ApiError&&((error.details?.fields as Array<{field:string}>|undefined)?.some(item=>item.field==='handle')||error.code==='PAGE_HANDLE_TAKEN');
  useEffect(()=>{heading.current?.focus();},[step]);
  useEffect(()=>{
    if(!draftId){setLoading(false);return;}
    const abort=new AbortController();setLoading(true);
    pagesApi.manage(draftId,abort.signal).then(value=>{if(abort.signal.aborted)return;if(value.publicationState!=='DRAFT'||!value.capabilities?.includes('editInfo')){navigate('/pages/manage/'+value.id,{replace:true});return;}setPage(value);setInfo(infoFromPage(value));setHandle(value.handle);setConfirmed(true);}).catch(error=>{if(!abort.signal.aborted)setError(error);}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});
    return()=>abort.abort();
  },[draftId]);
  const move=(next:number,id=page?.id)=>setQuery({step:String(next),...(id?{draft:id}:{})});
  const saveDetails=async(current:BusinessPage)=>{
    if(!mediaDraftsAreReady([...avatar,...cover]))throw new Error('Media pending');
    let updated=await pagesApi.update(current.id,info);
    if(avatar.length||cover.length)updated=await pageRequest<BusinessPage>('/manage/'+current.id+'/media','PUT',{
      avatarMediaId:readyMediaAssetIds(avatar)[0]||current.avatarMediaId,coverMediaId:readyMediaAssetIds(cover)[0]||current.coverMediaId});
    setPage(updated);setAvatar([]);setCover([]);return updated;
  };
  const finishLater=async()=>{if(!page||busy)return;setBusy(true);setError(null);try{await saveDetails(page);leaveSaved.current=true;navigate('/pages/manage/'+page.id);}catch(error){setError(error);}finally{setBusy(false);}};
  const save=async(event:React.FormEvent)=>{
    event.preventDefault();if(busy)return;setBusy(true);setError(null);
    try{
      let current=page;
      if(step===1){current=current?await pagesApi.update(current.id,info):await pagesApi.create({...info,handle,representationConfirmed:confirmed,requestId:requestId.current});setPage(current);move(2,current.id);}
      else if(step===2 && current){
        current=await saveDetails(current);move(3,current.id);
      } else if(step===3 && current){await pagesApi.lifecycle(current.id,'publish');leaveSaved.current=true;navigate('/pages/manage/'+current.id+'?created=1',{replace:true});}
    }catch(error){setError(error);}finally{setBusy(false);}
  };
  if(loading)return <PageLoading/>;
  return <div className="pages-content"><div className="pages-form"><p className="pages-kicker">{text('YOUR SPACE ON OPINIUP','مساحتك على OPINIUP')}</p><h1 ref={heading} tabIndex={-1} className="pages-heading">{text('Create your page','أنشئ صفحتك')}</h1><p className="pages-muted">{text('Introduce your work, ask meaningful questions and hear from your audience.','عرّف بعملك، اطرح أسئلتك، واستمع إلى جمهورك.')}</p>
    <div className="pages-steps" aria-label={text('Creation progress','خطوات الإنشاء')}>{[text('1 · Basics','1 · الأساسيات'),text('2 · Details','2 · التفاصيل'),text('3 · Preview','3 · المعاينة')].map((label,index)=><span key={index} aria-current={step===index+1?'step':undefined}>{label}</span>)}</div>
    {error && <PageError error={error}/>}
    <form className="pages-panel" onSubmit={save}><div className="pages-panel-body">
      {step===1 && <><PageFields info={info} onChange={setInfo} error={error} basic><label className="pages-field wide">{text('Page handle','معرّف الصفحة')}<input aria-invalid={handleInvalid||undefined} aria-describedby={handleInvalid?"page-handle-error":undefined} required dir="ltr" minLength={3} maxLength={30} pattern="[a-zA-Z][a-zA-Z0-9_]{2,29}" autoCapitalize="none" spellCheck={false} value={handle} disabled={!!page} onChange={event=>setHandle(event.target.value.toLowerCase())}/><small dir="ltr">{window.location.host}/pages/{handle||'your_page'}</small>{handleInvalid&&<small id="page-handle-error" role="alert">{text('Choose an available handle using letters, numbers and underscores.','اختر معرّفاً متاحاً بحروف إنجليزية وأرقام وشرطة سفلية.')}</small>}</label></PageFields><label className="pages-check"><input type="checkbox" required checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/><span>{text('I am authorized to represent this page.','أنا مخوّل بتمثيل هذه الصفحة.')}</span></label></>}
      {step===2 && <><div className="pages-notice">{text('Your draft is saved. You can return to it from My pages. The following details are optional.','حُفظت المسودة ويمكنك العودة إليها من «صفحاتي». التفاصيل التالية اختيارية.')}</div><div className="pages-form-grid" style={{marginBottom:24}}><section className="pages-field"><span>{text('Page image · square','صورة الصفحة · مربعة')}</span>{page?.avatarMediaId&&!avatar.length&&<PageAvatar page={page}/>}<MediaPicker purpose="PROFILE_AVATAR" value={avatar} onChange={setAvatar} maxFiles={1} multiple={false}/></section><section className="pages-field"><span>{text('Cover image · 3:1','صورة الغلاف · 3:1')}</span>{page?.coverMediaId&&!cover.length&&<div className="pages-cover"><MediaImage mediaId={page.coverMediaId} media={page.coverMedia} alt=""/></div>}<MediaPicker purpose="PROFILE_COVER" value={cover} onChange={setCover} maxFiles={1} multiple={false}/></section></div><PageFields info={info} onChange={setInfo} error={error}/></>}
      {step===3 && page && <><div className="pages-notice">{text('Preview. Your page becomes public only when you publish it. Post and result privacy remain controlled by each post’s settings.','هذه معاينة. ستصبح صفحتك عامة عند نشرها، وتبقى خصوصية المنشورات والنتائج وفق إعدادات كل منشور.')}</div><div className="pages-cover">{page.coverMediaId&&<MediaImage mediaId={page.coverMediaId} media={page.coverMedia} alt=""/>}</div><PageAvatar page={page}/><h2 className="pages-public-title">{page.name}</h2><p className="pages-handle" dir="ltr">@{page.handle}</p><p className="pages-muted" style={{margin:'12px 0 24px'}}>{page.bio}</p><PageAbout page={page}/></>}
      <div className="pages-form-footer">{step>1?<button type="button" disabled={busy} className="pages-button" onClick={()=>move(step-1)}>{text('Back','السابق')}</button>:<Link className="pages-button" to="/pages/mine">{text('Cancel','إلغاء')}</Link>}<div className="pages-actions">{page && <button type="button" className="pages-button" disabled={busy||!mediaDraftsAreReady([...avatar,...cover])} onClick={()=>void finishLater()}>{text('Save and finish later','حفظ والإكمال لاحقاً')}</button>}<button className="pages-button primary" disabled={busy||loading||(step>1&&!page)||(step===2&&!mediaDraftsAreReady([...avatar,...cover]))}>{busy?text('Saving…','جارٍ الحفظ…'):step===3?text('Publish page','نشر الصفحة'):text('Continue','متابعة')}</button></div></div>
    </div></form>
  </div></div>;
}
