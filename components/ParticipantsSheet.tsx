import React, { useState, useEffect, useMemo } from 'react';
import { Search, User, CheckCircle2, UserCircle2, Loader2 } from 'lucide-react';
import { Survey } from '../types';
import { api } from '../services/api';

interface ParticipantsSheetProps {
  survey: Survey;
  onAuthorClick?: (author: { id: string; name: string; avatar: string }) => void;
}

export const ParticipantsSheet: React.FC<ParticipantsSheetProps> = ({ survey, onAuthorClick }) => {
  const [search, setSearch] = useState('');
  const [participants, setParticipants] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchParticipants = async () => {
      try {
        const data = await api.getParticipants(survey.id);
        setParticipants(data);
      } catch (error) {
        console.error("Failed to load participants:", error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchParticipants();
  }, [survey.id]);

  const getTimeAgo = (dateStr: string) => {
    const now = new Date();
    const past = new Date(dateStr);
    const diffInSeconds = Math.floor((now.getTime() - past.getTime()) / 1000);
    if (diffInSeconds < 60) return 'Just now';
    const diffInMinutes = Math.floor(diffInSeconds / 60);
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    const diffInHours = Math.floor(diffInMinutes / 60); // This was a bug in previous logic (minutes / 60), should be diffInMinutes / 60
    // Wait, previous logic in SurveyCard was correct except it used minutes twice.
    // Let's use a simpler version or just keep it consistent.
    const hours = Math.floor(diffInMinutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const filteredParticipants = useMemo(() => {
    return participants.filter(p =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.handle && p.handle.toLowerCase().includes(search.toLowerCase()))
    );
  }, [search, participants]);

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="px-4 py-3 border-b border-gray-50">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search participants..."
            className="w-full bg-gray-100 border-none rounded-xl pl-10 pr-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500/10"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 size={32} className="animate-spin text-blue-500 opacity-50" />
            <p className="text-xs text-gray-400 mt-4 font-bold uppercase tracking-widest">Fetching results...</p>
          </div>
        ) : filteredParticipants.length > 0 ? (
          <div className="divide-y divide-gray-50">
            {filteredParticipants.map((p, idx) => (
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
                    <img src={p.avatar || 'https://picsum.photos/40/40'} alt="" className="w-10 h-10 rounded-full object-cover border border-gray-100" />
                  )}
                  <div>
                    <h4 className={`text-sm font-bold ${p.isAnonymous ? 'text-gray-500 italic' : 'text-gray-900'}`}>{p.name}</h4>
                    <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">{getTimeAgo(p.timestamp)}</p>
                  </div>
                </div>
                {p.isAnonymous ? (
                  <span className="text-[9px] font-black text-gray-300 uppercase tracking-widest border border-gray-100 px-1.5 py-0.5 rounded">Private</span>
                ) : (
                  <button className="text-blue-600 font-bold text-xs hover:underline">View Profile</button>
                )}
              </div>
            ))}
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
          {search ? `Found ${filteredParticipants.length} results` : `Total Participants: ${participants.length}`}
        </p>
      </div>
    </div>
  );
};
