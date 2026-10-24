import React, { useEffect, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useSearchParams } from 'react-router-dom';
import { BusinessPage, pagesApi } from '../../services/pagesApi';
import { emptyPageInfo, PageError, PageFields, PageLoading, usePageText } from './PageUi';

export function PageCreate() {
  const { text } = usePageText();
  const navigate = useNavigate();
  const [query] = useSearchParams();
  const draftId = query.get('draft');
  const [info, setInfo] = useState({ ...emptyPageInfo, category: '' });
  const [confirmed, setConfirmed] = useState(false);
  const [page, setPage] = useState<BusinessPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!!draftId);
  const [error, setError] = useState<unknown>(null);
  const [draftRetry, setDraftRetry] = useState(0);
  const requestId = useRef(crypto.randomUUID());
  const leaveSaved = useRef(false);
  const unsaved = page ? info.name !== page.name || info.category !== page.category
    : !!info.name || !!info.category || confirmed;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (leaveSaved.current) { leaveSaved.current = false; return false; }
    return unsaved && currentLocation.pathname !== nextLocation.pathname;
  });
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm(text('Discard your unsaved Page changes?', 'هل تريد تجاهل تعديلات الصفحة غير المحفوظة؟'))) blocker.proceed();
    else blocker.reset();
  }, [blocker, text]);
  useEffect(() => {
    if (!draftId) { setLoading(false); return; }
    const abort = new AbortController();
    setLoading(true); setError(null);
    pagesApi.manage(draftId, abort.signal).then(value => {
      if (abort.signal.aborted) return;
      if (value.publicationState !== 'DRAFT' || !value.capabilities?.includes('editInfo')) {
        navigate('/pages/manage/' + value.id, { replace: true }); return;
      }
      setPage(value); setInfo({ ...emptyPageInfo, name: value.name, category: value.category }); setConfirmed(true);
    }).catch(value => { if (!abort.signal.aborted) setError(value); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [draftId, draftRetry, navigate]);

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || (draftId && !page)) return;
    const publish = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') !== 'draft';
    setBusy(true); setError(null);
    try {
      let current = page;
      if (!current) {
        current = await pagesApi.create({ name: info.name, category: info.category,
          representationConfirmed: confirmed, requestId: requestId.current });
      }
      if (info.name.trim() !== current.name || info.category !== current.category) {
        // Resumed drafts retain all previously saved optional details.
        current = await pagesApi.update(current.id, { name: info.name, category: info.category });
      }
      setPage(current);
      // Keep the saved draft when publication fails, so Retry never creates a duplicate.
      if (publish) await pagesApi.lifecycle(current.id, 'publish');
      leaveSaved.current = true;
      navigate('/pages/manage/' + current.id + (publish ? '?created=1' : '?saved=1'), { replace: true });
    } catch (value) { setError(value); }
    finally { setBusy(false); }
  };
  if (loading) return <PageLoading />;
  if (draftId && !page) return <PageError error={error} retry={() => setDraftRetry(value => value + 1)} />;
  return <div className="pages-content"><div className="pages-form">
    <p className="pages-kicker">{text('YOUR SPACE ON OPINIUP', 'مساحتك على OPINIUP')}</p>
    <h1 className="pages-heading">{text('Create your page', 'أنشئ صفحتك')}</h1>
    <p className="pages-muted">{text('Start with a name and category. Add your introduction, photos and contact details later.', 'ابدأ بالاسم والفئة فقط. أضف النبذة والصور وبيانات التواصل لاحقاً.')}</p>
    {error && <PageError error={error} />}
    <form className="pages-panel" onSubmit={save}><div className="pages-panel-body">
      <PageFields info={info} onChange={setInfo} error={error} basic minimal />
      <p className="pages-muted">{text('A page address is created automatically. You can customize it later in Settings.', 'يُنشأ عنوان الصفحة تلقائياً، ويمكنك تخصيصه لاحقاً من الإعدادات.')}</p>
      <label className="pages-check"><input type="checkbox" required checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>{text('I am authorized to represent this page.', 'أنا مخوّل بتمثيل هذه الصفحة.')}</span></label>
      <div className="pages-notice">{text('Create and publish makes your page public. Save a draft to keep it private until you are ready.', 'إنشاء ونشر يجعل صفحتك عامة. احفظ مسودة لتبقى غير منشورة حتى تكون مستعداً.')}</div>
      <div className="pages-form-footer"><Link className="pages-button" to="/pages/mine">{text('Cancel', 'إلغاء')}</Link><div className="pages-actions">
        <button type="submit" value="draft" className="pages-button" disabled={busy}>{text('Save and finish later', 'حفظ والإكمال لاحقاً')}</button>
        <button type="submit" value="publish" className="pages-button primary" disabled={busy}>{busy ? text('Saving…', 'جارٍ الحفظ…') : text('Create and publish', 'إنشاء ونشر الصفحة')}</button>
      </div></div>
    </div></form>
  </div></div>;
}
