
import React, { useMemo, useRef, useState } from 'react';
import {
  Repeat, Check, Share2, Copy, Loader2, ExternalLink, CheckCircle2, ChevronRight
} from 'lucide-react';
import { PagePublisher, usePagePublisher } from './pages/PagePublisher';
import { Survey } from '../types';
import { Analytics } from '../utils/analytics';
import { UserProfile } from '../types';
import { UserAvatar } from './UserAvatar';
import { useTranslation } from 'react-i18next';
import { ShareCard } from './share/ShareCard';
import { RichMentionInput } from './RichMentionInput';
import { shareWithFileFallback } from '../utils/nativeShare';
import {
  SHARE_CARD_SIZE,
  buildCanonicalPostUrl,
  buildShareCardViewModel,
  getCanonicalHost,
  resolveCanonicalOrigin
} from '../utils/shareCard';

interface ShareSheetProps {
  survey: Survey;
  onClose: () => void;
  onShareToFeed?: (survey: Survey, caption: string, publisher?: {pageId:string;pageCreateKey:string}) => Promise<'shared' | 'unshared'>;
  onBusyChange?: (busy: boolean) => void;
  userProfile?: UserProfile;
  onAuthorClick?: (author: { name: string; avatar: string }) => void;
  sourceSurface?: string;
  initialStep?: 'menu' | 'contacts' | 'feed' | 'repost-editor';
}

const waitForCaptureAssets = async (root: HTMLElement, timeoutMs = 5000): Promise<void> => {
  if (document.fonts?.ready) await document.fonts.ready;
  const deadline = Date.now() + timeoutMs;
  while (root.querySelector('[aria-busy="true"]') && Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  const images = Array.from(root.querySelectorAll('img'));
  images.forEach((image) => { image.loading = 'eager'; });
  await Promise.all(images.map((image) => {
    if (image.complete) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timeout = window.setTimeout(done, timeoutMs);
      function done(): void {
        window.clearTimeout(timeout);
        image.removeEventListener('load', done);
        image.removeEventListener('error', done);
        resolve();
      }
      image.addEventListener('load', done, { once: true });
      image.addEventListener('error', done, { once: true });
    });
  }));
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
};

export const ShareSheet: React.FC<ShareSheetProps> = ({ survey, onClose, onShareToFeed, userProfile, sourceSurface = 'FEED', initialStep = 'menu', onBusyChange }) => {
  const { t, i18n } = useTranslation();
  const [step, setStep] = useState<'menu' | 'contacts' | 'feed' | 'repost-editor'>(initialStep);
  const [shareError, setShareError] = useState('');
  const busyRef = useRef(false);
  const [copied, setCopied] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isReposting, setIsReposting] = useState(false);
  const [shareOutcome, setShareOutcome] = useState<'shared' | 'unshared'>('shared');
  const [repostCaption, setRepostCaption] = useState('');

  const shareKey=useRef(crypto.randomUUID());
  const publisher=usePagePublisher(userProfile||({id:'',name:''} as UserProfile),undefined,async()=>{});
  const posterRef = useRef<HTMLDivElement>(null);
  const canonicalOrigin = resolveCanonicalOrigin(import.meta.env.VITE_PUBLIC_URL, window.location.origin);
  const postUrl = buildCanonicalPostUrl(survey.id, canonicalOrigin);
  const canonicalHost = getCanonicalHost(canonicalOrigin);
  const shareCardModel = useMemo(
    () => buildShareCardViewModel(survey, window.location.origin),
    [survey]
  );

  const handleRepostConfirm = async () => {
    if (!onShareToFeed || busyRef.current) return;
    busyRef.current = true;
    onBusyChange?.(true);
    setIsReposting(true);
    setShareError('');
    try {
      if(publisher.pageId&&(publisher.loading||publisher.accessLost))throw new Error('Page access unavailable');
      const outcome = await onShareToFeed(survey, repostCaption,publisher.pageId?{pageId:publisher.pageId,pageCreateKey:shareKey.current}:undefined);
      shareKey.current=crypto.randomUUID();
      setShareOutcome(outcome);
      if (outcome === 'shared') Analytics.track({ event_type: 'SHARE_OR_COPY_LINK', post_id: survey.id, method: 'REPOST', actor_user_id: userProfile?.id, source_surface: sourceSurface });
      setStep('feed');
    } catch {
      setShareError(t('postSharing.failed'));
    } finally {
      busyRef.current = false;
      onBusyChange?.(false);
      setIsReposting(false);
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(postUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setShareError(t('postSharing.copyFailed'));
    }
  };

  const handleSystemShare = async () => {
    if (!posterRef.current || busyRef.current) return;
    busyRef.current = true;
    onBusyChange?.(true);
    setShareError('');

    setIsGeneratingImage(true);
    const typeLabel = t(shareCardModel.badge, { defaultValue: shareCardModel.badge });
    const shareText = t('shareCard.shareText', { type: typeLabel });

    try {
      await waitForCaptureAssets(posterRef.current);

      // html2canvas is large and only needed after an explicit share action.
      // Load it on demand so opening the home feed does not download/parse it.
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(posterRef.current, {
        useCORS: true,
        allowTaint: false,
        scale: 1,
        width: SHARE_CARD_SIZE,
        height: SHARE_CARD_SIZE,
        windowWidth: SHARE_CARD_SIZE,
        windowHeight: SHARE_CARD_SIZE,
        backgroundColor: '#ffffff',
        logging: false,
      });

      const outputCanvas = document.createElement('canvas');
      outputCanvas.width = SHARE_CARD_SIZE;
      outputCanvas.height = SHARE_CARD_SIZE;
      const context = outputCanvas.getContext('2d');
      if (!context) throw new Error('Share image canvas is unavailable.');
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(canvas, 0, 0, SHARE_CARD_SIZE, SHARE_CARD_SIZE);

      const blob = await new Promise<Blob | null>((resolve) => outputCanvas.toBlob(resolve, 'image/png', 1.0));

      if (navigator.share) {
        const file = blob ? new File([blob], 'Opiniup.png', { type: 'image/png' }) : undefined;
        const result = await shareWithFileFallback(navigator, { title: survey.title, text: shareText, url: postUrl }, file);
        if (result === 'cancelled') return;
        onClose();
      } else if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'opiniup-post.png';
        a.click();
        URL.revokeObjectURL(url);
        await handleCopyLink();
      } else {
        throw new Error('Share image unavailable');
      }
      Analytics.track({ event_type: 'SHARE_OR_COPY_LINK', post_id: survey.id, method: 'SHARE_SHEET', actor_user_id: userProfile?.id, source_surface: sourceSurface });
    } catch {
      setShareError(t('postSharing.externalFailed'));
    } finally {
      busyRef.current = false;
      onBusyChange?.(false);
      setIsGeneratingImage(false);
    }
  };

  const renderMenu = () => (
    <div className="p-4 space-y-3 animate-in fade-in slide-in-from-bottom-2">
      <button
        onClick={() => { setShareError(''); setStep('repost-editor'); }}
        disabled={!onShareToFeed || isGeneratingImage}
        className="w-full flex items-center gap-4 p-4 hover:bg-gray-50 rounded-2xl border border-gray-100 transition-all active:scale-95 group"
      >
        <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 group-hover:bg-blue-600 group-hover:text-white transition-colors">
          <Repeat size={24} />
        </div>
        <div className="text-start flex-1">
          <h4 className="font-bold text-gray-900">{t('postSharing.toFeed')}</h4>
          <p className="text-xs text-gray-500">{t('postSharing.toFeedDescription')}</p>
        </div>
        <ChevronRight size={20} className="text-gray-300 rtl:rotate-180" />
      </button>


      <button
        onClick={handleSystemShare}
        disabled={isGeneratingImage}
        className="w-full flex items-center gap-4 p-4 hover:bg-gray-50 rounded-2xl border border-gray-100 transition-all active:scale-95 group disabled:opacity-50"
      >
        <div className="w-12 h-12 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0 group-hover:bg-purple-600 group-hover:text-white transition-colors">
          {isGeneratingImage ? <Loader2 size={24} className="animate-spin" /> : <Share2 size={24} />}
        </div>
        <div className="text-start flex-1">
          <h4 className="font-bold text-gray-900">{t('postSharing.outside')}</h4>
          <p className="text-xs text-gray-500">{isGeneratingImage ? t('shareCard.preparing') : t('postSharing.outsideDescription')}</p>
        </div>
        <ExternalLink size={18} className="text-gray-300" />
      </button>
    </div>
  );

  const renderRepostEditor = () => (
    <div className="flex flex-col h-full animate-in slide-in-from-bottom-4 duration-300 p-4">
      <div className="flex items-center justify-between mb-4 border-b border-gray-50 pb-2">
        <button disabled={isReposting} onClick={() => { setShareError(''); setStep('menu'); }} className="text-gray-500 font-bold text-sm">{t('common.cancel')}</button>
        <h4 className="font-black text-gray-900 uppercase tracking-widest text-xs">{t('postSharing.repost')}</h4>
        <button
          onClick={handleRepostConfirm}
          disabled={isReposting || !onShareToFeed || (publisher.pageId && (publisher.loading || publisher.accessLost))}
          className="bg-blue-600 text-white px-5 py-1.5 rounded-full font-bold text-sm shadow-md active:scale-95 transition-all disabled:opacity-50"
        >
          {isReposting ? t('postSharing.posting') : t('postSharing.post')}
        </button>
      </div>

      <div className="mb-4">{userProfile&&<PagePublisher publisher={publisher} user={userProfile} groupDestination={false}/>}</div>
      <div className="flex gap-3 mb-4" inert={isReposting} aria-busy={isReposting}>
        <UserAvatar src={publisher.pageId?undefined:userProfile?.avatar} mediaId={publisher.pageId?publisher.page?.avatarMediaId:userProfile?.avatarMediaId} media={publisher.pageId?publisher.page?.avatarMedia:userProfile?.avatarMedia} name={publisher.pageId?publisher.page?.name||'':userProfile?.name} alt={publisher.pageId?publisher.page?.name||t('postSharing.author'):userProfile?.name||t('postSharing.you')} size={40} />
        <RichMentionInput
          value={repostCaption}
          onChange={setRepostCaption}
          placeholder={t('postSharing.caption')}
          ariaLabel={t('postSharing.caption')}
          className="flex-1 bg-transparent border-none text-gray-800 placeholder-gray-400 focus:ring-0 resize-none pt-2 min-h-[120px]"
          minRows={5}
          autoFocus
        />
      </div>

      <div className="border border-gray-200 rounded-2xl p-4 bg-gray-50/50 overflow-hidden">
        <div className="flex items-center gap-2 mb-2">
          <UserAvatar src={survey.author.avatar} mediaId={survey.author.avatarMediaId} media={survey.author.avatarMedia} name={survey.author.name} alt={survey.author.name || t('postSharing.author')} size={20} />
          <span className="text-[11px] font-bold text-gray-700">{survey.author.name}</span>
        </div>
        <h5 className="font-bold text-sm text-gray-900 line-clamp-1">{survey.title}</h5>
        <p className="text-[11px] text-gray-500 line-clamp-2 mt-0.5">{survey.description}</p>
      </div>
    </div>
  );

  return (
    <div dir={i18n.dir()} className="flex flex-col h-full bg-white relative overflow-hidden">
      {/* Dedicated deterministic external representation; never capture the live Feed card. */}
      <div className="pointer-events-none fixed left-[-12000px] top-0" aria-hidden="true">
        <div ref={posterRef}>
          <ShareCard model={shareCardModel} canonicalHost={canonicalHost} />
        </div>
      </div>

      {shareError && <p role="alert" className="px-4 py-2 text-sm text-red-600">{shareError}</p>}
      <div className="flex-1 overflow-auto">
        {step === 'menu' && renderMenu()}
        {step === 'repost-editor' && renderRepostEditor()}
        {step === 'feed' && (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center animate-in zoom-in duration-300">
            <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-6">
              <CheckCircle2 size={48} strokeWidth={3} />
            </div>
            <h3 className="text-xl font-black text-gray-900 mb-2">{t(shareOutcome === 'unshared' ? 'postSharing.unshared' : 'postSharing.success')}</h3>
            <p className="text-sm text-gray-500">{t(shareOutcome === 'unshared' ? 'postSharing.unsharedDescription' : 'postSharing.successDescription')}</p>
            <button onClick={onClose} className="mt-4 rounded-xl px-5 py-3 bg-blue-600 text-white">{t('postSharing.close')}</button>
          </div>
        )}
      </div>

      {step !== 'feed' && step !== 'repost-editor' && (
        <div className="px-5 py-5 border-t border-gray-100 flex items-center justify-between bg-gray-50/50 pb-safe">
          <button
            onClick={handleCopyLink}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-2xl font-black uppercase tracking-widest text-[10px] transition-all shadow-sm ${copied ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border border-gray-200 active:scale-95'}`}
          >
            {copied ? <Check size={14} strokeWidth={3} /> : <Copy size={14} />}
            <span>{copied ? t('postSharing.copied') : t('postSharing.copy')}</span>
          </button>
        </div>
      )}
    </div>
  );
};
