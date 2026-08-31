
import React, { useEffect, useId, useState, useRef } from 'react';
import { createPortal } from 'react-dom';

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  customLayout?: boolean; // If true, removes default padding/scroll to let children handle layout
  title?: string;
  height?: string; // New prop to control height
  ariaLabel?: string;
}

export const BottomSheet: React.FC<BottomSheetProps> = ({ isOpen, onClose, children, customLayout = false, title, height, ariaLabel }) => {
  const [isRendered, setIsRendered] = useState(isOpen);
  const [isDragging, setIsDragging] = useState(false);
  const [translateY, setTranslateY] = useState(0);
  
  const sheetRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const startY = useRef<number>(0);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      setIsRendered(true);
      setTranslateY(0);
      return;
    }

    // Closed sheets are mounted once per feed card. Avoid scheduling an exit
    // timer for sheets that have never been opened.
    if (!isRendered) return;

    const timer = window.setTimeout(() => {
      setIsRendered(false);
      setTranslateY(0);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [isOpen, isRendered]);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !isRendered || !sheetRef.current) return;
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const sheet = sheetRef.current;
    const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusable = Array.from(sheet.querySelectorAll<HTMLElement>(focusableSelector)) as HTMLElement[];
    (focusable[0] || sheet).focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const currentFocusable = Array.from(sheet.querySelectorAll<HTMLElement>(focusableSelector)) as HTMLElement[];
      if (currentFocusable.length === 0) {
        event.preventDefault();
        sheet.focus();
        return;
      }
      const first = currentFocusable[0];
      const last = currentFocusable[currentFocusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocusedRef.current?.focus();
    };
  }, [isOpen, isRendered]);

  const handleTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement;
    const isHandle = target.closest('.drag-handle');
    
    const isAtTop = scrollContainerRef.current ? scrollContainerRef.current.scrollTop <= 0 : true;

    if (isHandle || isAtTop) {
      setIsDragging(true);
      startY.current = e.touches[0].clientY;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;
    const currentY = e.touches[0].clientY;
    const diff = currentY - startY.current;

    if (diff > 0) {
      setTranslateY(diff);
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    if (translateY > 100) {
      onClose();
    } else {
      setTranslateY(0);
    }
  };

  if (!isRendered) return null;

  const sheetContent = (
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center">
      {/* Backdrop */}
      <div 
        className={`absolute inset-0 bg-black/60 transition-opacity duration-300 ease-out ${isOpen ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
        aria-hidden="true"
      />
      
      {/* Sheet Content */}
      <div 
        ref={sheetRef}
        className="relative w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col transform transition-transform"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ 
          transform: isOpen ? `translateY(${translateY}px)` : 'translateY(100%)',
          transition: isDragging ? 'none' : 'transform 0.35s cubic-bezier(0.15, 0.85, 0.35, 1)',
          maxHeight: '95dvh',
          height: height || (customLayout ? '80vh' : 'auto'),
          minHeight: '20vh'
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={!title ? ariaLabel : undefined}
        tabIndex={-1}
      >
        {/* Drag Handle Header */}
        <div className="w-full flex flex-col items-center justify-center pt-3 pb-2 shrink-0 z-10 bg-white rounded-t-3xl border-b border-gray-50 drag-handle touch-none">
           <div className="w-10 h-1 bg-gray-300 rounded-full mb-2" />
           {title && <h3 id={titleId} className="text-sm font-bold text-gray-800 pb-1">{title}</h3>}
        </div>
        
        {/* Content Container */}
        <div 
          ref={scrollContainerRef}
          className={`flex-1 ${customLayout ? 'overflow-hidden flex flex-col' : 'px-4 pb-[max(2rem,env(safe-area-inset-bottom))] sm:p-6 overflow-y-auto overscroll-contain no-scrollbar'}`}
        >
          {children}
        </div>
      </div>
    </div>
  );

  return createPortal(sheetContent, document.body);
};
