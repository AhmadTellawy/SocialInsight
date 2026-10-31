import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, Volume2, VolumeX, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { reelsApi } from '../../services/reelsApi';

// Memory only: signed media URLs and playback positions never enter persistent storage.
const positions = new Map<string, number>();
export function ReelPlayer({ id, active, preview = false, localSrc, onDuration }: { id: string; active: boolean; preview?: boolean; localSrc?: string; onDuration?: (seconds: number) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [ready, setReady] = useState(false);
  const playIntent = useRef({ active, paused }); playIntent.current = { active, paused };
  const { i18n } = useTranslation(); const ar = i18n.language.startsWith('ar');
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    let dead = false; let hls: import('hls.js').default | undefined; let refresh: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    setError(false); setReady(false);
    const setup = async () => {
      try {
        const grant = localSrc ? { hls: localSrc, poster: '', expiresAt: 0, format: 'progressive' } : await reelsApi.playback(id, controller.signal, preview);
        if (dead) return;
        element.poster = grant.poster;
        if (grant.format === 'progressive' || element.canPlayType('application/vnd.apple.mpegurl')) element.src = grant.hls;
        else {
          const { default: Hls } = await import('hls.js');
          if (dead) return;
          if (!Hls.isSupported()) throw new Error('Unsupported video');
          hls = new Hls({ maxBufferLength: 15, backBufferLength: 0, maxMaxBufferLength: 30 });
          hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal && !dead) setError(true); });
          hls.loadSource(grant.hls); hls.attachMedia(element);
        }
        if (grant.expiresAt) refresh = setTimeout(() => { if (!dead) setRetry(x => x + 1); }, Math.max(1000, grant.expiresAt - Date.now() - 30_000));
      } catch { if (!dead) setError(true); }
    };
    void setup();
    const visibility = () => { if (document.hidden || !playIntent.current.active) element.pause(); else if (!playIntent.current.paused) void element.play().catch(() => setPaused(true)); };
    document.addEventListener('visibilitychange', visibility);
    return () => { dead = true; controller.abort(); clearTimeout(refresh); document.removeEventListener('visibilitychange', visibility); positions.set(id, element.currentTime); if (positions.size > 50) positions.delete(positions.keys().next().value!); element.pause(); hls?.destroy(); element.removeAttribute('src'); element.load(); };
  }, [id, preview, localSrc, retry]);
  useEffect(() => { if (!active || paused || document.hidden) video.current?.pause(); else if (ready) void video.current?.play().catch(() => setPaused(true)); }, [paused, active, ready]);
  return <div className="absolute inset-0 bg-gray-950">
    <video ref={video} muted={muted} loop playsInline preload="metadata" className="h-full w-full object-contain" aria-label={ar ? 'فيديو الريل' : 'Reel video'}
      onLoadedMetadata={() => { const element = video.current!; if (positions.has(id)) element.currentTime = Math.min(positions.get(id)!, element.duration || 0); onDuration?.(element.duration); }}
      onCanPlay={() => { setReady(true); if (active && !paused && !document.hidden) void video.current?.play().catch(() => setPaused(true)); }} onError={() => { if (active) setError(true); }} />
    {!ready && !error && active && <div role="status" className="absolute inset-0 grid place-items-center text-white"><span className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" /><span className="sr-only">{ar ? 'تحميل الفيديو' : 'Loading video'}</span></div>}
    {error && <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white"><p>{ar ? 'تعذّر تشغيل الفيديو' : 'Unable to play this video'}</p><button onClick={() => setRetry(x => x + 1)} className="flex items-center gap-2 rounded-full bg-white/20 px-4 py-3"><RotateCcw size={18} />{ar ? 'حاول مجددًا' : 'Try again'}</button></div>}
    <div className="absolute top-20 left-4 flex flex-col gap-2 text-white">
      <button className="rounded-full bg-black/35 p-3" onClick={() => setMuted(x => !x)} aria-label={muted ? (ar ? 'تشغيل الصوت' : 'Unmute') : (ar ? 'كتم الصوت' : 'Mute')}>{muted ? <VolumeX size={20} /> : <Volume2 size={20} />}</button>
      <button className="rounded-full bg-black/35 p-3" onClick={() => setPaused(x => !x)} aria-label={paused ? (ar ? 'تشغيل' : 'Play') : (ar ? 'إيقاف مؤقت' : 'Pause')}>{paused ? <Play size={20} /> : <Pause size={20} />}</button>
    </div>
  </div>;
}
