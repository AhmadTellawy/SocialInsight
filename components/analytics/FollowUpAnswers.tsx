import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, LockKeyhole, MessageSquareText } from 'lucide-react';
import { api, getAuthSessionIdentity } from '../../services/api';
import { pageRequest } from '../../services/pagesApi';
import { BottomSheet } from '../BottomSheet';

type Group = { questionId: string; questionText: string; optionId: string; optionText: string; followUpLabel: string; answerCount: number };
type Overview = { version: 1; scope: 'all' | 'own' | 'none'; groups: Group[]; totalAnswers: number };
type Answer = { id: string; text: string; isAnonymous: boolean; displayName: string | null };
type AnswerPage = { version: 1; scope: 'all' | 'own'; items: Answer[]; nextCursor: string | null };
type Props = { postId: string; privatePageId?: string; questionId?: string; ar: boolean; filtered: boolean };

export function FollowUpAnswers({ postId, privatePageId, questionId, ar, filtered }: Props) {
  const copy = (arabic: string, english: string) => ar ? arabic : english;
  const [overview, setOverview] = useState<Overview | null>(null);
  const [group, setGroup] = useState<Group | null>(null);
  const [items, setItems] = useState<Answer[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState(false);
  const [overviewError, setOverviewError] = useState(false), [attempt, setAttempt] = useState(0);
  const detailController = useRef<AbortController | null>(null);
  const epoch = useRef(0);
  const busy = useRef(false);
  const session = getAuthSessionIdentity();
  const request = (query: string, signal: AbortSignal) => privatePageId
    ? pageRequest('/manage/' + encodeURIComponent(privatePageId) + '/content/' + encodeURIComponent(postId) + '/follow-up-answers' + (query ? '?' + query : ''), 'GET', undefined, signal)
    : api.getPostFollowUpAnswers(postId, signal, query);
  // Raw text lives only in this mounted view. Clear it on backgrounding, account
  // changes and authorization expiry; every detail page checks permission again.
  useEffect(() => {
    let alive = true, timer: number | undefined, controller: AbortController | undefined;
    const clear = () => {
      epoch.current++; controller?.abort(); detailController.current?.abort(); busy.current = false;
      window.clearTimeout(timer); setOverview(null); setGroup(null); setItems([]); setCursor(null); setError(false); setLoading(false);
    };
    const load = async () => {
      clear(); setOverviewError(false);
      if (document.hidden) return;
      controller = new AbortController();
      const current = epoch.current, signal = controller.signal;
      try {
        const data = await request('', signal) as Overview;
        if (!alive || signal.aborted || current !== epoch.current || getAuthSessionIdentity() !== session) return;
        if (data?.version !== 1 || !Array.isArray(data.groups)) throw new Error('Invalid follow-up response');
        setOverview(data);
        timer = window.setTimeout(() => void load(), 30_000);
      } catch (failure: any) {
        if (!alive || signal.aborted || current !== epoch.current) return;
        setOverviewError(![401, 403, 404].includes(failure?.status));
      }
    };
    const visibility = () => { if (document.hidden) clear(); else void load(); };
    const focus = () => { if (!document.hidden) void load(); };
    void load();
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('focus', focus);
    return () => { alive = false; clear(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('focus', focus); };
  }, [postId, privatePageId, questionId, session, attempt]);

  const close = () => {
    epoch.current++; detailController.current?.abort(); busy.current = false;
    setGroup(null); setItems([]); setCursor(null); setError(false); setLoading(false);
  };
  const loadAnswers = async (selected: Group, next: string | null = null) => {
    if (busy.current) return;
    busy.current = true; detailController.current?.abort();
    const controller = new AbortController(); detailController.current = controller;
    const current = epoch.current;
    setGroup(selected); setLoading(true); setError(false);
    if (!next) { setItems([]); setCursor(null); }
    try {
      const query = new URLSearchParams({ optionId: selected.optionId, ...(next ? { cursor: next } : {}) });
      const data = await request(query.toString(), controller.signal) as AnswerPage;
      if (controller.signal.aborted || current !== epoch.current || getAuthSessionIdentity() !== session) return;
      if (data?.version !== 1 || data.scope !== overview?.scope || !Array.isArray(data.items)) throw new Error('Invalid follow-up response');
      setItems(previous => next ? [...previous, ...data.items.filter(item => !previous.some(old => old.id === item.id))] : data.items);
      setCursor(data.nextCursor);
    } catch (failure: any) {
      if (controller.signal.aborted || current !== epoch.current) return;
      if ([401, 403, 404].includes(failure?.status)) { close(); setOverview(null); }
      else { setItems([]); setCursor(null); setError(true); }
    } finally {
      if (current === epoch.current) { busy.current = false; setLoading(false); }
    }
  };
  const groups = overview?.groups.filter(value => !questionId || value.questionId === questionId) || [];
  if (!groups.length && !overviewError) return null;
  const own = overview?.scope === 'own';
  const title = own ? copy('إجابتي على السؤال الإضافي', 'My follow-up answer') : copy('إجابات الأسئلة الإضافية', 'Follow-up answers');
  return <section className="an-followups" aria-label={title}>
    <div className="an-followups-heading"><MessageSquareText size={19} aria-hidden="true" /><h3>{title}</h3></div>
    {overviewError ? <div role="alert"><p>{copy('تعذر تحميل الإجابات الإضافية.', 'Could not load follow-up answers.')}</p><button className="an-text-button" onClick={() => setAttempt(value => value + 1)}>{copy('إعادة المحاولة', 'Retry')}</button></div> : <>
      <p className="an-hint an-followups-privacy"><LockKeyhole size={14} aria-hidden="true" />{own
        ? copy('تظهر هنا إجاباتك فقط. يمكن لصاحب المنشور أو فريق الصفحة المخوّل قراءتها؛ تبقى هويتك مخفية عند التصويت المجهول.', 'Only your answers appear here. The post owner or authorized page team can read them; anonymous votes keep your identity hidden.')
        : copy('خاص بك وبفريق الصفحة المخوّل إن وُجد. المشاركون يرون إجاباتهم فقط، وتبقى الإجابات المجهولة بلا هوية.', 'Private to you and the authorized page team, where applicable. Participants see only their own answers; anonymous answers have no identity.')}</p>
      {filtered && <p className="an-hint">{copy('هذه الإجابات لا تتأثر بالفلاتر الديموغرافية.', 'These answers are not filtered by demographics.')}</p>}
      {groups.map(value => <button className="an-followup-group" key={value.optionId} onClick={() => void loadAnswers(value)}>
        <span><strong>{value.optionText}</strong><span className="an-followup-question">{value.followUpLabel || copy('السؤال الإضافي', 'Follow-up question')}</span></span>
        <span className="an-followup-action"><span>{own ? copy('عرض إجابتي', 'View my answer') : `${value.answerCount} ${copy('إجابة', 'answers')}`}</span>{ar ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}</span>
      </button>)}
    </>}
    <BottomSheet isOpen={!!group} onClose={close} title={title} showCloseButton closeLabel={copy('إغلاق', 'Close')}>
      <div className="an-root an-followup-sheet" dir={ar ? 'rtl' : 'ltr'}>
        <div className="an-followup-context"><span className="an-hint">{group?.optionText}</span><h3>{group?.followUpLabel || copy('السؤال الإضافي', 'Follow-up question')}</h3><p className="an-hint">{own ? copy('إجابتك فقط', 'Your answer only') : copy('إجابات خاصة · الهوية المجهولة محمية', 'Private answers · Anonymous identities protected')}</p></div>
        <div className="an-followup-list" aria-live="polite" aria-busy={loading}>
          {items.map(item => <article className="an-followup-answer" key={item.id}><strong>{own ? copy('أنت', 'You') : item.isAnonymous ? copy('مشارك مجهول', 'Anonymous participant') : item.displayName || copy('مشارك', 'Participant')}</strong>{own && item.isAnonymous && <span className="an-hint"> · {copy('إجابة مجهولة', 'Anonymous answer')}</span>}<p dir="auto">{item.text}</p></article>)}
          {loading && <p role="status" className="an-hint">{copy('جارٍ تحميل الإجابات…', 'Loading answers…')}</p>}
          {error && <div role="alert"><p>{copy('تعذر تحميل الإجابات.', 'Could not load answers.')}</p><button className="an-text-button" onClick={() => group && void loadAnswers(group)}>{copy('إعادة المحاولة', 'Retry')}</button></div>}
          {!loading && !error && !items.length && <p className="an-empty">{copy('لا توجد إجابات إضافية بعد.', 'No follow-up answers yet.')}</p>}
          {cursor && !error && <button className="an-primary" disabled={loading} onClick={() => group && void loadAnswers(group, cursor)}>{copy('عرض المزيد', 'Load more')}</button>}
        </div>
      </div>
    </BottomSheet>
  </section>;
}
