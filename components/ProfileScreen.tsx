import React, { useState, useMemo, useEffect } from 'react';
import { Settings, Users, Grid, CheckCircle2, MoreHorizontal, MapPin, Link as LinkIcon, Edit3, UserPlus, Shield, ExternalLink, ArrowLeft, Mail, FileText, PieChart, Building2, Globe as GlobeIcon, Plus, ChevronRight, Search, X, UserCircle2, Zap, Info, Lock, BarChart3, TrendingUp, Bookmark, PenTool, Activity } from 'lucide-react';

import { Analytics } from '../utils/analytics';
import { Survey, SurveyType, Group, UserProfile } from '../types';
import { SurveyCard } from './SurveyCard';
import { BottomSheet } from './BottomSheet';
import { ProfileAnalysis } from './ProfileAnalysis';
import { api } from '../services/api';
import { useFollowState } from '../hooks/useFollowState';

interface ProfileScreenProps {
  surveys: Survey[];
  userGroups?: Group[];
  userProfile: UserProfile;
  onSurveyClick: (id: string, surface?: string) => void;
  onGroupClick?: (id: string) => void;
  onVote: (surveyId: string, optionIds: string[], isAnonymous?: boolean, newOption?: any) => void;
  onSurveyProgress?: (surveyId: string, progress: { index: number, answers: Record<string, any>, followUpAnswers?: Record<string, string>, historyStack?: number[], isAnonymous?: boolean }) => void;
  user?: { id?: string; name: string; avatar: string };
  onBack?: () => void;
  onAuthorClick?: (author: { name: string; avatar: string }) => void;
  onShareToFeed?: (survey: Survey, caption: string) => void;
  contextGroups?: any[];
  onSettingsClick?: () => void;
  onEditDraft?: (survey: Survey) => void;
  onUpdateDemographics?: (demographics: Partial<NonNullable<UserProfile['demographics']>>) => void;
  onUpdateCurrentUser?: (updates: Partial<UserProfile>) => void;
  onFollowChange?: (targetUserId: string, isFollowing: boolean) => void;
  onLike?: (surveyId: string, isLiked: boolean) => void;
}



type ProfileTab = 'content' | 'participated' | 'groups' | 'drafts' | 'saved';

export const ProfileScreen: React.FC<ProfileScreenProps> = ({
  surveys,
  userGroups = [],
  userProfile,
  onSurveyClick,
  onGroupClick,
  onVote,
  onSurveyProgress,
  user,
  onBack,
  onAuthorClick,
  onShareToFeed,
  contextGroups = [],
  onSettingsClick,
  onEditDraft,
  onUpdateDemographics,
  onUpdateCurrentUser,
  onFollowChange,
  onLike
}) => {
  const [activeStatSheet, setActiveStatSheet] = useState<'following' | 'followers' | 'posts' | null>(null);
  const [showProfileAnalysis, setShowProfileAnalysis] = useState(false);
  const [statSearch, setStatSearch] = useState('');
  const [postFilter, setPostFilter] = useState<'All' | SurveyType>('All');
  const [activeTab, setActiveTab] = useState<ProfileTab>('content');
  const [isFollowLoading, setIsFollowLoading] = useState(false);
  const [targetUser, setTargetUser] = useState<UserProfile | null>(null);

  const viewUserId = (!user?.id || user.id === userProfile.id) ? userProfile.id : (user as any)?.id;
  const [isFollowing, setLocalFollowingState] = useFollowState(viewUserId, false);

  const [drafts, setDrafts] = useState<Survey[]>([]);
  const [savedPosts, setSavedPosts] = useState<Survey[]>([]);
  const [displayedGroups, setDisplayedGroups] = useState<Group[]>([]);

  const [analytics, setAnalytics] = useState<any>(null);
  const [connectionList, setConnectionList] = useState<any[]>([]);
  const [isConnectionLoading, setIsConnectionLoading] = useState(false);

  const isMe = !user?.id || user.id === userProfile.id;

  // Load drafts if active tab is drafts
  useEffect(() => {
    if (activeTab === 'drafts' && isMe && userProfile.id) {
      api.getDrafts(userProfile.id).then(setDrafts).catch(console.error);
    }
  }, [activeTab, isMe, userProfile.id]);

  // Load saved posts if active tab is saved
  useEffect(() => {
    if (activeTab === 'saved' && isMe && userProfile.id) {
      api.getSavedPosts(userProfile.id).then(setSavedPosts).catch(console.error);
    }
  }, [activeTab, isMe, userProfile.id]);

  // Load target user's groups if active tab is groups
  useEffect(() => {
    if (activeTab === 'groups') {
      const targetUserId = isMe ? userProfile.id : (user as any)?.id;
      if (targetUserId) {
        api.getUserGroups(targetUserId).then(setDisplayedGroups).catch(console.error);
      }
    }
  }, [activeTab, isMe, userProfile.id, user]);

  // Load follow status when viewing another user's profile
  useEffect(() => {
    const loadFollowStatus = async () => {
      if (!isMe && user) {
        try {
          // Fetch full target user profile to get real stats
          const userId = (user as any).id;
          if (userId) {
            const fullUser = await api.getUser(userId);
            setTargetUser(fullUser);
          }

          if (userId && userProfile?.id) {
            const status = await api.getFollowStatus(userId, userProfile.id);
            setLocalFollowingState(status.isFollowing);
          }

          Analytics.track({
            event_type: 'PROFILE_VISIT',
            target_user_id: (user as any).id,
            actor_user_id: userProfile?.id,
            source_surface: 'PROFILE'
          });
        } catch (error) {
          console.error('Failed to load profile data:', error);
        }
      }
    };

    // Also load analytics for the displayed user to show real counts
    const loadAnalytics = async () => {
      const targetUserId = isMe ? userProfile.id : (user as any)?.id;
      if (targetUserId) {
        try {
          const data = await api.getUserAnalytics(targetUserId);
          setAnalytics(data);
        } catch (e) { console.error(e); }
      }
    };

    loadFollowStatus();
    loadAnalytics();
  }, [isMe, user, userProfile?.id]);

  // Load connection list when sheet opens
  useEffect(() => {
    const loadConnections = async () => {
      const targetUserId = isMe ? userProfile.id : (user as any)?.id;
      if (!activeStatSheet || activeStatSheet === 'posts' || !targetUserId) return;

      setIsConnectionLoading(true);
      setConnectionList([]);

      try {
        let list = [];
        if (activeStatSheet === 'followers') {
          list = await api.getUserFollowers(targetUserId, userProfile.id);
        } else {
          list = await api.getUserFollowing(targetUserId, userProfile.id);
        }
        setConnectionList(list);
      } catch (error) {
        console.error("Failed to load connections", error);
      } finally {
        setIsConnectionLoading(false);
      }
    };

    loadConnections();
  }, [activeStatSheet, isMe, user, userProfile?.id]);

  const handleConnectionAction = async (person: any) => {
    if (isMe && person.id === userProfile.id) return; // Can't follow self
    if (!userProfile?.id) return;

    // Determine action: if following, then unfollow. If not following, then follow.
    // Optimistic update of the list
    setConnectionList(prev => prev.map(p => {
      if (p.id === person.id) {
        return { ...p, isFollowing: !p.isFollowing };
      }
      return p;
    }));

    try {
      const response = await api.followUser(person.id, userProfile.id);

      // Verify consistency and correct if needed
      setConnectionList(prev => prev.map(p => {
        if (p.id === person.id) {
          return { ...p, isFollowing: response.isFollowing };
        }
        return p;
      }));

      // Update Current User Stats (Following count)
      if (response.currentUserFollowing !== undefined && onUpdateCurrentUser) {
        onUpdateCurrentUser({
          stats: {
            ...userProfile.stats,
            following: response.currentUserFollowing
          }
        });
      }

      // If we are viewing our own profile, updating "Following" list might affect "Following" count stats displayed in header?
      // If we are viewing someone else's profile, and we follow someone in THEIR list, it doesn't affect THEIR stats (unless we followed THEM).
      // But if we un/follow the profile owner FROM the list (if they appear there? unlikely), proper updates should happen.

      // If we followed/unfollowed the *profile owner* from a list (e.g. they appeared in someone else's list which is not this view), we should update `isFollowing` state.
      if (user && person.id === (user as any).id) {
        setLocalFollowingState(response.isFollowing);
        if (response.targetUserFollowers !== undefined) {
          setTargetUser(prev => prev ? ({ ...prev, stats: { ...prev.stats, followers: response.targetUserFollowers } }) : null);
        }
      }

      if (onFollowChange) {
        onFollowChange(person.id, response.isFollowing);
      }

    } catch (error) {
      console.error("Connection action failed:", error);
      // Revert
      setConnectionList(prev => prev.map(p => {
        if (p.id === person.id) {
          return { ...p, isFollowing: !p.isFollowing };
        }
        return p;
      }));
    }
  };

  const handleFollow = async () => {
    if (isMe) return; // Cannot follow yourself

    const userId = (user as any).id;
    if (!userId || !userProfile?.id) return;

    setIsFollowLoading(true);
    try {
      const response = await api.followUser(userId, userProfile.id);
      setLocalFollowingState(response.isFollowing);

      // Update Target User Stats Locally
      if (response.targetUserFollowers !== undefined) {
        setTargetUser(prev => prev ? ({ ...prev, stats: { ...prev.stats, followers: response.targetUserFollowers } }) : null);
      }

      // Update Current User Stats Locally (Following count changes)
      if (response.currentUserFollowing !== undefined && onUpdateCurrentUser) {
        onUpdateCurrentUser({
          stats: {
            ...userProfile.stats,
            following: response.currentUserFollowing
          }
        });
      }

      if (onFollowChange) {
        onFollowChange(userId, response.isFollowing);
      }

      Analytics.track({
        event_type: 'FOLLOW_TOGGLE',
        target_user_id: userId,
        new_state: response.isFollowing,
        actor_user_id: userProfile?.id,
        source_surface: 'PROFILE'
      });
    } catch (error) {
      console.error('Failed to follow/unfollow:', error);
    } finally {
      setIsFollowLoading(false);
    }
  };

  const profileUser = useMemo(() => {
    // If it's me, use my profile + fetched analytics
    if (isMe) {
      return {
        ...userProfile,
        stats: {
          ...userProfile.stats,
          responses: analytics?.totalResponses || 0
        }
      };
    }

    // If external user, wrap in profile structure
    // Use targetUser if available (fetched from DB), otherwise fall back to passed props or dummy
    if (targetUser) {
      return {
        ...targetUser,
        stats: {
          ...targetUser.stats,
          responses: analytics?.totalResponses || targetUser.stats.responses || 0
        }
      };
    }

    return {
      id: user?.id,
      name: user!.name,
      avatar: user!.avatar,
      handle: user!.name.replace(/\s+/g, '').toLowerCase(),
      bio: `Content creator on SocialInsight.`,
      location: 'Global',
      website: '',
      isPrivate: false,
      stats: {
        followers: 0,
        following: 0,
        responses: analytics?.totalResponses || 0
      }
    } as UserProfile;
  }, [isMe, user, userProfile, analytics, targetUser]);

  const mySurveys = useMemo(() => surveys.filter(s =>
    isMe
      ? s.author.id === userProfile.id
      : s.author.id === profileUser.id
  ), [surveys, isMe, userProfile.id, profileUser.id]);

  const responsesCount = useMemo(() => {
    return profileUser?.stats?.responses || 0;
  }, [profileUser?.stats?.responses]);

  const filteredConnections = useMemo(() => {
    return connectionList.filter(c =>
      c.name.toLowerCase().includes(statSearch.toLowerCase()) ||
      c.handle.toLowerCase().includes(statSearch.toLowerCase())
    );
  }, [statSearch, connectionList]);

  const filteredPosts = useMemo(() => {
    let list = mySurveys.filter(s => !s.isDraft);
    if (postFilter !== 'All') {
      list = list.filter(s => s.type === postFilter);
    }
    return list.filter(s => s.title.toLowerCase().includes(statSearch.toLowerCase()));
  }, [mySurveys, postFilter, statSearch]);

  const renderStatSheetContent = () => {
    if (profileUser.isPrivate && !isMe) {
      return (
        <div className="flex flex-col items-center justify-center h-[60vh] text-center p-8">
          <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mb-6 text-gray-300">
            <Lock size={40} />
          </div>
          <h3 className="text-xl font-black text-gray-900 mb-2">Private Account</h3>
          <p className="text-gray-500 text-sm">Follow this account to see their activity and posts.</p>
        </div>
      );
    }

    if (activeStatSheet === 'posts') {
      return (
        <div className="flex flex-col h-full bg-white">
          <div className="px-4 py-4 space-y-4 sticky top-0 bg-white z-10">
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                value={statSearch}
                onChange={(e) => setStatSearch(e.target.value)}
                placeholder="Search posts..."
                className="w-full bg-gray-100 border-none rounded-2xl pl-11 pr-4 py-3 text-sm focus:ring-2 focus:ring-blue-500/10"
              />
            </div>
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
              {['All', SurveyType.POLL, SurveyType.SURVEY, SurveyType.QUIZ, SurveyType.CHALLENGE].map(f => (
                <button
                  key={f}
                  onClick={() => setPostFilter(f as any)}
                  className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all border ${postFilter === f ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-white text-gray-400 border-gray-200 hover:bg-gray-50'
                    }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-4 pb-20 no-scrollbar">
            {filteredPosts.length > 0 ? (
              <div className="grid grid-cols-1 gap-3">
                {filteredPosts.map(post => (
                  <button
                    key={post.id}
                    onClick={() => { setActiveStatSheet(null); onSurveyClick(post.id, 'PROFILE_STAT_SHEET'); }}
                    className="w-full flex items-center gap-4 p-4 rounded-2xl bg-white border border-gray-100 hover:border-blue-200 transition-all text-left shadow-sm active:scale-[0.98]"
                  >
                    <div className="w-12 h-12 rounded-xl bg-gray-50 flex items-center justify-center text-gray-400 shrink-0">
                      {post.type === SurveyType.POLL ? <PieChart size={24} /> : post.type === SurveyType.QUIZ ? <Zap size={24} /> : <FileText size={24} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-bold text-gray-900 text-sm truncate">{post.title}</h4>
                      <div className="flex items-center gap-2 mt-1 text-[9px] font-black uppercase tracking-widest text-gray-400">
                        <span>{post.type}</span>
                        <span>•</span>
                        <span className="text-blue-600">{(post.participants || 0).toLocaleString()} Responses</span>
                      </div>
                    </div>
                    <ChevronRight size={18} className="text-gray-300" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="py-20 text-center text-gray-400">
                <Grid size={48} className="mx-auto mb-4 opacity-10" />
                <p className="text-sm font-bold uppercase tracking-widest">No posts yet — start your first poll</p>
              </div>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col h-full bg-white">
        <div className="px-4 py-4 sticky top-0 bg-white z-10">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              value={statSearch}
              onChange={(e) => setStatSearch(e.target.value)}
              placeholder="Search connections..."
              className="w-full bg-gray-100 border-none rounded-2xl pl-11 pr-4 py-3 text-sm focus:ring-2 focus:ring-blue-500/10"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-20 no-scrollbar">
          {filteredConnections.length > 0 ? (
            <div className="divide-y divide-gray-50">
              {filteredConnections.map(person => (
                <div key={person.id} className="flex items-center justify-between py-4 group">
                  <div
                    className="flex items-center gap-3 flex-1 min-w-0"
                    onClick={() => {
                      setActiveStatSheet(null);
                      if (onAuthorClick) onAuthorClick({ id: person.id, name: person.name, avatar: person.avatar });
                    }}
                  >
                    <img src={person.avatar} className="w-12 h-12 rounded-full object-cover border border-gray-100" alt="" />
                    <div className="min-w-0">
                      <h4 className="font-bold text-gray-900 text-sm truncate">{person.name}</h4>
                      <p className="text-xs text-gray-400">@{person.handle}</p>
                    </div>
                  </div>
                  {person.id !== userProfile.id && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleConnectionAction(person); }}
                      className={`px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${person.isFollowing ? 'bg-gray-100 text-gray-600' : 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
                        }`}>
                      {person.isFollowing ? 'Unfollow' : (activeStatSheet === 'followers' ? 'Follow Back' : 'Follow')}
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="py-20 text-center text-gray-400">
              <Users size={48} className="mx-auto mb-4 opacity-10" />
              <p className="text-sm font-bold uppercase tracking-widest">No connections yet</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  const tabs = useMemo(() => {
    const baseTabs = [
      { id: 'content', label: 'Posts' },
      { id: 'participated', label: 'Activity' }
    ];

    // If not me, we must respect the target user's group privacy settings.
    // userProfile is passed as the target profile when viewing someone else but targetUser 
    // holds the full state. Use targetUser if viewing someone else.
    const privacy = (isMe ? profileUser?.groupPrivacy : targetUser?.groupPrivacy || profileUser?.groupPrivacy) || 'Public';
    let canViewGroups = true;

    if (!isMe) {
      if (privacy === 'Off') {
        canViewGroups = false;
      } else if (privacy === 'Followers' && !isFollowing) {
        canViewGroups = false;
      }
    }

    if (canViewGroups) {
      baseTabs.push({ id: 'groups', label: 'Groups' });
    }

    if (isMe) {
      baseTabs.push({ id: 'drafts', label: 'Drafts' });
      baseTabs.push({ id: 'saved', label: 'Saved' });
    }
    return baseTabs;
  }, [isMe, profileUser?.groupPrivacy, targetUser?.groupPrivacy, isFollowing]);

  const renderTabContent = () => {
    switch (activeTab) {
      case 'content':
        const publishedPosts = mySurveys.filter(s => !s.isDraft);
        return publishedPosts.length > 0 ? (
          <div className="space-y-1 animate-in fade-in duration-300">
            {publishedPosts.map(survey => (
              <SurveyCard
                key={survey.id}
                survey={survey}
                userProfile={userProfile}
                onContentClick={() => onSurveyClick(survey.id, 'PROFILE')}
                onAnalysisClick={() => onSurveyClick(survey.id, 'PROFILE', 'analysis')}
                onVote={onVote}
                onSurveyProgress={onSurveyProgress}
                onAuthorClick={onAuthorClick}
                onShareToFeed={onShareToFeed}
                onUpdateDemographics={onUpdateDemographics}
                contextGroups={contextGroups}
                onGroupClick={onGroupClick}
                sourceSurface="PROFILE"
                onLike={onLike}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 px-8 text-center text-gray-400">
            <FileText size={48} className="opacity-10 mb-4" />
            <p className="text-sm font-bold uppercase tracking-widest">No posts yet</p>
          </div>
        );

      case 'drafts':
        const draftPosts = drafts; // Use fetched drafts, no filter needed on props
        return draftPosts.length > 0 ? (
          <div className="p-4 grid grid-cols-1 gap-4 animate-in fade-in duration-300">
            {draftPosts.map(survey => (
              <button
                key={survey.id}
                onClick={() => onEditDraft?.(survey)}
                className="w-full flex items-center gap-4 p-4 rounded-3xl bg-white border border-gray-100 hover:border-blue-200 transition-all text-left shadow-sm active:scale-[0.98]"
              >
                <div className="w-12 h-12 rounded-2xl bg-orange-50 text-orange-600 flex items-center justify-center shrink-0">
                  <PenTool size={24} />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-gray-900 text-sm truncate">{survey.title || 'Untitled Draft'}</h4>
                  <div className="flex items-center gap-2 mt-1 text-[9px] font-black uppercase tracking-widest text-gray-400">
                    <span>{survey.type}</span>
                    <span>•</span>
                    <span>Last edited {new Date(survey.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[8px] font-black text-orange-500 uppercase bg-orange-50 px-2 py-1 rounded-lg">Draft</span>
                  <ChevronRight size={18} className="text-gray-300" />
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 px-8 text-center text-gray-400">
            <PenTool size={48} className="opacity-10 mb-4" />
            <p className="text-sm font-bold uppercase tracking-widest">No drafts saved</p>
          </div>
        );

      case 'saved':
        return savedPosts.length > 0 ? (
          <div className="space-y-1 animate-in fade-in duration-300">
            {savedPosts.map(survey => (
              <SurveyCard
                key={survey.id}
                survey={survey}
                userProfile={userProfile}
                onContentClick={() => onSurveyClick(survey.id, 'SAVED')}
                onAnalysisClick={() => onSurveyClick(survey.id, 'SAVED', 'analysis')}
                onVote={onVote}
                onSurveyProgress={onSurveyProgress}
                onAuthorClick={onAuthorClick}
                onShareToFeed={onShareToFeed}
                contextGroups={contextGroups}
                onGroupClick={onGroupClick}
                onUpdateDemographics={onUpdateDemographics}
                sourceSurface="SAVED"
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 px-8 text-center text-gray-400">
            <Bookmark size={48} className="opacity-10 mb-4" />
            <p className="text-sm font-bold uppercase tracking-widest">No saved Posts</p>
          </div>
        );

      case 'participated':
        return (
          <div className="flex flex-col items-center justify-center py-20 px-8 text-center text-gray-400">
            <Activity size={48} className="opacity-10 mb-4" />
            <p className="text-sm font-bold uppercase tracking-widest">Your activity will appear here</p>
          </div>
        );

      case 'groups':
        return displayedGroups.length > 0 ? (
          <div className="p-4 grid grid-cols-1 gap-3 animate-in fade-in duration-300">
            {displayedGroups.map(group => (
              <button
                key={group.id}
                onClick={() => onGroupClick?.(group.id)}
                className="w-full flex items-center gap-4 p-4 rounded-3xl bg-white border border-gray-100 hover:border-blue-200 transition-all text-left shadow-sm active:scale-[0.98]"
              >
                <img src={group.image || 'https://picsum.photos/100/100'} className="w-14 h-14 rounded-2xl object-cover border border-gray-50 shadow-sm" alt="" />
                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-gray-900 text-sm truncate">{group.name}</h4>
                  <div className="flex items-center gap-2 mt-1 text-[9px] font-black uppercase tracking-widest text-gray-400">
                    <span>{group.category}</span>
                    <span>•</span>
                    <span className="text-blue-600">{(group.memberCount || 0).toLocaleString()} MEMBERS</span>
                  </div>
                </div>
                <ChevronRight size={18} className="text-gray-300" />
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 px-8 text-center text-gray-400">
            <Building2 size={48} className="opacity-10 mb-4" />
            <p className="text-sm font-bold uppercase tracking-widest">No groups yet</p>
          </div>
        );

      default:
        return null;
    }
  };

  if (showProfileAnalysis) {
    return <ProfileAnalysis userProfile={profileUser} onBack={() => setShowProfileAnalysis(false)} />;
  }

  return (
    <div className="bg-white flex-1 overflow-y-auto min-h-full flex flex-col no-scrollbar">
      <div className={`flex items-center px-4 h-[60px] sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-gray-50 ${onBack ? 'justify-between' : 'justify-end'}`}>
        {onBack && (
          <button onClick={onBack} className="p-2 -ml-2 text-gray-600 hover:bg-gray-50 rounded-full transition-colors">
            <ArrowLeft size={24} />
          </button>
        )}
        <button
          onClick={isMe ? onSettingsClick : undefined}
          className="p-2 text-gray-600 hover:bg-gray-50 rounded-full transition-colors"
        >
          {isMe ? <Settings size={22} /> : <MoreHorizontal size={22} />}
        </button>
      </div>

      <div className="relative bg-white pb-6">
        <div className="px-6 flex flex-col items-center pt-2">
          <div className="relative mb-6">
            <div className="w-28 h-28 rounded-[2.5rem] p-1 bg-white shadow-xl border border-gray-100 ring-4 ring-gray-50/50">
              <img 
                src={profileUser.avatar} 
                alt="Profile" 
                className="w-full h-full rounded-[2.25rem] object-cover" 
                onError={(e) => {
                  e.currentTarget.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(profileUser.name || 'User')}&background=f3f4f6&color=9ca3af&size=200`;
                }}
              />
            </div>
            {isMe && (
              <button
                onClick={onSettingsClick}
                className="absolute -bottom-1 -right-1 p-2 bg-blue-600 text-white rounded-2xl shadow-lg hover:bg-blue-700 transition-colors border-2 border-white active:scale-90"
              >
                <Edit3 size={16} />
              </button>
            )}
          </div>

          <h2 className="text-2xl font-black text-gray-900 text-center flex items-center gap-2 tracking-tight">
            {profileUser.name}
            {profileUser.isPrivate && <Lock size={18} className="text-gray-400" />}
          </h2>
          <p className="text-xs text-blue-600 font-black uppercase tracking-[0.2em] mb-4">@{profileUser.handle}</p>

          <p className="text-sm text-gray-600 text-center max-w-sm leading-relaxed whitespace-pre-wrap mb-6 px-4">
            {profileUser.bio}
          </p>

          <div className="flex flex-wrap items-center justify-center gap-5 text-xs text-gray-500 mb-8 font-bold uppercase tracking-wider">
            {profileUser.location && (
              <div className="flex items-center gap-1.5 bg-gray-50 px-3 py-1 rounded-lg">
                <MapPin size={12} className="text-gray-400" /> {profileUser.location}
              </div>
            )}
            {profileUser.website && (
              <div className="flex items-center gap-1.5 text-blue-600 bg-blue-50 px-3 py-1 rounded-lg">
                <LinkIcon size={12} /> {profileUser.website}
              </div>
            )}
          </div>

          {!isMe && (
            <div className="flex gap-3 mb-8 w-full px-4 animate-in fade-in slide-in-from-bottom-2">
              <button
                onClick={handleFollow}
                disabled={isFollowLoading}
                className={`flex-1 py-4 rounded-2xl font-black uppercase tracking-widest text-[11px] transition-all active:scale-95 shadow-xl ${isFollowing
                  ? 'bg-gray-100 text-gray-600 shadow-gray-200/50'
                  : 'bg-blue-600 text-white shadow-blue-500/20'
                  } ${isFollowLoading ? 'opacity-50' : ''}`}
              >
                {isFollowing ? 'Following' : 'Follow'}
              </button>
            </div>
          )}

          <div className="w-full bg-white rounded-[2.5rem] border border-gray-100 shadow-xl shadow-gray-200/40 px-3 py-6 mb-4">
            <div className="grid grid-cols-4 gap-0 divide-x divide-gray-50">
              <button
                onClick={() => { setStatSearch(''); setActiveStatSheet('following'); }}
                className="flex flex-col items-center group active:scale-95 transition-transform"
              >
                <div className="p-2 rounded-xl bg-blue-50 text-blue-600 mb-2 transition-colors">
                  <UserPlus size={16} strokeWidth={2.5} />
                </div>
                <div className="text-sm font-black text-gray-900 tabular-nums">
                  {profileUser?.stats?.following?.toLocaleString() || 0}
                </div>
                <div className="text-[8px] font-black text-gray-400 uppercase tracking-tighter mt-1">Following</div>
              </button>

              <button
                onClick={() => { setStatSearch(''); setActiveStatSheet('followers'); }}
                className="flex flex-col items-center group active:scale-95 transition-transform"
              >
                <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600 mb-2 transition-colors">
                  <Users size={16} strokeWidth={2.5} />
                </div>
                <div className="text-sm font-black text-gray-900 tabular-nums">
                  {profileUser?.stats?.followers?.toLocaleString() || 0}
                </div>
                <div className="text-[8px] font-black text-gray-400 uppercase tracking-tighter mt-1">Followers</div>
              </button>

              <button
                disabled={profileUser.isPrivate && !isMe}
                onClick={() => { setStatSearch(''); setPostFilter('All'); setActiveStatSheet('posts'); }}
                className={`flex flex-col items-center group active:scale-95 transition-transform ${profileUser.isPrivate && !isMe ? 'opacity-30 grayscale' : ''}`}
              >
                <div className="p-2 rounded-xl bg-orange-50 text-orange-600 mb-2 transition-colors relative">
                  <FileText size={16} strokeWidth={2.5} />
                  {profileUser.isPrivate && !isMe && <Lock size={8} className="absolute top-1 right-1" />}
                </div>
                <div className="text-sm font-black text-gray-900 tabular-nums">
                  {mySurveys.filter(s => !s.isDraft).length || 0}
                </div>
                <div className="text-[8px] font-black text-gray-400 uppercase tracking-tighter mt-1">Posts</div>
              </button>

              <button
                onClick={() => setShowProfileAnalysis(true)}
                className="flex flex-col items-center group active:scale-95 transition-transform"
              >
                <div className="p-2 rounded-xl bg-green-50 text-green-600 mb-2 transition-colors">
                  <TrendingUp size={16} strokeWidth={2.5} />
                </div>
                <div className="text-sm font-black text-gray-900 tabular-nums">
                  {responsesCount >= 1000 ? (responsesCount / 1000).toFixed(1) + 'K' : responsesCount}
                </div>
                <div className="text-[8px] font-black text-gray-400 uppercase tracking-tighter mt-1">Responses</div>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 bg-gray-50/50">
        <div className="sticky top-[60px] bg-white/95 backdrop-blur-md z-20 border-b border-gray-100">
          <div className="flex items-center px-4 overflow-x-auto no-scrollbar">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex-1 min-w-[80px] py-4 text-[10px] font-black uppercase tracking-widest border-b-2 transition-all relative whitespace-nowrap ${activeTab === tab.id
                  ? 'text-blue-600 border-blue-600'
                  : 'text-gray-400 border-transparent hover:text-gray-600'
                  }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="pb-20">
          {renderTabContent()}
        </div>
      </div>

      <BottomSheet
        isOpen={activeStatSheet !== null}
        onClose={() => setActiveStatSheet(null)}
        height="90vh"
        customLayout={true}
        title={
          activeStatSheet === 'following' ? `Following (${profileUser.stats.following})` :
            activeStatSheet === 'followers' ? `Followers (${profileUser.stats.followers})` :
              `Posts (${mySurveys.filter(s => !s.isDraft).length})`
        }
      >
        {renderStatSheetContent()}
      </BottomSheet>
    </div>
  );
};

const AtSign = ({ size, className }: { size: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="4" /><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94" />
  </svg>
);