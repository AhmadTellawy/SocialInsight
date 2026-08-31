import React, { useState, useEffect } from 'react';
import { User, CheckCircle2, UserCircle2, Loader2 } from 'lucide-react';
import { Survey } from '../types';
import { api } from '../services/api';
import { UserAvatar } from './UserAvatar';

interface ParticipantsSheetProps {
  survey: Survey;
  onAuthorClick?: (author: { id: string; name: string; avatar: string }) => void;
}

export const ParticipantsSheet: React.FC<ParticipantsSheetProps> = ({ survey, onAuthorClick }) => {
  const [participants, setParticipants] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadPage = React.useCallback(async (cursor: string | null, append: boolean, signal?: AbortSignal) => {
    append ? setIsLoadingMore(true) : setIsLoading(true);
    setLoadError(null);
    try {
      const page = await api.getParticipantsPage(survey.id, cursor, 30, signal);
      setParticipants(previous => {
        const byId = new Map<string, any>();
        (append ? previous : []).forEach(participant => byId.set(participant.id, participant));
        page.items.forEach((participant: any) => byId.set(participant.id, participant));
        return Array.from(byId.values());
      });
      setNextCursor(page.nextCursor);
    } catch (error: any) {
      if (error?.name !== 'AbortError') setLoadError('Failed to load participants.');
    } finally {
      append ? setIsLoadingMore(false) : setIsLoading(false);
    }
  }, [survey.id]);

  useEffect(() => {
    const controller = new AbortController();
    setParticipants([]);
    setNextCursor(null);
    void loadPage(null, false, controller.signal);
    return () => controller.abort();
  }, [loadPage]);



  return (
    <div className="flex flex-col h-full bg-white">

      <div className="flex-1 overflow-y-auto no-scrollbar">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 size={32} className="animate-spin text-blue-500 opacity-50" />
            <p className="text-xs text-gray-400 mt-4 font-bold uppercase tracking-widest">Fetching results...</p>
          </div>
        ) : loadError && participants.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-500">
            <p className="mb-3 text-sm">{loadError}</p>
            <button onClick={() => void loadPage(null, false)} className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white">Retry</button>
          </div>
        ) : participants.length > 0 ? (
          <div className="divide-y divide-gray-50">
            {participants.map((p, idx) => (
              <div
                key={p.id + '-' + idx}
                className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
                onClick={() => !p.isAnonymous && onAuthorClick && onAuthorClick({ id: p.id, name: p.name, avatar: p.avatar })}
              >
                <div className="flex items-center gap-3">
                  {p.isAnonymous ? (
                    <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-400">
                      <UserCircle2 size={24} />
                    </div>
                  ) : (
                    <UserAvatar src={p.avatar} mediaId={p.avatarMediaId} media={p.avatarMedia} name={p.name} alt={p.name || 'Participant'} size={40} className="border border-gray-100" />
                  )}
                  <div>
                    <h4 className={`text-sm font-bold ${p.isAnonymous ? 'text-gray-500 italic' : 'text-gray-900'}`}>{p.name}</h4>
                  </div>
                </div>
                {p.isAnonymous ? (
                  <span className="text-[9px] font-black text-gray-300 uppercase tracking-widest border border-gray-100 px-1.5 py-0.5 rounded">Private</span>
                ) : (
                  <button className="text-blue-600 font-bold text-xs hover:underline">View Profile</button>
                )}
              </div>
            ))}
            {nextCursor && (
              <button
                onClick={() => void loadPage(nextCursor, true)}
                disabled={isLoadingMore}
                className="mx-auto my-4 flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2 text-xs font-bold text-gray-600 disabled:opacity-60"
              >
                {isLoadingMore && <Loader2 size={14} className="animate-spin" />}
                Load more participants
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <User size={48} className="opacity-10 mb-4" />
            <p className="text-sm">No participants found</p>
          </div>
        )}
      </div>

      <div className="p-4 bg-gray-50 text-center border-t border-gray-100">
        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">
          Total Participants: {participants.length}
        </p>
      </div>
    </div>
  );
};
