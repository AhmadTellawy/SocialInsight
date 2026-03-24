import React, { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { Loader2, ArrowDown } from 'lucide-react';

export interface PullToRefreshHandle {
  scrollToTop: () => void;
  isAtTop: () => boolean;
  triggerRefresh: () => Promise<void>;
}

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
  className?: string;
  onScrollChange?: (direction: 'up' | 'down') => void;
}

export const PullToRefresh = forwardRef<PullToRefreshHandle, PullToRefreshProps>(({ onRefresh, children, className, onScrollChange }, ref) => {
  const [startY, setStartY] = useState(0);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastScrollTop = useRef(0);
  
  const MAX_PULL = 150;
  const THRESHOLD = 80;

  useImperativeHandle(ref, () => ({
    scrollToTop: () => {
      // Use requestAnimationFrame to ensure we don't conflict with rendering cycles or layout shifts
      requestAnimationFrame(() => {
        if (containerRef.current) {
          console.log('[PullToRefresh] scrollToTop triggered. Current scrollTop:', containerRef.current.scrollTop);
          
          // Native smooth scroll to top
          containerRef.current.scrollTo({
            top: 0,
            behavior: 'smooth'
          });

          // Optional: Check post-scroll (debugging purposes)
          // setTimeout(() => console.log('[PullToRefresh] Post-scroll scrollTop:', containerRef.current?.scrollTop), 500);
        } else {
          console.warn('[PullToRefresh] containerRef is null');
        }
      });
    },
    isAtTop: () => {
      // Direct DOM check is the most reliable source of truth
      // Using a small threshold (10px) to handle potential sub-pixel rendering or bounce
      if (!containerRef.current) return true;
      
      const isTop = containerRef.current.scrollTop <= 10;
      console.log('[PullToRefresh] isAtTop check:', isTop, 'scrollTop:', containerRef.current.scrollTop);
      return isTop;
    },
    triggerRefresh: async () => {
      if (isRefreshing) return;
      setIsRefreshing(true);
      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
      }
    }
  }));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const currentScrollTop = container.scrollTop;
      
      // Ignore scroll events during overscroll or bounce (negative values on iOS)
      if (currentScrollTop < 0) return;

      const diff = currentScrollTop - lastScrollTop.current;
      const scrollThreshold = 10; // Minimum scroll distance to trigger change

      if (Math.abs(diff) > scrollThreshold) {
        if (diff > 0 && currentScrollTop > 50) {
          // Scrolling down AND not at the very top
          onScrollChange?.('down');
        } else if (diff < 0) {
          // Scrolling up
          onScrollChange?.('up');
        }
        lastScrollTop.current = currentScrollTop;
      }
    };

    // Passive listener for better scroll performance
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [onScrollChange]);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (containerRef.current && containerRef.current.scrollTop <= 0) {
      setStartY(e.touches[0].clientY);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (startY === 0 || isRefreshing) return;
    const currentY = e.touches[0].clientY;
    const diff = currentY - startY;

    if (diff > 0 && (containerRef.current?.scrollTop || 0) <= 0) {
      // Calculate pull distance with damping
      const dampedDiff = Math.min(diff * 0.4, MAX_PULL);
      setPullDistance(dampedDiff);
    }
  };

  const handleTouchEnd = async () => {
    if (isRefreshing || startY === 0) return;
    
    if (pullDistance > THRESHOLD) {
      setIsRefreshing(true);
      setPullDistance(60); // Snap to loader position
      
      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0); // Snap back
    }
    setStartY(0);
  };

  return (
    <div 
      ref={containerRef}
      className={`relative overflow-y-auto overscroll-y-contain ${className}`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ WebkitOverflowScrolling: 'touch' }} // iOS smooth momentum scrolling
    >
      {/* Refresh Indicator */}
      <div 
        className="absolute left-0 right-0 flex justify-center pointer-events-none z-10 transition-opacity duration-200"
        style={{ 
          top: isRefreshing ? '24px' : '10px',
          opacity: pullDistance > 0 || isRefreshing ? 1 : 0,
          transform: isRefreshing ? 'none' : `translateY(${Math.min(pullDistance, 40)}px)`
        }}
      >
        <div className="bg-white rounded-full p-2.5 shadow-md border border-gray-100 flex items-center justify-center">
           {isRefreshing ? (
             <Loader2 className="animate-spin text-blue-600" size={20} />
           ) : (
             <ArrowDown 
                className="text-gray-500 transition-transform duration-200" 
                size={20} 
                style={{ transform: `rotate(${Math.min(pullDistance * 2, 180)}deg)` }} 
             />
           )}
        </div>
      </div>

      {/* Content Wrapper */}
      <div 
        style={{ 
          transform: `translateY(${isRefreshing ? 60 : pullDistance}px)`,
          transition: isRefreshing ? 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)' : 'transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
        }}
      >
        {children}
      </div>
    </div>
  );
});

PullToRefresh.displayName = 'PullToRefresh';