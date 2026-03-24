
import React, { useState, useRef } from 'react';
import {
  Search, Link as LinkIcon, Repeat, MoreHorizontal,
  Send, Check, Share2, Copy, Image as ImageIcon, Loader2, Download, PieChart, ExternalLink, QrCode, CheckCircle2,
  Users, MessageSquare, ArrowLeft, SendHorizontal, ChevronRight, X, Star
} from 'lucide-react';
import { Survey, SurveyType } from '../types';
import { SurveyCard } from './SurveyCard';
import html2canvas from 'html2canvas';
import { Analytics } from '../utils/analytics';
import { UserProfile } from '../types';

interface ShareSheetProps {
  survey: Survey;
  onClose: () => void;
  onShareToFeed?: (survey: Survey, caption: string) => void;
  userProfile?: UserProfile;
  onAuthorClick?: (author: { name: string; avatar: string }) => void;
  sourceSurface?: string;
}

const MOCK_PEOPLE = [
  { id: '1', name: 'Alex', avatar: 'https://picsum.photos/50/50?random=101' },
  { id: '2', name: 'Sarah', avatar: 'https://picsum.photos/50/50?random=102' },
  { id: '3', name: 'Mike', avatar: 'https://picsum.photos/50/50?random=103' },
  { id: '4', name: 'Jessica', avatar: 'https://picsum.photos/50/50?random=104' },
  { id: '5', name: 'David', avatar: 'https://picsum.photos/50/50?random=105' },
  { id: '6', name: 'Emma', avatar: 'https://picsum.photos/50/50?random=106' },
];

export const ShareSheet: React.FC<ShareSheetProps> = ({ survey, onClose, onShareToFeed, userProfile, sourceSurface = 'FEED' }) => {
  const [step, setStep] = useState<'menu' | 'contacts' | 'feed' | 'repost-editor'>('menu');
  const [sentTo, setSentTo] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isReposting, setIsReposting] = useState(false);
  const [repostCaption, setRepostCaption] = useState('');

  const posterRef = useRef<HTMLDivElement>(null);
  const postUrl = `${window.location.origin}/post/${survey.id}`;

  const handleRepostConfirm = async () => {
    if (!onShareToFeed) return;

    setIsReposting(true);
    await new Promise(resolve => setTimeout(resolve, 600));
    onShareToFeed(survey, repostCaption);
    Analytics.track({
      event_type: 'SHARE_OR_COPY_LINK',
      post_id: survey.id,
      method: 'REPOST',
      actor_user_id: userProfile?.id,
      source_surface: sourceSurface
    });
    setIsReposting(false);
    setStep('feed');
    setTimeout(() => onClose(), 1200);
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(postUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  const handleSystemShare = async () => {
    if (!posterRef.current) return;

    setIsGeneratingImage(true);

    try {
      await new Promise(r => setTimeout(r, 300)); // Wait for render

      const canvas = await html2canvas(posterRef.current, {
        useCORS: true,
        allowTaint: true,
        scale: 3,
        backgroundColor: '#ffffff',
        logging: false,
      });

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png', 1.0));

      const shareText = `Check out this ${survey.type} on SocialInsight! ${postUrl}`;

      if (blob && navigator.share) {
        const file = new File([blob], `SocialInsight_${survey.type}.png`, { type: 'image/png' });

        const shareData: ShareData = {
          title: `SocialInsight - ${survey.title}`,
          text: shareText,
          url: postUrl
        };

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          shareData.files = [file];
        }

        try {
          await navigator.share(shareData);
          onClose();
        } catch (shareError) {
          console.warn('Share error:', shareError);
          await navigator.share({
            title: `SocialInsight - ${survey.title}`,
            text: shareText,
            url: postUrl
          });
          onClose();
        }
      } else if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `socialinsight-post.png`;
        a.click();
        URL.revokeObjectURL(url);
        handleCopyLink();
      }
    } catch (err) {
      console.error('Share failure:', err);
      if (navigator.share) {
        await navigator.share({
          title: `SocialInsight`,
          text: `Check out this ${survey.type} on SocialInsight! ${postUrl}`,
          url: postUrl
        });
        onClose();
      }
    } finally {
      setIsGeneratingImage(false);
      Analytics.track({
        event_type: 'SHARE_OR_COPY_LINK',
        post_id: survey.id,
        method: 'SHARE_SHEET',
        actor_user_id: userProfile?.id,
        source_surface: sourceSurface
      });
    }
  };

  const renderMenu = () => (
    <div className="p-4 space-y-3 animate-in fade-in slide-in-from-bottom-2">
      <button
        onClick={() => setStep('repost-editor')}
        className="w-full flex items-center gap-4 p-4 hover:bg-gray-50 rounded-2xl border border-gray-100 transition-all active:scale-95 group"
      >
        <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 group-hover:bg-blue-600 group-hover:text-white transition-colors">
          <Repeat size={24} />
        </div>
        <div className="text-left flex-1">
          <h4 className="font-bold text-gray-900">Share to your feed</h4>
          <p className="text-xs text-gray-500">Post this on your profile feed</p>
        </div>
        <ChevronRight size={20} className="text-gray-300" />
      </button>


      <button
        onClick={handleSystemShare}
        disabled={isGeneratingImage}
        className="w-full flex items-center gap-4 p-4 hover:bg-gray-50 rounded-2xl border border-gray-100 transition-all active:scale-95 group disabled:opacity-50"
      >
        <div className="w-12 h-12 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0 group-hover:bg-purple-600 group-hover:text-white transition-colors">
          {isGeneratingImage ? <Loader2 size={24} className="animate-spin" /> : <Share2 size={24} />}
        </div>
        <div className="text-left flex-1">
          <h4 className="font-bold text-gray-900">Share Outside</h4>
          <p className="text-xs text-gray-500">{isGeneratingImage ? 'Capturing exact view...' : 'WhatsApp, Instagram, etc.'}</p>
        </div>
        <ExternalLink size={18} className="text-gray-300" />
      </button>
    </div>
  );

  const renderRepostEditor = () => (
    <div className="flex flex-col h-full animate-in slide-in-from-bottom-4 duration-300 p-4">
      <div className="flex items-center justify-between mb-4 border-b border-gray-50 pb-2">
        <button onClick={() => setStep('menu')} className="text-gray-500 font-bold text-sm">Cancel</button>
        <h4 className="font-black text-gray-900 uppercase tracking-widest text-xs">Repost</h4>
        <button
          onClick={handleRepostConfirm}
          disabled={isReposting}
          className="bg-blue-600 text-white px-5 py-1.5 rounded-full font-bold text-sm shadow-md active:scale-95 transition-all disabled:opacity-50"
        >
          {isReposting ? <Loader2 size={16} className="animate-spin" /> : 'Post'}
        </button>
      </div>

      <div className="flex gap-3 mb-4">
        <img src="https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&h=200&fit=crop" className="w-10 h-10 rounded-full object-cover shrink-0" alt="" />
        <textarea
          autoFocus
          value={repostCaption}
          onChange={(e) => setRepostCaption(e.target.value)}
          placeholder="Say something about this..."
          className="flex-1 bg-transparent border-none text-gray-800 placeholder-gray-400 focus:ring-0 resize-none pt-2 min-h-[120px]"
        />
      </div>

      <div className="border border-gray-200 rounded-2xl p-4 bg-gray-50/50 overflow-hidden">
        <div className="flex items-center gap-2 mb-2">
          <img src={survey.author.avatar} className="w-5 h-5 rounded-full" alt="" />
          <span className="text-[11px] font-bold text-gray-700">{survey.author.name}</span>
        </div>
        <h5 className="font-bold text-sm text-gray-900 line-clamp-1">{survey.title}</h5>
        <p className="text-[11px] text-gray-500 line-clamp-2 mt-0.5">{survey.description}</p>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-white relative overflow-hidden">
      {/* Hidden container that replicates a high-quality static card view for screenshot capture */}
      <div className="fixed top-[-9999px] left-0 pointer-events-none" aria-hidden="true">
        <div ref={posterRef} className="w-[500px] bg-white pb-6 pt-4 px-4 flex flex-col gap-4">
            {/* Custom Header with App Logo */}
            <div className="flex items-center justify-between px-2 mb-2">
               <img src="/logo.png" className="h-[36px] object-contain" alt="SocialInsight" />
               <div className="text-right">
                 <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest mb-0.5">Join the conversation</p>
                 <p className="text-[12px] font-bold text-gray-500">socialinsight.app</p>
               </div>
            </div>

            {/* Content Card */}
            <div className="capture-target-wrapper pointer-events-none rounded-3xl border border-gray-100 shadow-sm relative bg-white mx-4 mt-4 mb-4">
              <style>{`
                .capture-target-wrapper > div { border-bottom: none !important; padding-bottom: 16px !important; }
                .capture-target-wrapper .border-t.border-gray-100.mt-2 { display: none !important; }
                .capture-target-wrapper .lucide-more-horizontal { display: none !important; }
                .capture-target-wrapper button { pointer-events: none !important; }
              `}</style>
              <SurveyCard 
                 survey={survey} 
                 userProfile={userProfile}
                 isDetailView={true} 
                 sourceSurface="SHARE_CAPTURE"
              />
            </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {step === 'menu' && renderMenu()}
        {step === 'repost-editor' && renderRepostEditor()}
        {step === 'feed' && (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center animate-in zoom-in duration-300">
            <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-6">
              <CheckCircle2 size={48} strokeWidth={3} />
            </div>
            <h3 className="text-xl font-black text-gray-900 mb-2">Shared Successfully!</h3>
            <p className="text-sm text-gray-500">Your repost is now live on your feed.</p>
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
            <span>{copied ? 'Copied Link' : 'Copy Link'}</span>
          </button>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tight">Post ID: {survey.id.split('-').pop()}</p>
        </div>
      )}
    </div>
  );
};
