import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, UploadCloud, ArrowLeft, Video, ListChecks, HelpCircle, Pause, Play, Square } from 'lucide-react';
import { Upload } from 'tus-js-client';
import { Survey, SurveyType, UserProfile, Group } from '../../types';
import { reelsApi, ReelsApiError, ReelsConfig, VideoUpload } from '../../services/reelsApi';
import { ReelEditorContext } from './ReelEditorContext';
import { ReelPlayer } from './ReelPlayer';
const PollEditor = React.lazy(() => import('../CreatePollScreen').then(m => ({ default: m.CreatePollScreen })));
const SurveyEditor = React.lazy(() => import('../CreateSurveyModal').then(m => ({ default: m.CreateSurveyModal })));
const QuizEditor = React.lazy(() => import('../CreateQuizModal').then(m => ({ default: m.CreateQuizModal })));

export function CreateReelScreen({ userProfile, draft, userGroups, initialGroupId, onSubmit, onSaveDraft, onClose }: { userProfile: UserProfile; draft?: Survey; userGroups: Group[]; initialGroupId?: string | null; onSubmit: (data: Partial<Survey>) => Promise<void>; onSaveDraft: (data: Partial<Survey>) => Promise<void>; onClose: () => void }) {
  const { i18n } = useTranslation(); const ar = i18n.language.startsWith('ar');
  const [config, setConfig] = useState<ReelsConfig>(); const [error, setError] = useState('');
  const [file, setFile] = useState<File>(); const [src, setSrc] = useState('');
  const [asset, setAsset] = useState<VideoUpload | undefined>(draft?.videoAssetId ? { id: draft.videoAssetId, status: 'READY', uploadUrl: '' } : undefined);
  const [status, setStatus] = useState(draft?.videoAssetId ? 'READY' : 'EMPTY'); const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<'video' | 'editor' | 'preview'>('video'); const stageRef = useRef(stage); stageRef.current = stage;
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => { container.current?.scrollTo({ top: 0, behavior: 'instant' }); }, [stage]);
  const [kind, setKind] = useState<SurveyType>(draft?.type || SurveyType.POLL);
  const [editorVisited, setEditorVisited] = useState(false);
  const [payload, setPayload] = useState<Partial<Survey>>(); const [publishing, setPublishing] = useState(false);
  const [recording, setRecording] = useState(false); const [recordSeconds, setRecordSeconds] = useState(0);
  const [recordPending, setRecordPending] = useState(false); const recordingSlot = useRef(false); const recordingGeneration = useRef(0);
  const input = useRef<HTMLInputElement>(null); const recorder = useRef<MediaRecorder>(); const stream = useRef<MediaStream>(); const camera = useRef<HTMLVideoElement>(null);
  const tus = useRef<Upload>(); const alive = useRef(true); const pollTimer = useRef<ReturnType<typeof setTimeout>>(); const recordingTimer = useRef<ReturnType<typeof setInterval>>();
  const generation = useRef(0); const requestKey = useRef(crypto.randomUUID());
  useEffect(() => { alive.current = true; const abort = new AbortController(); void reelsApi.config(abort.signal).then(setConfig).catch(() => { if (!abort.signal.aborted) setError(ar ? 'تعذر تحميل إعدادات الفيديو.' : 'Unable to load video settings.'); }); return () => { alive.current = false; abort.abort(); generation.current++; recordingGeneration.current++; recordingSlot.current = false; clearTimeout(pollTimer.current); clearInterval(recordingTimer.current); void tus.current?.abort(); if (recorder.current?.state === 'recording') recorder.current.stop(); stream.current?.getTracks().forEach(track => track.stop()); }; }, []);
  useEffect(() => { if (!file) return; const url = URL.createObjectURL(file); setSrc(url); return () => URL.revokeObjectURL(url); }, [file]);
  useEffect(() => { if (recording && camera.current && stream.current) camera.current.srcObject = stream.current; }, [recording]);
  const selectFile = async (selected: File) => {
    if (!config?.enabled) return;
    if (!['video/mp4', 'video/webm', 'video/quicktime'].includes(selected.type) || !selected.size || selected.size > config.maxBytes) { setError(ar ? 'اختر فيديو MP4 أو MOV أو WebM بحجم لا يتجاوز 150 ميجابايت.' : 'Choose an MP4, MOV or WebM video up to 150 MB.'); return; }
    generation.current++; clearTimeout(pollTimer.current); await tus.current?.abort();
    if (asset && !draft) void reelsApi.cancel(asset.id).catch(() => {});
    requestKey.current = crypto.randomUUID(); setAsset(undefined); setFile(selected); setStatus('SELECTED'); setProgress(0); setError('');
  };
  const poll = async (id: string, version: number) => {
    if (!alive.current || generation.current !== version) return;
    try {
      const result = await reelsApi.status(id);
      if (!alive.current || generation.current !== version) return;
      setStatus(result.status);
      if (result.status === 'FAILED' || result.status === 'DELETED') { setError(ar ? 'تعذرت معالجة الفيديو. اختر ملفًا صالحًا لا يتجاوز 60 ثانية.' : 'Video processing failed. Choose a valid video up to 60 seconds.'); return; }
      if (result.status !== 'READY') pollTimer.current = setTimeout(() => void poll(id, version), 4000);
    } catch { if (alive.current && generation.current === version) { setError(ar ? 'انقطع الاتصال. أعد المحاولة للتحقق من الفيديو.' : 'Connection interrupted. Retry to check your video.'); setStatus('CHECK_FAILED'); } }
  };
  const upload = async () => {
    if (!file || !config?.enabled) return;
    const version = generation.current; setError(''); setStatus('UPLOADING');
    try {
      let session = asset;
      if (!session) {
        try { session = await reelsApi.upload(file, requestKey.current); }
        catch (e) {
          // Retain the receipt after ambiguous failures. Rotate only after the
          // server confirms that this upload can no longer be resumed.
          if (!(e instanceof ReelsApiError) || e.code !== 'UPLOAD_EXPIRED' || !alive.current || generation.current !== version) throw e;
          requestKey.current = crypto.randomUUID();
          session = await reelsApi.upload(file, requestKey.current);
        }
      }
      if (!alive.current || generation.current !== version) return;
      setAsset(session);
      const transfer = new Upload(file, { uploadUrl: session.uploadUrl, chunkSize: 5 * 1024 * 1024, retryDelays: [0, 1000, 3000, 5000, 10000], storeFingerprintForResuming: false,
        onProgress: (sent, total) => { if (alive.current && generation.current === version) setProgress(Math.round(sent / total * 100)); },
        onError: () => { if (alive.current && generation.current === version) { setStatus('PAUSED'); setError(ar ? 'توقف الرفع. يمكنك استكماله.' : 'Upload paused. You can resume it.'); } },
        onSuccess: () => { if (alive.current && generation.current === version) { setStatus('PROCESSING'); void poll(session.id, version); } }
      }); tus.current = transfer; transfer.start();
    } catch (e) { if (alive.current && generation.current === version) { setStatus('SELECTED'); setError(e instanceof Error ? e.message : 'Upload failed'); } }
  };
  const record = async () => {
    if (recordingSlot.current || !config?.enabled) return;
    recordingSlot.current = true; setRecordPending(true);
    const request = ++recordingGeneration.current;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { input.current?.setAttribute('capture', 'environment'); input.current?.click(); recordingSlot.current = false; return; }
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 720 }, height: { ideal: 1280 } }, audio: true });
      if (!alive.current || request !== recordingGeneration.current) { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media;
      const mime = ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find(value => MediaRecorder.isTypeSupported(value));
      const capture = new MediaRecorder(media, mime ? { mimeType: mime, videoBitsPerSecond: 4_000_000 } : undefined); const chunks: Blob[] = [];
      let captureTimer: ReturnType<typeof setInterval> | undefined;
      capture.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      capture.onstop = () => { clearInterval(captureTimer); media.getTracks().forEach(track => track.stop()); if (!alive.current || request !== recordingGeneration.current) return; recordingSlot.current = false; setRecording(false); const type = capture.mimeType.split(';')[0] || 'video/webm'; void selectFile(new File(chunks, `reel.${type === 'video/mp4' ? 'mp4' : 'webm'}`, { type })); };
      capture.onerror = () => { clearInterval(captureTimer); media.getTracks().forEach(track => track.stop()); if (alive.current && request === recordingGeneration.current) { recordingGeneration.current++; recordingSlot.current = false; setRecordPending(false); setRecording(false); setError(ar ? 'تعذر تسجيل الفيديو.' : 'Unable to record video.'); } };
      recorder.current = capture; capture.start(1000); setRecording(true); setRecordSeconds(0); const started = Date.now();
      captureTimer = setInterval(() => { const seconds = Math.floor((Date.now() - started) / 1000); setRecordSeconds(seconds); if (seconds >= (config?.maxSeconds || 60) && capture.state === 'recording') capture.stop(); }, 250);
      recordingTimer.current = captureTimer;
    } catch { if (request === recordingGeneration.current) { recordingSlot.current = false; stream.current?.getTracks().forEach(track => track.stop()); if (alive.current) setError(ar ? 'اسمح باستخدام الكاميرا والميكروفون، أو حمّل فيديو من جهازك.' : 'Allow camera and microphone access, or upload a video from your device.'); } }
    finally { if (alive.current && request === recordingGeneration.current) setRecordPending(false); }
  };
  const decorate = (data: Partial<Survey>) => ({ ...data, presentationFormat: 'REEL' as const, videoAssetId: asset!.id, allowUserOptions: false, demographics: [], ...(kind === SurveyType.QUIZ ? { allowMultipleSelection: false } : {}) });
  const editorProps = { userProfile, userGroups, initialGroupId, draft, onClose: () => { if (stageRef.current !== 'preview') setStage('video'); }, onSubmit: async (data: Partial<Survey>) => {
    const questions = data.sections?.flatMap(section => section.questions) || [{ options: data.options }];
    if (questions.length > (config?.maxQuestions || 10)) throw new Error(ar ? 'يمكن إضافة 10 أسئلة كحد أقصى للريل.' : 'A Reel supports up to 10 questions.');
    if (questions.some(question => question.options && question.options.length > 6)) throw new Error(ar ? 'يمكن إضافة 6 إجابات كحد أقصى لكل سؤال.' : 'Each question supports up to 6 answers.');
    setPayload(decorate(data)); stageRef.current = 'preview'; setStage('preview');
  }, onSaveDraft: async (data: Partial<Survey>) => { await onSaveDraft(decorate(data)); onClose(); } };
  const busy = ['UPLOADING', 'PROCESSING', 'CREATING'].includes(status);
  return <div ref={container} className="fixed inset-0 z-50 bg-white overflow-y-auto" dir={ar ? 'rtl' : 'ltr'}>
    {editorVisited && <div style={{ display: stage === 'editor' ? undefined : 'none' }}><ReelEditorContext.Provider value={true}><React.Suspense fallback={<p className="p-8" role="status">{ar ? 'تحميل…' : 'Loading…'}</p>}>{kind === SurveyType.POLL ? <PollEditor {...editorProps} /> : kind === SurveyType.QUIZ ? <QuizEditor isOpen {...editorProps} /> : <SurveyEditor isOpen {...editorProps} />}</React.Suspense></ReelEditorContext.Provider></div>}
    {stage !== 'editor' && <div className="max-w-md mx-auto min-h-full pb-10">
      <header className="sticky top-0 z-10 bg-white border-b border-gray-100 flex items-center justify-between px-4 py-3"><button className="p-3 text-gray-500" aria-label={ar ? 'رجوع' : 'Back'} disabled={publishing} onClick={() => { if (stage === 'preview') setStage('editor'); else if (!busy || window.confirm(ar ? 'إيقاف الرفع ومغادرة الإنشاء؟' : 'Stop uploading and leave?')) onClose(); }}><ArrowLeft size={20} className={ar ? 'rotate-180' : ''} /></button><div className="text-center"><h1 className="text-sm font-bold">{ar ? 'ريل جديد' : 'New Reel'}</h1><p className="text-xs text-gray-500">{stage === 'video' ? (ar ? 'الفيديو' : 'Video') : (ar ? 'المعاينة والنشر' : 'Preview & publish')}</p></div><span className="w-10" /></header>
      <main className="p-5 space-y-5">
        {!config && !error && <p role="status">{ar ? 'تحميل إعدادات الفيديو…' : 'Loading video settings…'}</p>}
        {config && !config.enabled && <div className="rounded-2xl bg-blue-50 text-blue-900 p-5"><Video className="mb-3" /><p>{ar ? 'إنشاء الريلز غير متاح حاليًا. يرجى المحاولة لاحقًا.' : 'Reel creation is not available yet. Please try again later.'}</p></div>}
        {(src || asset?.status === 'READY') && !recording && <div className="relative aspect-[9/16] max-h-[48dvh] rounded-2xl overflow-hidden bg-gray-950 mx-auto"><ReelPlayer id={asset?.id || 'local-reel'} localSrc={src || undefined} preview active={stage !== 'editor'} onDuration={duration => { if (Number.isFinite(duration) && duration > (config?.maxSeconds || 60) + 0.1 && status === 'SELECTED') { setError(ar ? 'الحد الأقصى للفيديو 60 ثانية. اختر فيديو أقصر.' : 'Videos can be up to 60 seconds. Choose a shorter video.'); setStatus('INVALID'); } }} /></div>}
        {recording && <div className="space-y-3"><video ref={camera} autoPlay playsInline muted className="w-full aspect-[9/16] max-h-[50dvh] rounded-2xl bg-black" /><div className="flex justify-between items-center"><span role="timer" className="font-mono text-red-600">00:{String(recordSeconds).padStart(2, '0')}</span><button className="flex items-center gap-2 bg-red-600 text-white rounded-xl px-5 py-3" onClick={() => recorder.current?.stop()}><Square size={16} />{ar ? 'إيقاف التسجيل' : 'Stop recording'}</button></div></div>}
        {stage === 'video' && <>
          <input type="file" ref={input} className="hidden" accept="video/mp4,video/webm,video/quicktime" onChange={e => { const selected = e.target.files?.[0]; if (selected) void selectFile(selected); e.target.value = ''; }} />
          <div className="grid grid-cols-2 gap-3"><button disabled={!config?.enabled || busy || recording || recordPending || !!draft} className="border border-gray-200 rounded-2xl p-5 flex flex-col items-center gap-2 disabled:opacity-40" onClick={() => { input.current?.removeAttribute('capture'); input.current?.click(); }}><UploadCloud className="text-blue-600" />{ar ? 'تحميل فيديو' : 'Upload video'}</button><button disabled={!config?.enabled || busy || recording || recordPending || !!draft} className="border border-gray-200 rounded-2xl p-5 flex flex-col items-center gap-2 disabled:opacity-40" onClick={() => void record()}><Camera className="text-blue-600" />{ar ? 'تسجيل فيديو' : 'Record video'}</button></div>
          <p className="text-xs text-gray-500">{ar ? 'حتى 60 ثانية • 150 ميجابايت • يُفضّل الفيديو العمودي' : 'Up to 60 seconds · 150 MB · Vertical video recommended'}</p>
          {status === 'UPLOADING' && <div className="space-y-2"><progress aria-label={ar ? 'تقدم الرفع' : 'Upload progress'} className="w-full accent-blue-600" max={100} value={progress} /><div className="flex justify-between text-sm"><span>{progress}%</span><button onClick={() => { void tus.current?.abort(); setStatus('PAUSED'); }} className="flex gap-1"><Pause size={16} />{ar ? 'إيقاف مؤقت' : 'Pause'}</button></div></div>}
          {['PROCESSING', 'CREATING'].includes(status) && <p role="status" className="text-sm text-blue-600">{ar ? 'جارٍ تجهيز الفيديو للنشر…' : 'Preparing your video for publishing…'}</p>}
          {['SELECTED', 'PAUSED'].includes(status) && <button className="w-full rounded-xl bg-blue-600 text-white py-3 flex justify-center gap-2" onClick={() => { if (status === 'PAUSED' && tus.current) { setStatus('UPLOADING'); setError(''); tus.current.start(); } else void upload(); }}><Play size={18} />{status === 'PAUSED' ? (ar ? 'استكمال الرفع' : 'Resume upload') : (ar ? 'رفع وتجهيز الفيديو' : 'Upload & prepare video')}</button>}
          {status === 'CHECK_FAILED' && asset && <button className="text-blue-600 underline" onClick={() => { setError(''); setStatus('PROCESSING'); void poll(asset.id, generation.current); }}>{ar ? 'التحقق مجددًا' : 'Check again'}</button>}
          {status === 'READY' && <section className="space-y-3"><h2 className="font-bold text-sm">{ar ? 'ماذا تريد أن تضيف للريل؟' : 'What would you like to add?'}</h2>{[[SurveyType.POLL, ar ? 'سؤال واحد' : 'One question', HelpCircle], [SurveyType.SURVEY, ar ? 'عدة أسئلة' : 'Multiple questions', ListChecks], [SurveyType.QUIZ, ar ? 'اختبار' : 'Quiz', ListChecks]].map(([value, label, Icon]: any[]) => <button key={value} disabled={!!draft && value !== draft.type} aria-pressed={kind === value} onClick={() => setKind(value)} className={`w-full flex items-center gap-3 rounded-xl border p-4 text-sm disabled:opacity-40 ${kind === value ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-100'}`}><Icon size={19} />{label}</button>)}<button className="w-full rounded-xl bg-blue-600 text-white py-3 font-bold" onClick={() => { setEditorVisited(true); setStage('editor'); }}>{ar ? 'التالي: الأسئلة والإعدادات' : 'Next: questions & settings'}</button></section>}
        </>}
        {stage === 'preview' && payload && <section className="space-y-4"><h2 className="font-bold text-lg" dir="auto">{payload.title}</h2><p className="text-sm text-gray-500" dir="auto">{payload.description}</p>{(payload.sections?.flatMap(s => s.questions) || [{ id: 'poll', text: payload.title, options: payload.options }]).map(q => <div key={q.id} className="rounded-xl border border-gray-100 p-4 space-y-2"><h3 className="text-sm font-bold" dir="auto">{q.text}</h3>{q.options?.map(option => <div key={option.id} dir="auto" className="rounded-xl border border-gray-200 p-3 text-sm">{option.text}</div>)}</div>)}<p className="text-xs text-gray-500">{ar ? 'مدة الإجابة تنطبق على الأسئلة فقط. يبقى الفيديو قابلًا للمشاهدة.' : 'The response duration applies to questions. The video remains watchable.'}</p><button disabled={publishing} className="w-full rounded-xl bg-blue-600 text-white py-3 font-bold disabled:opacity-50" onClick={async () => { setPublishing(true); setError(''); try { await onSubmit(payload); onClose(); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to publish'); } finally { setPublishing(false); } }}>{publishing ? (ar ? 'جارٍ النشر…' : 'Publishing…') : (ar ? 'نشر الريل' : 'Publish Reel')}</button></section>}
        {error && <p role="alert" className="rounded-xl bg-red-50 text-red-700 text-sm p-3">{error}</p>}
      </main>
    </div>}
  </div>;
}
