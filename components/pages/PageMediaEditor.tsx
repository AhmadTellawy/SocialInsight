import React, { useState } from 'react';
import { BusinessPage, pageRequest } from '../../services/pagesApi';
import { MediaDraft } from '../../types';
import { mediaDraftsAreReady, readyMediaAssetIds } from '../../utils/mediaDrafts';
import { MediaPicker } from '../media/MediaPicker';
import { MediaImage } from '../media/MediaImage';
import { PageAvatar, PageError, usePageText } from './PageUi';

export function PageMediaEditor({page,onSaved}:{page:BusinessPage;onSaved:(page:BusinessPage)=>void}) {
  const {text}=usePageText();
  const [avatar,setAvatar]=useState<MediaDraft[]>([]),[cover,setCover]=useState<MediaDraft[]>([]);
  const [removeAvatar,setRemoveAvatar]=useState(false),[removeCover,setRemoveCover]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null),[saved,setSaved]=useState(false);
  const dirty=avatar.length>0||cover.length>0||removeAvatar||removeCover;
  const reset=()=>{setAvatar([]);setCover([]);setRemoveAvatar(false);setRemoveCover(false);setError(null);setSaved(false);};
  return <form className="pages-panel pages-panel-body" style={{marginTop:24}} onSubmit={async event=>{
    event.preventDefault();if(busy||!dirty||!mediaDraftsAreReady([...avatar,...cover]))return;
    setBusy(true);setError(null);setSaved(false);
    try {const updated=await pageRequest<BusinessPage>('/manage/'+page.id+'/media','PUT',{
      avatarMediaId:avatar.length?readyMediaAssetIds(avatar)[0]:removeAvatar?null:page.avatarMediaId,
      coverMediaId:cover.length?readyMediaAssetIds(cover)[0]:removeCover?null:page.coverMediaId
    });onSaved(updated);reset();setSaved(true);}catch(error){setError(error);}finally{setBusy(false);}
  }}>
    <h2 className="pages-heading" style={{fontSize:22}}>{text('Page images','صور الصفحة')}</h2>
    <p className="pages-muted">{text('Choose a new image to crop or replace it. Changes appear after saving.','اختر صورة جديدة لقصّها أو استبدالها. تظهر التغييرات بعد الحفظ.')}</p>
    {error&&<PageError error={error}/>}
    <div className="pages-form-grid" style={{marginTop:20}}>
      <section className="pages-field"><h3>{text('Page image · square','صورة الصفحة · مربعة')}</h3>
        {!avatar.length&&!removeAvatar&&<PageAvatar page={page}/>}
        <MediaPicker purpose="PROFILE_AVATAR" value={avatar} onChange={value=>{setAvatar(value);setRemoveAvatar(false);setSaved(false);}} disabled={busy} maxFiles={1} multiple={false}/>
        {page.avatarMediaId&&!avatar.length&&<button type="button" disabled={busy} className="pages-button" onClick={()=>{setRemoveAvatar(value=>!value);setSaved(false);}}>{removeAvatar?text('Undo removal','تراجع عن الإزالة'):text('Remove page image','إزالة صورة الصفحة')}</button>}
        {removeAvatar&&<p className="pages-muted">{text('The page image will be removed when you save.','ستُزال صورة الصفحة عند الحفظ.')}</p>}
      </section>
      <section className="pages-field"><h3>{text('Cover image · 3:1','صورة الغلاف · 3:1')}</h3>
        {!cover.length&&!removeCover&&page.coverMediaId&&<div className="pages-cover"><MediaImage mediaId={page.coverMediaId} media={page.coverMedia} alt={text('Current page cover','غلاف الصفحة الحالي')}/></div>}
        <MediaPicker purpose="PROFILE_COVER" value={cover} onChange={value=>{setCover(value);setRemoveCover(false);setSaved(false);}} disabled={busy} maxFiles={1} multiple={false}/>
        {page.coverMediaId&&!cover.length&&<button type="button" disabled={busy} className="pages-button" onClick={()=>{setRemoveCover(value=>!value);setSaved(false);}}>{removeCover?text('Undo removal','تراجع عن الإزالة'):text('Remove cover image','إزالة صورة الغلاف')}</button>}
        {removeCover&&<p className="pages-muted">{text('The cover will be removed when you save.','سيُزال الغلاف عند الحفظ.')}</p>}
      </section>
    </div>
    <div className="pages-form-footer"><span role="status" className="pages-muted">{saved?text('Images saved','تم حفظ الصور'):''}</span><div className="pages-actions">
      {dirty&&<button type="button" disabled={busy} className="pages-button" onClick={reset}>{text('Discard image changes','تجاهل تغييرات الصور')}</button>}
      <button disabled={busy||!dirty||!mediaDraftsAreReady([...avatar,...cover])} className="pages-button primary">{busy?text('Saving…','جارٍ الحفظ…'):text('Save images','حفظ الصور')}</button>
    </div></div>
  </form>;
}
