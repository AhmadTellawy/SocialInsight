import React, { useEffect, useState } from 'react';
import { ChevronRight, Link2, Target, UserRound, Users } from 'lucide-react';
import { GroupSelectionPage, PostableGroup } from './GroupSelectionPage';

interface Props {
  value: string;
  onChange: (value: any) => void;
  selectedGroupIds: string[];
  onGroupsChange: (ids: string[]) => void;
  groups: PostableGroup[];
  allowCustomAudience: boolean;
  allowCustomDomain: boolean;
  error?: string | false;
  accent?: 'blue' | 'purple' | 'amber';
}

export const PostVisibilitySection: React.FC<Props> = ({ value, onChange, selectedGroupIds, onGroupsChange, groups, allowCustomAudience, allowCustomDomain, error, accent = 'blue' }) => {
  const [groupPageOpen, setGroupPageOpen] = useState(false);
  useEffect(() => { if (!value) onChange('Public'); }, [value, onChange]);
  const profile = value === 'Public' || value === 'ProfileAndGroups';
  const selectedGroups = value === 'Groups' || value === 'ProfileAndGroups';
  const color = { blue: 'accent-blue-600', purple: 'accent-purple-600', amber: 'accent-amber-600' }[accent];
  const changeDestination = (id: string) => {
    if (id === 'Public') {
      if (profile && !selectedGroups) return;
      onChange(profile ? 'Groups' : (selectedGroups ? 'ProfileAndGroups' : 'Public'));
    } else if (id === 'Groups') {
      if (!selectedGroups) setGroupPageOpen(true);
      else if (profile) { onGroupsChange([]); onChange('Public'); }
    } else if (value !== id) onChange(id);
  };
  const destinations = [
    { id: 'Public', label: 'My Profile', icon: UserRound, selected: profile, allowed: true },
    { id: 'Groups', label: 'Selected Groups', icon: Users, selected: selectedGroups, allowed: true },
    { id: 'Custom Audience', label: 'Custom Audience', icon: Target, selected: value === 'Custom Audience', allowed: allowCustomAudience },
    { id: 'Custom Domain', label: 'Custom Domain', icon: Link2, selected: value === 'Custom Domain', allowed: allowCustomDomain },
  ];
  const postable = groups.filter(g => g.role === 'Owner' || g.role === 'Admin' || g.postingPermissions === 'AllMembers' || g.postingPermissions === 'ApprovalNeeded');
  return <section aria-labelledby="post-visibility-heading" className="border-y border-gray-100 py-4 space-y-3">
    <h2 id="post-visibility-heading" className="text-sm font-bold text-gray-900">Post visibility</h2>
    <p className="text-xs text-gray-500">Keep at least one destination selected. You can select your profile and groups together.</p>
    <div className="divide-y divide-gray-100">
      {value === 'Followers' && <label className="flex items-center gap-3 py-3 text-xs text-gray-600"><span className="flex-1">Followers (saved audience)</span><input type="checkbox" aria-label="Followers (saved audience)" checked disabled className="w-5 h-5" /></label>}
      {destinations.map(({ id, label, icon: Icon, selected, allowed }) => id === 'Groups' ? <div key={id} className="flex items-center gap-3 min-h-[48px]">
        <button type="button" onClick={() => setGroupPageOpen(true)} className="flex-1 min-w-0 flex items-center gap-3 py-3 text-start" aria-label="Choose selected groups" aria-haspopup="dialog">
          <Icon size={20} className="text-gray-700 shrink-0" />
          <span className="flex-1 text-[12px] font-bold text-gray-800">{label}{selected && <span className="block text-xs font-normal text-gray-500">{selectedGroupIds.length} selected</span>}</span>
          <ChevronRight size={16} className="text-gray-400 rtl:rotate-180" />
        </button>
        <label className="min-w-11 min-h-11 flex items-center justify-center cursor-pointer">
          <input type="checkbox" aria-label={label} checked={selected} onChange={() => changeDestination(id)} className={`w-5 h-5 shrink-0 ${color}`} />
        </label>
      </div> : <label key={id} className={`flex items-center gap-3 py-3 min-h-[48px] ${allowed ? 'cursor-pointer' : 'opacity-40 cursor-not-allowed'}`}>
        <Icon size={20} className="text-gray-700 shrink-0" />
        <span className="flex-1 text-[12px] font-bold text-gray-800">{label}</span>
        <input type="checkbox" aria-label={label} checked={selected} disabled={!allowed} onChange={() => changeDestination(id)} className={`w-5 h-5 shrink-0 ${color}`} />
      </label>)}
    </div>
    {groupPageOpen && <GroupSelectionPage groups={postable} selectedIds={selectedGroups ? selectedGroupIds : []} accent={accent} onClose={() => setGroupPageOpen(false)} onSave={ids => { onGroupsChange(ids); onChange(profile ? 'ProfileAndGroups' : 'Groups'); setGroupPageOpen(false); }} />}
    {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
  </section>;
};
