import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, Search, Tag, Users, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../services/api';
import { createMentionSearchScheduler, MentionSearchScheduler } from '../utils/mentionAutocomplete';
import { BottomSheet } from './BottomSheet';
import { UserAvatar } from './UserAvatar';
import { Analytics } from '../utils/analytics';

export const PEOPLE_TAG_LIMIT = 10;

export interface PeopleTagPerson {
  id: string;
  name: string;
  handle: string;
  avatar?: string | null;
  avatarMediaId?: string | null;
  avatarMedia?: any;
}

interface PeopleTagPickerProps {
  selectedPeople: PeopleTagPerson[];
  onChange: (people: PeopleTagPerson[]) => void;
  accent?: 'blue' | 'purple' | 'amber';
  variant?: 'default' | 'chip';
}

const accentClasses = {
  blue: { text: 'text-blue-600', selected: 'bg-blue-50 border-blue-200', check: 'bg-blue-600' },
  purple: { text: 'text-purple-600', selected: 'bg-purple-50 border-purple-200', check: 'bg-purple-600' },
  amber: { text: 'text-amber-600', selected: 'bg-amber-50 border-amber-200', check: 'bg-amber-600' }
};

export const PeopleTagPicker: React.FC<PeopleTagPickerProps> = ({
  selectedPeople,
  onChange,
  accent = 'blue',
  variant = 'default'
}) => {
  const { t, i18n } = useTranslation();
  const isRtl = ['ar', 'ur'].includes(i18n.language?.split('-')[0]);
  const colors = accentClasses[accent];
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PeopleTagPerson[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const schedulerRef = useRef<MentionSearchScheduler<PeopleTagPerson> | null>(null);
  if (!schedulerRef.current) {
    schedulerRef.current = createMentionSearchScheduler((value, signal) => api.searchTaggableUsers(value, signal));
  }

  useEffect(() => {
    const scheduler = schedulerRef.current!;
    scheduler.cancel();
    setError(null);
    if (!isOpen || !query.trim()) {
      setResults([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    scheduler.schedule(query.trim(), {
      onSuccess: (users) => setResults(users || []),
      onError: () => setError(t('peopleTags.searchFailed')),
      onSettled: () => setIsLoading(false)
    });
    return () => scheduler.cancel();
  }, [isOpen, query, t]);

  const selectedIds = new Set(selectedPeople.map((person) => person.id));
  const togglePerson = (person: PeopleTagPerson) => {
    if (selectedIds.has(person.id)) {
      onChange(selectedPeople.filter((selected) => selected.id !== person.id));
      Analytics.track({
        event_type: 'PEOPLE_TAG_REMOVED',
        target_user_id: person.id,
        source_surface: 'COMPOSER'
      });
      setError(null);
      return;
    }
    if (selectedPeople.length >= PEOPLE_TAG_LIMIT) {
      setError(t('peopleTags.limitExceeded', { limit: PEOPLE_TAG_LIMIT }));
      return;
    }
    onChange([...selectedPeople, person]);
    Analytics.track({
      event_type: 'PEOPLE_TAG_ADDED',
      target_user_id: person.id,
      source_surface: 'COMPOSER'
    });
    setError(null);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={variant === 'chip' ? 'inline-flex items-center gap-2 px-3 py-2 min-h-[40px] bg-white hover:bg-gray-50 rounded-full border border-gray-300 text-[12px] font-bold text-gray-800' : 'w-full flex items-center justify-between p-3.5 bg-gray-50 hover:bg-gray-100/70 rounded-xl transition-all border border-gray-100'}
        aria-label={t('peopleTags.openLabel', { count: selectedPeople.length })}
      >
        <span className="flex items-center gap-2 text-xs font-bold text-gray-800">{variant === 'chip' ? <Users size={15} /> : <Tag size={14} />} {t('peopleTags.tagPeople')}</span>
        <span className={`flex items-center gap-1 text-xs font-black ${colors.text}`}>
          {selectedPeople.length > 0 ? selectedPeople.length : variant === 'chip' ? null : t('peopleTags.none')}
          {variant !== 'chip' && <ChevronRight size={14} className={isRtl ? 'rotate-180' : ''} />}
        </span>
      </button>

      <BottomSheet
        isOpen={isOpen}
        onClose={() => { setIsOpen(false); setQuery(''); setError(null); }}
        title={t('peopleTags.tagPeople')}
        customLayout
        height="72vh"
      >
        <div className="flex h-full min-h-0 flex-col" dir={isRtl ? 'rtl' : 'ltr'}>
          <div className="p-4 border-b border-gray-100">
            <div className="relative">
              <Search size={17} className={`absolute top-1/2 -translate-y-1/2 text-gray-400 ${isRtl ? 'right-3' : 'left-3'}`} />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('peopleTags.searchPlaceholder')}
                aria-label={t('peopleTags.searchPlaceholder')}
                className={`w-full h-11 bg-gray-100 rounded-xl border border-transparent focus:border-blue-200 focus:bg-white outline-none text-sm text-gray-900 placeholder-gray-500 ${isRtl ? 'pr-10 pl-3' : 'pl-10 pr-3'}`}
              />
            </div>
            <div className="flex items-center justify-between mt-2 text-[11px]">
              <span className="text-gray-500">{t('peopleTags.selectedCount', { count: selectedPeople.length, limit: PEOPLE_TAG_LIMIT })}</span>
              {selectedPeople.length > 0 && (
                <button type="button" onClick={() => onChange([])} className="font-bold text-gray-500 hover:text-gray-800">{t('peopleTags.clear')}</button>
              )}
            </div>
            {error && <p role="alert" className="mt-2 text-xs font-semibold text-red-600">{error}</p>}
          </div>

          {selectedPeople.length > 0 && (
            <div className="flex gap-2 overflow-x-auto px-4 py-3 border-b border-gray-100 no-scrollbar" aria-label={t('peopleTags.selected')}>
              {selectedPeople.map((person) => (
                <button
                  key={person.id}
                  type="button"
                  onClick={() => togglePerson(person)}
                  className={`shrink-0 flex items-center gap-2 rounded-lg border px-2 py-1.5 ${colors.selected}`}
                  aria-label={t('peopleTags.removePerson', { name: person.name })}
                >
                  <UserAvatar src={person.avatar} mediaId={person.avatarMediaId} media={person.avatarMedia} name={person.name} alt="" size={24} />
                  <span className="max-w-24 truncate text-xs font-bold text-gray-800">{person.name}</span>
                  <X size={13} className="text-gray-500" />
                </button>
              ))}
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {!query.trim() ? (
              <div className="px-6 py-12 text-center text-sm text-gray-500">{t('peopleTags.searchHint')}</div>
            ) : isLoading ? (
              <div className="px-6 py-12 text-center text-sm text-gray-500">{t('mentions.searching')}</div>
            ) : results.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-gray-500">{t('mentions.noUsersFound')}</div>
            ) : results.map((person) => {
              const isSelected = selectedIds.has(person.id);
              return (
                <button
                  key={person.id}
                  type="button"
                  onClick={() => togglePerson(person)}
                  className="w-full min-h-14 flex items-center gap-3 px-4 py-2.5 text-start hover:bg-gray-50 border-b border-gray-50"
                  aria-pressed={isSelected}
                >
                  <UserAvatar src={person.avatar} mediaId={person.avatarMediaId} media={person.avatarMedia} name={person.name} alt="" size={38} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-bold text-gray-900 truncate">{person.name}</span>
                    <span className="block text-xs text-gray-500 truncate" dir="ltr">@{person.handle}</span>
                  </span>
                  <span className={`w-6 h-6 rounded-full border flex items-center justify-center ${isSelected ? `${colors.check} border-transparent text-white` : 'border-gray-200 text-transparent'}`}>
                    <Check size={14} strokeWidth={3} />
                  </span>
                </button>
              );
            })}
          </div>

          <div className="p-4 border-t border-gray-100 bg-white safe-bottom">
            <button type="button" onClick={() => setIsOpen(false)} className="w-full h-11 bg-gray-900 text-white rounded-xl text-xs font-black uppercase tracking-widest">
              {t('peopleTags.done')}
            </button>
          </div>
        </div>
      </BottomSheet>
    </>
  );
};
