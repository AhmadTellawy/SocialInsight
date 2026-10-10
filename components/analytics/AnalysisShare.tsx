import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Images, SquarePen } from 'lucide-react';
import type { AnalysisResults } from '../../utils/analysis';
import { BottomSheet } from '../BottomSheet';
import { AnswerRows, formatAnalysisNumber, type AnalysisQuestion } from './ResultsAnalysis';

type Props = { open: boolean; onClose: () => void; results: AnalysisResults; questions: AnalysisQuestion[]; activeQuestionId: string; scope: string; sourceTitle: string; ar: boolean };
export function AnalysisShare({ open, onClose, results, questions, activeQuestionId, scope, sourceTitle, ar }: Props) {
  const copy = (arabic: string, english: string) => ar ? arabic : english;
  const [view, setView] = useState<'menu' | 'images' | 'preview' | 'post'>('menu');
  const [selected, setSelected] = useState<string[]>([]), [index, setIndex] = useState(0), [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const cardRef = useRef<HTMLDivElement>(null), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (open) { setView('menu'); setError(''); } }, [open]);
  const cards = results.questionSummaries.filter(summary => summary.responseCount > 0);
  const summary = cards.find(value => value.questionId === (view === 'post' ? activeQuestionId : selected[index]));
  const question = questions.find(value => value.id === summary?.questionId) || questions[0];
  const exportImage = async () => {
    if (!cardRef.current || !summary || busy) return;
    const element = cardRef.current; setBusy(true); setError('');
    try {
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(element, { backgroundColor: '#fff', scale: 2, logging: false });
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error()), 'image/png'));
      if (!alive.current || !element.isConnected) return;
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `opiniup-results-${index + 1}.png`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { if (alive.current) setError(copy('تعذر إنشاء الصورة. حاول مجددًا.', 'Could not create the image. Please try again.')); }
    finally { if (alive.current) setBusy(false); }
  };
  const title = view === 'menu' ? copy('مشاركة التحليل', 'Share analysis') : view === 'images' ? copy('اختيار صور النتائج', 'Select result images') : view === 'preview' ? copy('معاينة صور النتائج', 'Preview result images') : copy('معاينة منشور النتائج', 'Results post preview');
  return <BottomSheet isOpen={open} onClose={onClose} title={title} dismissDisabled={busy}><div className="an-root an-sheet-content" dir={ar ? 'rtl' : 'ltr'}>
    {view === 'menu' && <><button className="an-share-option" onClick={() => { setSelected(cards.map(value => value.questionId)); setIndex(0); setView('images'); }}><Images /><span><strong>{copy('صور خارج التطبيق', 'Images for sharing')}</strong><small>{copy('صورة لكل نتيجة مع السؤال والعينة والفلاتر', 'Each result with its question, sample and filters')}</small></span></button><button className="an-share-option" onClick={() => setView('post')}><SquarePen /><span><strong>{copy('معاينة منشور النتائج', 'Preview results post')}</strong><small>{copy('معاينة فقط؛ لا تنشر على حسابك', 'Preview only; does not publish to your account')}</small></span></button></>}
    {view === 'images' && <>{cards.map((value, cardIndex) => <label className="an-export-choice" key={value.questionId}><input type="checkbox" checked={selected.includes(value.questionId)} onChange={event => setSelected(current => event.target.checked ? [...current, value.questionId] : current.filter(item => item !== value.questionId))} /><span>{questions.find(item => item.id === value.questionId)?.text || `${copy('السؤال', 'Question')} ${cardIndex + 1}`}</span></label>)}<button className="an-primary" disabled={!selected.length} onClick={() => { setIndex(0); setView('preview'); }}>{copy('معاينة الصور', 'Preview images')} ({selected.length})</button></>}
    {(view === 'preview' || view === 'post') && summary && <>{view === 'post' && <label className="an-field">{copy('تعليقك على النتائج', 'Your comment')}<textarea value={comment} onChange={event => setComment(event.target.value)} /></label>}
      <div className="an-export-card" ref={cardRef}><div className="an-brand"><b dir="ltr">Opini<span>Up</span></b><span>{copy('نتائج الاستطلاع', 'Poll results')}</span></div><h3>{question?.text}</h3><AnswerRows summary={summary} question={question} /><p className="an-hint">{copy('النسب من مجيبي السؤال', 'Percentages of question respondents')}</p><div className="an-card-scope">{scope}<br />{copy('العينة', 'Sample')}: <bdi>{formatAnalysisNumber(summary.responseCount)}</bdi> · {new Date().toLocaleDateString(ar ? 'ar' : 'en')}<br />{sourceTitle}</div></div>
      {view === 'preview' ? <><div className="an-pagination"><button className="an-icon" disabled={index === 0 || busy} onClick={() => setIndex(value => value - 1)} aria-label={copy('الصورة السابقة', 'Previous image')}>{ar ? <ChevronRight /> : <ChevronLeft />}</button><bdi>{index + 1} / {selected.length}</bdi><button className="an-icon" disabled={index >= selected.length - 1 || busy} onClick={() => setIndex(value => value + 1)} aria-label={copy('الصورة التالية', 'Next image')}>{ar ? <ChevronLeft /> : <ChevronRight />}</button></div><button className="an-primary" onClick={() => void exportImage()} disabled={busy}><Download size={18} />{busy ? copy('جارٍ تجهيز الصورة…', 'Preparing image…') : copy('تنزيل الصورة', 'Download image')}</button><button className="an-text-button" disabled={busy} onClick={() => setView('images')}>{copy('تعديل الصور المختارة', 'Change selected images')}</button>{error && <p role="alert">{error}</p>}</> : <p className="an-hint">{copy('هذه معاينة فقط، ولم يُنشر شيء.', 'This is a preview. Nothing has been published.')}</p>}
    </>}
  </div></BottomSheet>;
}
