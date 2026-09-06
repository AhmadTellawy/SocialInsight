import React from 'react';
import { Link2, Target, UserRound, Users } from 'lucide-react';

interface Props {
  value: string;
  onChange: (value: any) => void;
  selectedGroupIds: string[];
  onGroupsChange: (ids: string[]) => void;
  groups: { id: string; name: string; image?: string; role?: string; postingPermissions?: string; memberCount?: number }[];
  allowCustomAudience: boolean;
  allowCustomDomain: boolean;
  error?: string | false;
  accent?: 'blue' | 'purple' | 'amber';
}

export const PostVisibilitySection: React.FC<Props> = ({ value, onChange, selectedGroupIds, onGroupsChange, groups, allowCustomAudience, allowCustomDomain, error, accent = 'blue' }) => {
  const profile = value === 'Public' || value === 'ProfileAndGroups';
  const selectedGroups = value === 'Groups' || value === 'ProfileAndGroups';
  const color = { blue: 'accent-blue-600', purple: 'accent-purple-600', amber: 'accent-amber-600' }[accent];
  const changeDestination = (id: string) => {
    if (id === 'Public') onChange(profile ? (selectedGroups ? 'Groups' : '') : (selectedGroups ? 'ProfileAndGroups' : 'Public'));
    else if (id === 'Groups') onChange(selectedGroups ? (profile ? 'Public' : '') : (profile ? 'ProfileAndGroups' : 'Groups'));
    else onChange(value === id ? '' : id);
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
    <p className="text-xs text-gray-500">Choose where to post. You can select your profile and groups together.</p>
    <div className="divide-y divide-gray-100">
      {value === 'Followers' && <p className="text-xs text-gray-600 py-2">This draft is visible to followers. Select a destination below to change it.</p>}
      {destinations.map(({ id, label, icon: Icon, selected, allowed }) => <label key={id} className={`flex items-center gap-3 py-3 min-h-[48px] ${allowed ? 'cursor-pointer' : 'opacity-40 cursor-not-allowed'}`}>
        <Icon size={20} className="text-gray-700 shrink-0" />
        <span className="flex-1 text-[12px] font-bold text-gray-800">{label}</span>
        <input type="checkbox" aria-label={label} checked={selected} disabled={!allowed} onChange={() => changeDestination(id)} className={`w-5 h-5 shrink-0 ${color}`} />
      </label>)}
    </div>
    {selectedGroups && <fieldset className="p-3 bg-gray-50 rounded-xl space-y-2">
      <legend className="text-xs font-bold text-gray-700 px-1">Select target groups</legend>
      {postable.length ? postable.map(group => <label key={group.id} className="flex items-center gap-3 min-h-[44px] py-2 cursor-pointer">
        <span dir="auto" className="flex-1 min-w-0 text-start text-xs break-words">{group.name}</span>
        <input type="checkbox" aria-label={group.name} checked={selectedGroupIds.includes(group.id)} onChange={() => onGroupsChange(selectedGroupIds.includes(group.id) ? selectedGroupIds.filter(id => id !== group.id) : [...selectedGroupIds, group.id])} className={`w-5 h-5 shrink-0 ${color}`} />
      </label>) : <p className="text-xs text-gray-500 py-2">You don't have permission to post in any groups.</p>}
    </fieldset>}
    {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
  </section>;
};
