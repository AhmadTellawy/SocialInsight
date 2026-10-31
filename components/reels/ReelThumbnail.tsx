import React, { useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { reelsApi } from '../../services/reelsApi';

export function ReelThumbnail({ id, onOpen }: { id: string; onOpen: () => void }) {
  const root = useRef<HTMLButtonElement>(null);
  const [poster, setPoster] = useState('');
  const { i18n } = useTranslation();
  useEffect(() => {
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout>; let visible = false;
    const load = async () => {
      try {
        const grant = await reelsApi.playback(id, abort.signal);
        if (abort.signal.aborted || !visible) return;
        setPoster(grant.poster);
        timer = setTimeout(() => { if (visible) void load(); }, Math.max(1000, grant.expiresAt - Date.now() - 30000));
      } catch { if (!abort.signal.aborted) setPoster(''); }
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting; clearTimeout(timer);
      if (visible) void load(); else setPoster('');
    });
    if (root.current) observer.observe(root.current);
    return () => { abort.abort(); observer.disconnect(); clearTimeout(timer); };
  }, [id]);
  return <button ref={root} onClick={onOpen} className="relative w-full aspect-[9/12] rounded-2xl bg-gray-950 text-white overflow-hidden flex flex-col items-center justify-center gap-3">
    {poster && <img src={poster} alt="" className="absolute inset-0 h-full w-full object-cover" onError={() => setPoster('')} />}
    <span className="absolute inset-0 bg-black/25" aria-hidden="true" />
    <Play size={42} className="relative" /><span className="relative rounded-full px-4 py-2 bg-black/40">{i18n.language.startsWith('ar') ? 'مشاهدة الريل والإجابة' : 'Watch Reel & respond'}</span>
  </button>;
}
