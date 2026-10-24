import { pageTextLength } from '../../utils/pageText';
import { normalizePagePhone, normalizePageUrl } from '../../utils/pageInfo';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowLeft, BriefcaseBusiness, LoaderCircle } from 'lucide-react';
import { ApiError } from '../../services/api';
import { BusinessPage, PageInfo } from '../../services/pagesApi';
import { MediaImage } from '../media/MediaImage';
import { MediaPresentation } from '../../types';

export function usePageText() {
  const { i18n } = useTranslation();
  const ar = i18n.language.startsWith('ar');
  return { ar, text: (en: string, arabic: string) => ar ? arabic : en };
}
/** Page identity images have a fixed frame and an authorized content endpoint.
 * Avoid a metadata round trip before the first bytes; MediaImage retains its
 * no-store fetch, session checks, revocation polling and blob cleanup.
 */
export function PageIdentityImage({ mediaId, media, ...props }: Omit<React.ComponentProps<typeof MediaImage>, 'mediaId'> & { mediaId: string }) {
  const presentation: MediaPresentation = {
    ...media, id: mediaId, access: 'RESTRICTED', requiresAuth: true,
    aspectRatio: media?.aspectRatio ?? 1, width: media?.width ?? 0, height: media?.height ?? 0,
    src: '/api/media/' + encodeURIComponent(mediaId) + '/content',
  };
  return <MediaImage {...props} mediaId={mediaId} media={presentation} />;
}
export function PageAvatar({ page, small = false, eager = false }: { page: Pick<BusinessPage,'name'|'avatarMediaId'|'avatarMedia'>; small?:boolean; eager?:boolean }) {
  return <div className={`pages-avatar ${small ? 'small' : ''}`}>
    {page.avatarMediaId ? <PageIdentityImage mediaId={page.avatarMediaId} media={page.avatarMedia} alt={page.name} sizes={small ? '64px' : '92px'} eager={eager} /> : <span aria-hidden="true">{Array.from(page.name.trim()).slice(0,2).join('')}</span>}
  </div>;
}
export function PageLoading() { const {text}=usePageText(); return <div className="pages-loading" role="status"><LoaderCircle className="animate-spin" size={22}/>{text('Loading…','جارٍ التحميل…')}</div>; }
export function PageError({ error, retry }: {error:unknown;retry?:()=>void}) {
  const {text}=usePageText();
  const messages:Record<string,[string,string]>={
    PAGE_PERMISSION_DENIED:['Your access does not allow this action.','صلاحيتك لا تسمح بهذا الإجراء.'],
    PAGE_NOT_FOUND:['This page is unavailable.','هذه الصفحة غير متاحة.'],
    PAGE_HANDLE_TAKEN:['This page handle is already reserved.','معرّف الصفحة محجوز بالفعل.'],
    PAGE_CONFIRMED_EMAIL_REQUIRED:['Confirm your account email before creating a page.','أكّد بريد حسابك الإلكتروني قبل إنشاء صفحة.'],
    PAGE_OWNER_LIMIT:['You already own the maximum of five pages.','وصلت إلى الحد الأقصى: خمس صفحات مملوكة.'],
    PAGE_REAUTH_FAILED:['The password could not be verified.','تعذّر التحقق من كلمة المرور.'],
    PAGE_HANDLE_CHANGE_TOO_SOON:['You can change the handle once every 30 days.','يمكن تغيير المعرّف مرة كل 30 يوماً.'],
    PAGE_INVALID_INPUT:['Check the highlighted fields and try again.','راجع الحقول المدخلة ثم حاول مجدداً.'],
    PAGE_CTA_CONTACT_REQUIRED:['Add matching contact information or choose no contact button.','أضف بيانات التواصل المناسبة للزر أو اختر «بدون زر».'],
    PAGE_CREATE_RATE_LIMIT:['Too many attempts. Wait before trying again.','محاولات كثيرة. انتظر قليلاً قبل المحاولة مجدداً.'],
    PAGE_PUBLICATION_RESTRICTED:['A restriction prevents publishing this page.','يوجد قيد يمنع نشر هذه الصفحة.'],
    PAGE_TEAM_MEMBER_BLOCK_FORBIDDEN:['Team members must leave or transfer ownership before blocking.','يلزم مغادرة الفريق أو نقل الملكية قبل الحظر.'],
    PAGE_INVITATION_REVOKED:['The invitation is no longer valid. Ask a page administrator for a new invitation.','لم تعد الدعوة صالحة. اطلب دعوة جديدة من مدير الصفحة.'],
    PAGE_INVITATION_EXPIRED:['This invitation has expired or has already been used.','انتهت هذه الدعوة أو تم استخدامها.'],
    MEDIA_NOT_READY:['This image is unavailable or still processing. Try again or upload another image.','الصورة غير متاحة أو لا تزال قيد المعالجة. حاول مجدداً أو ارفع صورة أخرى.'],
    MEDIA_BUSY:['The image is still processing. Wait a moment and try again.','الصورة لا تزال قيد المعالجة. انتظر قليلاً ثم حاول مجدداً.'],
    NETWORK_ERROR:['Connection lost. Your entries are still here; try again.','انقطع الاتصال. بياناتك المدخلة محفوظة هنا؛ حاول مجدداً.'],
  };
  const pair = error instanceof ApiError ? messages[error.code || ''] : undefined;
  return <div className="pages-error" role="alert"><p>{pair ? text(...pair) : text('Unable to complete this request. Please try again.','تعذّر إكمال الطلب. حاول مجدداً.')}</p>{retry && <button className="pages-button" onClick={retry}>{text('Try again','إعادة المحاولة')}</button>}</div>;
}
export function PageEmpty({title,description,children}:{title:string;description:string;children?:React.ReactNode}) {
  return <div className="pages-empty"><BriefcaseBusiness size={34}/><h2>{title}</h2><p className="pages-muted">{description}</p>{children && <div className="pages-actions">{children}</div>}</div>;
}
export function PageTopbar({ signedIn }: {signedIn:boolean}) {
  const {text}=usePageText();
  return <header className="pages-topbar"><Link to="/" aria-label={text('Opiniup home','الرئيسية — Opiniup')}><img src="/pwa-64x64.png" alt=""/><span className="pages-brand-name"><span style={{color:'#0070ba'}}>Opini</span><span style={{color:'#008c6a'}}>up</span></span></Link>
    <nav aria-label={text('Pages navigation','التنقل بين الصفحات')}><Link className="pages-button" to="/pages">{text('Explore','استكشف')}</Link><Link className="pages-button" to={signedIn?'/pages/mine':'/login?returnTo=%2Fpages%2Fmine'}>{text('My pages','صفحاتي')}</Link><Link className="pages-icon" to="/profile" aria-label={text('My account','حسابي')}><ArrowLeft size={20}/></Link></nav>
  </header>;
}
export const emptyPageInfo:PageInfo={name:'',category:'company',bio:'',description:'',country:'',city:'',website:null,links:[],publicEmail:null,publicPhone:null,cta:null};
export const infoFromPage = (page:BusinessPage):PageInfo => Object.fromEntries(Object.keys(emptyPageInfo).map(key=>[key,page[key as keyof PageInfo]])) as PageInfo;

export function PageFields({ info,onChange,basic=false,minimal=false,children,error }: {info:PageInfo;onChange:(value:PageInfo)=>void;basic?:boolean;minimal?:boolean;children?:React.ReactNode;error?:unknown}) {
  const {text}=usePageText();
  const issues=error instanceof ApiError&&Array.isArray(error.details?.fields)?error.details.fields as Array<{field:string;message?:string}>:[];
  const invalid=(field:string)=>issues.some(issue=>issue.field===field||issue.field.startsWith(field+'.'));
  const fieldProps=(field:string)=>({name:field,id:'page-field-'+field,'aria-invalid':invalid(field)||undefined,'aria-describedby':invalid(field)?'page-error-'+field:undefined});
  const fieldError=(field:string)=>{
    if(!invalid(field))return null;
    const control=issues.some(issue=>(issue.field===field||issue.field.startsWith(field+'.'))&&issue.message?.includes('control characters'));
    const label=control?text('Remove hidden or unsupported characters.','احذف المحارف المخفية أو غير المدعومة.'):
      field==='name'?text('Use a page name between 2 and 100 characters.','اكتب اسم صفحة من حرفين إلى 100 حرف.'):
      field==='category'?text('Choose a category for your page.','اختر فئة لصفحتك.'):
      field==='bio'?text('Keep the introduction within 160 characters, or leave it empty.','اكتب نبذة لا تتجاوز 160 حرفاً، أو اتركها فارغة.'):
      field==='description'?text('Keep the description within 2,000 characters.','يجب ألا يتجاوز الوصف 2000 حرف.'):
      field==='country'||field==='city'?text('Use no more than 100 characters.','استخدم 100 حرف كحد أقصى.'):
      field==='publicEmail'?text('Enter an email such as name@example.com, or leave it empty.','أدخل بريداً مثل name@example.com، أو اتركه فارغاً.'):
      field==='publicPhone'?text('Use at least five digits; +, spaces, parentheses and hyphens are allowed.','أدخل خمسة أرقام على الأقل؛ يمكن استخدام + والمسافات والأقواس والشرطة.'):
      field==='website'||field.endsWith('.url')?text('Enter a valid website, such as example.com. HTTP and HTTPS only; no embedded login details.','أدخل موقعاً صحيحاً مثل example.com باستخدام HTTP أو HTTPS وبدون بيانات دخول داخل الرابط.'):
      field.endsWith('.title')?text('Add a link title of 1–50 characters, or remove this link.','أضف عنواناً للرابط من حرف إلى 50 حرفاً، أو احذف الرابط.'):
      text('Complete this field or remove the optional entry.','أكمل هذا الحقل أو احذف الإدخال الاختياري.');
    return <small id={'page-error-'+field} role="alert" style={{color:'#97263b'}}>{label}</small>;
  };
  const change=<K extends keyof PageInfo>(key:K,value:PageInfo[K])=>{
    const next={...info,[key]:value};
    if((next.cta==='WEBSITE'&&!next.website?.trim())||(next.cta==='EMAIL'&&!next.publicEmail?.trim())||(next.cta==='PHONE'&&!next.publicPhone?.trim()))next.cta=null;
    onChange(next);
  };
  return <div className="pages-form-grid">{basic ? <>
    <label className="pages-field wide">{text('Page name','اسم الصفحة')}<input {...fieldProps('name')} required value={info.name} onChange={event=>change('name',event.target.value)} autoComplete="organization"/><small>{pageTextLength(info.name)}/100</small>{fieldError('name')}</label>
    {children}
    <label className="pages-field wide">{text('Category','الفئة')}<select {...fieldProps('category')} required value={info.category} onChange={event=>change('category',event.target.value)}>
      <option value="" disabled>{text('Choose a category','اختر الفئة')}</option>
      {([['company','Company or organization','شركة أو مؤسسة'],['project','Project or brand','مشروع أو علامة تجارية'],['institution','Institution or community','جهة أو مجتمع'],['creator','Creator','صانع محتوى'],['other','Other','أخرى']] as const).map(([value,en,ar])=><option key={value} value={value}>{text(en,ar)}</option>)}
    </select>{fieldError('category')}</label>
    {!minimal&&<label className="pages-field wide">{text('Short introduction (optional)','نبذة قصيرة (اختياري)')}<textarea {...fieldProps('bio')} value={info.bio} onChange={event=>change('bio',event.target.value)}/><small>{pageTextLength(info.bio)}/160</small>{fieldError('bio')}</label>}
  </> : <>
    <label className="pages-field wide">{text('About your page','عن الصفحة')}<textarea {...fieldProps('description')} value={info.description} onChange={event=>change('description',event.target.value)}/>{fieldError('description')}</label>
    <label className="pages-field">{text('Country (optional)','الدولة (اختياري)')}<input {...fieldProps('country')} autoComplete="country-name" value={info.country} onChange={event=>change('country',event.target.value)}/>{fieldError('country')}</label>
    <label className="pages-field">{text('City (optional)','المدينة (اختياري)')}<input {...fieldProps('city')} autoComplete="address-level2" value={info.city} onChange={event=>change('city',event.target.value)}/>{fieldError('city')}</label>
    <label className="pages-field wide">{text('Website (optional)','الموقع الإلكتروني (اختياري)')}<input {...fieldProps('website')} type="text" inputMode="url" dir="ltr" placeholder="example.com" value={info.website||''} onChange={event=>change('website',event.target.value||null)} onBlur={()=>change('website',info.website?.trim()?normalizePageUrl(info.website):null)}/><small>{text('https:// is added automatically.','تُضاف https:// تلقائياً.')}</small>{fieldError('website')}</label>
    <div className="pages-field wide"><div className="pages-notice">{text('Contact details below will be public. Add only information you want everyone to see.','ستظهر بيانات التواصل التالية للجمهور. أضف فقط ما تريد إتاحته للجميع.')}</div></div>
    <label className="pages-field">{text('Public contact email (optional)','بريد التواصل العام (اختياري)')}<input {...fieldProps('publicEmail')} type="email" dir="ltr" autoComplete="off" value={info.publicEmail||''} onChange={event=>change('publicEmail',event.target.value||null)}/>{fieldError('publicEmail')}</label>
    <label className="pages-field">{text('Public phone (optional)','هاتف التواصل العام (اختياري)')}<input {...fieldProps('publicPhone')} type="tel" dir="ltr" autoComplete="off" placeholder="+962 79 123 4567" value={info.publicPhone||''} onChange={event=>change('publicPhone',event.target.value||null)} onBlur={()=>change('publicPhone',info.publicPhone?.trim()?normalizePagePhone(info.publicPhone):null)}/><small>{text('Arabic and English digits are accepted.','تُقبل الأرقام العربية والإنجليزية.')}</small>{fieldError('publicPhone')}</label>
    <label className="pages-field wide">{text('Contact button','زر التواصل')}<select {...fieldProps('cta')} value={info.cta||''} onChange={event=>change('cta',event.target.value as PageInfo['cta']||null)}><option value="">{text('No button','بدون زر')}</option><option value="WEBSITE" disabled={!info.website}>{text('Visit website','زيارة الموقع')}</option><option value="EMAIL" disabled={!info.publicEmail}>{text('Send email','إرسال بريد')}</option><option value="PHONE" disabled={!info.publicPhone}>{text('Call','اتصال')}</option></select>{fieldError('cta')}</label>
    <div className="pages-field wide"><span>{text('Additional links (up to 3)','روابط إضافية (حتى 3)')}</span>{fieldError('links')}{info.links.map((link,index)=><div key={index} className="pages-form-grid"><label className="pages-field">{text('Link title','عنوان الرابط')}<input {...fieldProps('links.'+index+'.title')} required={!!link.url.trim()} value={link.title} onChange={event=>change('links',info.links.map((item,i)=>i===index?{...item,title:event.target.value}:item))}/>{fieldError('links.'+index+'.title')}</label><label className="pages-field">{text('Address','العنوان الإلكتروني')}<input {...fieldProps('links.'+index+'.url')} required={!!link.title.trim()} type="text" inputMode="url" dir="ltr" placeholder="example.com" value={link.url} onChange={event=>change('links',info.links.map((item,i)=>i===index?{...item,url:event.target.value}:item))}/>{fieldError('links.'+index+'.url')}</label><button type="button" className="pages-button" onClick={()=>change('links',info.links.filter((_,i)=>i!==index))}>{text('Remove link','إزالة الرابط')}</button></div>)}{info.links.length<3 && <button type="button" className="pages-button" onClick={()=>change('links',[...info.links,{title:'',url:''}])}>{text('Add a link','إضافة رابط')}</button>}</div>
  </>}</div>;
}

export function PageAbout({page}:{page:BusinessPage}) {
  const {text,ar}=usePageText();
  return <section className="pages-panel pages-about"><div className="pages-panel-body"><h2>{text('About','حول الصفحة')}</h2><dl>
    <div><dt>{text('Category','الفئة')}</dt><dd>{({company:text('Company or organization','شركة أو مؤسسة'),project:text('Project or brand','مشروع أو علامة تجارية'),institution:text('Institution or community','جهة أو مجتمع'),creator:text('Creator','صانع محتوى'),other:text('Other','أخرى')} as Record<string,string>)[page.category]||page.category}</dd></div>
    {(page.description||page.bio) && <div><dt>{text('Introduction','نبذة')}</dt><dd style={{whiteSpace:'pre-wrap'}}>{page.description||page.bio}</dd></div>}
    {(page.country||page.city) && <div><dt>{text('Location','الموقع')}</dt><dd>{[page.city,page.country].filter(Boolean).join(' · ')}</dd></div>}
    {page.website && <div><dt>{text('Website','الموقع الإلكتروني')}</dt><dd><a href={page.website} target="_blank" rel="noopener noreferrer" dir="ltr">{page.website}</a></dd></div>}
    {page.publicEmail && <div><dt>{text('Contact email','بريد التواصل')}</dt><dd><a href={'mailto:'+page.publicEmail} dir="ltr">{page.publicEmail}</a></dd></div>}
    {page.publicPhone && <div><dt>{text('Phone','الهاتف')}</dt><dd><a href={'tel:'+page.publicPhone.replace(/[ ()-]/g,'')} dir="ltr">{page.publicPhone}</a></dd></div>}
    {page.links.map(link=><div key={link.url}><dd><a href={link.url} target="_blank" rel="noopener noreferrer">{link.title}</a></dd></div>)}
    <div><dt>{text('Page created','تاريخ إنشاء الصفحة')}</dt><dd>{new Date(page.createdAt).toLocaleDateString(ar?'ar':'en',{year:'numeric',month:'long',day:'numeric'})}</dd></div>
  </dl></div></section>;
}
