import React from 'react';
import { ChevronUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BottomSheet } from '../BottomSheet';

interface PostOptionsSheetProps {
  postId: string;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  showResults: boolean;
  optionCount: number;
  heading: React.ReactNode;
  children: React.ReactNode;
  footer: React.ReactNode;
}

export function PostOptionsSheet({ postId, isOpen, onOpen, onClose, showResults, optionCount, heading, children, footer }: PostOptionsSheetProps) {
  const { t, i18n } = useTranslation();
  return <>
    <button type="button" aria-haspopup="dialog" aria-expanded={isOpen} onClick={event => { event.stopPropagation(); onOpen(); }} className="mb-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-blue-600 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
      <span>{showResults ? t('postResponse.viewResults') : t('postResponse.viewOptions')}</span>
      {optionCount > 0 && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs tabular-nums">{optionCount}</span>}
      <ChevronUp size={16} aria-hidden="true" />
    </button>
    <BottomSheet isOpen={isOpen} onClose={onClose} customLayout height="auto" ariaLabel={t('postResponse.options')} historyKey={`post-options:${postId}`} showCloseButton closeLabel={t('postResponse.close')}>
      <div dir={i18n.dir()} className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-gray-100 px-4 pb-3 pt-2">
          <h3 dir="auto" className="text-start text-[12px] font-normal leading-relaxed whitespace-pre-wrap break-words">{heading}</h3>
          {optionCount > 0 && <p className="mt-1 text-xs text-gray-500">{t('postResponse.optionCount', { count: optionCount })}</p>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-4" data-post-options-body>
          {children}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-gray-100 px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          {footer}
        </div>
      </div>
    </BottomSheet>
  </>;
}
