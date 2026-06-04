import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Settings, Users, Grid, CheckCircle2, MoreHorizontal, MapPin, Link as LinkIcon, Edit3, UserPlus, Shield, ExternalLink, ArrowLeft, Mail, FileText, PieChart, Building2, Globe as GlobeIcon, Plus, ChevronRight, Search, X, UserCircle2, Zap, Info, Lock, BarChart3, TrendingUp, Bookmark, PenTool, Activity, Repeat } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Analytics } from '../utils/analytics';
import { PostAnswerPayload, Survey, SurveyType, Group, UserProfile } from '../types';
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
  onVote: (surveyId: string, optionIds: string[], isAnonymous?: boolean, newOption?: any, followUpAnswers?: Record<string, string>, answers?: PostAnswerPayload[]) => void;
  onSurveyProgress?: (surveyId: string, progress: { index: number, answers: Record<string, any>, followUpAnswers?: Record<string, string>, historyStack?: number[], isAnonymous?: boolean }) => void;
  user?: Partial<UserProfile> & { id?: string; name: string; avatar: string; handle?: string; isFollowing?: boolean; followStatus?: string; isPrivate?: boolean };
  onBack?: () => void;
  onAuthorClick?: (author: { id: string; name: string; avatar: string; handle?: string }) => void;
  onShareToFeed?: (survey: Survey, caption: string) => void;
  contextGroups?: any[];
  onSettingsClick?: () => void;
  onEditDraft?: (survey: Survey) => void;
  onUpdateDemographics?: (demographics: Partial<NonNullable<UserProfile['demographics']>>) => void;
  onUpdateCurrentUser?: (updates: Partial<UserProfile>) => void;
  onFollowChange?: (targetUserId: string, isFollowing: boolean) => void;
  onLike?: (surveyId: string, isLiked: boolean) => void;
  isLoading?: boolean;
  isLoadingMore?: boolean;
  hasNextPage?: boolean;
  onLoadMore?: () => void;
}

type ProfileTab = 'content' | 'reposts' | 'groups' | 'drafts' | 'saved';

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
  onLike,
  isLoading,
  isLoadingMore,
  hasNextPage,
  onLoadMore
}) => {
  const { t } = useTranslation();
  const [activeStatSheet, setActiveStatSheet] = useState<'following' | 'followers' | 'posts' | null>(null);
  const [showProfileAnalysis, setShowProfileAnalysis] = useState(false);
  const [statSearch, setStatSearch] = useState('');
  const [postFilter, setPostFilter] = useState<'All' | SurveyType>('All');
  const [activeTab, setActiveTab] = useState<ProfileTab>('content');
  const [isFollowLoading, setIsFollowLoading] = useState(false);
  const [targetUser, setTargetUser] = useState<UserProfile | null>(null);

  const viewUserId = (!user?.id || user.id === userProfile.id) ? userProfile.id : (user as any)?.id;
  const initialFollowStatus = (user as any)?.followStatus || ((user as any)?.isFollowing ? 'ACTIVE' : 'NONE');
  const [isFollowing, setLocalFollowingState] = useFollowState(viewUserId, (user as any)?.isFollowing === true || initialFollowStatus === 'ACTIVE');
  const [followStatus, setFollowStatus] = useState<string>(initialFollowStatus);

  const [drafts, setDrafts] = useState<Survey[]>([]);
  const [savedPosts, setSavedPosts] = useState<Survey[]>([]);
  const [displayedGroups, setDisplayedGroups] = useState<Group[]>([]);
  const [isGroupsLoading, setIsGroupsLoading] = useState(false);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const groupsRequestRef = useRef(0);

  const [analytics, setAnalytics] = useState<any>(null);
  const [connectionList, setConnectionList] = useState<any[]>([]);
  const [isConnectionLoading, setIsConnectionLoading] = useState(false);

  const isMe = !user?.id || user.id === userProfile.id;
  const suppliedUser = user as (Partial<UserProfile> & { isFollowing?: boolean; followStatus?: string }) | undefined;
  const resolvedTargetUser = targetUser?.id === viewUserId ? targetUser : null;
  const hasProfileStats = isMe || !!resolvedTargetUser?.stats || !!suppliedUser?.stats;

  useEffect(() => {
    if (activeTab === 'drafts' && isMe && userProfile.id) {
      api.getDrafts(userProfile.id).then(setDrafts).catch(console.error);
    }
  }, [activeTab, isMe, userProfile.id]);

  useEffect(() => {
    if (activeTab === 'saved' && isMe && userProfile.id) {
      api.getSavedPosts(userProfile.id).then(setSavedPosts).catch(console.error);
    }
  }, [activeTab, isMe, userProfile.id]);

  useEffect(() => {
    if (activeTab !== 'groups') return;

    const targetUserId = isMe ? userProfile.id : (user as any)?.id;
    if (!targetUserId) {
      setDisplayedGroups([]);
      setIsGroupsLoading(false);
      setGroupsError(null);
      return;
    }

    const requestId = ++groupsRequestRef.current;
    setGroupsError(null);
    setIsGroupsLoading(true);

    if (isMe && userGroups.length > 0) {
      setDisplayedGroups(userGroups);
    } else {
      setDisplayedGroups([]);
    }

    api.getUserGroups(targetUserId)
      .then(groups => {
        if (groupsRequestRef.current === requestId) setDisplayedGroups(groups);
      })
      .catch(error => {
        if (groupsRequestRef.current !== requestId) return;
        console.error(error);
        setGroupsError('Failed to load groups.');
        setDisplayedGroups([]);
      })
      .finally(() => {
        if (groupsRequestRef.current === requestId) setIsGroupsLoading(false);
      });
  }, [activeTab, isMe, userProfile.id, user, userGroups]);

  useEffect(() => {
    if (isMe) {
      setTargetUser(null);
      return;
    }

    setTargetUser(prev => prev?.id === viewUserId ? prev : null);
    setFollowStatus(suppliedUser?.followStatus || (suppliedUser?.isFollowing ? 'ACTIVE' : 'NONE'));
  }, [isMe, viewUserId, suppliedUser?.followStatus, suppliedUser?.isFollowing]);

  useEffect(() => {
    const loadFollowStatus = async () => {
      if (!isMe && user) {
        try {
          const userId = (user as any).id;
          if (userId) {
            const fullUser = await api.getUser(userId);
            setTargetUser(fullUser);
            const nextFollowStatus = fullUser?.followStatus || 'NONE';
            setLocalFollowingState(fullUser?.isFollowing === true || nextFollowStatus === 'ACTIVE');
            if (fullUser && fullUser.followStatus) {
              setFollowStatus(fullUser.followStatus);
            }
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
    if (isMe && person.id === userProfile.id) return;
    if (!userProfile?.id) return;

    setConnectionList(prev => prev.map(p => {
      if (p.id === person.id) {
        return { ...p, isFollowing: !p.isFollowing };
      }
      return p;
    }));

    try {
      const response = await api.followUser(person.id, userProfile.id);

      setConnectionList(prev => prev.map(p => {
        if (p.id === person.id) {
          return { ...p, isFollowing: response.isFollowing };
        }
        return p;
      }));

      if (response.currentUserFollowing !== undefined && onUpdateCurrentUser) {
        onUpdateCurrentUser({
          stats: {
            ...userProfile.stats,
            following: response.currentUserFollowing
          }
        });
      }

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
      setConnectionList(prev => prev.map(p => {
        if (p.id === person.id) {
          return { ...p, isFollowing: !p.isFollowing };
        }
        return p;
      }));
    }
  };

  const handleFollow = async () => {
    if (isMe) return;

    const userId = (user as any).id;
    if (!userId || !userProfile?.id) return;

    setIsFollowLoading(true);
    try {
      const response = await api.followUser(userId, userProfile.id);
      setLocalFollowingState(response.isFollowing);
      setFollowStatus(response.followStatus || 'NONE');

      if (response.targetUserFollowers !== undefined) {
        setTargetUser(prev => prev ? ({ ...prev, stats: { ...prev.stats, followers: response.targetUserFollowers } }) : null);
      }

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
    if (isMe) {
      return {
        ...userProfile,
        stats: {
          ...userProfile.stats,
          responses: analytics?.totalResponses ?? userProfile.stats?.responses ?? 0
        }
      };
    }

    if (resolvedTargetUser) {
      return {
        ...resolvedTargetUser,
        stats: {
          ...resolvedTargetUser.stats,
          responses: analytics?.totalResponses ?? resolvedTargetUser.stats?.responses ?? 0
        }
      };
    }

    const suppliedStats = suppliedUser?.stats;
    return {
      id: user?.id,
      name: user!.name,
      avatar: user!.avatar,
      handle: suppliedUser?.handle || user!.name.replace(/\s+/g, '').toLowerCase(),
      bio: suppliedUser?.bio || `Content creator on SocialInsight.`,
      location: suppliedUser?.location || '',
      website: suppliedUser?.website || '',
      isPrivate: suppliedUser?.isPrivate ?? false,
      groupPrivacy: suppliedUser?.groupPrivacy,
      followStatus: suppliedUser?.followStatus as any,
      isFollowing: suppliedUser?.isFollowing,
      stats: {
        followers: suppliedStats?.followers ?? 0,
        following: suppliedStats?.following ?? 0,
        posts: suppliedStats?.posts ?? 0,
        responses: analytics?.totalResponses ?? suppliedStats?.responses ?? 0
      }
    } as UserProfile;
  }, [isMe, user, userProfile, analytics, resolvedTargetUser, suppliedUser]);

  const mySurveys = surveys;

  const canViewPrivateProfileContent = useMemo(() => {
    if (isMe) return true;
    if (!profileUser?.isPrivate) return true;
    return isFollowing || followStatus === 'ACTIVE';
  }, [isMe, profileUser?.isPrivate, isFollowing, followStatus]);

  const renderPrivateProfileState = () => (
    <div className="flex flex-col items-center justify-center py-20 px-8 text-center text-gray-400">
      <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mb-6 text-gray-300">
        <Lock size={40} />
      </div>
      <h3 className="text-xl font-black text-gray-900 mb-2">{t('Private Account')}</h3>
      <p className="text-gray-500 text-sm">{t('Follow this account to see their activity and posts.')}</p>
    </div>
  );

  useEffect(() => {
    if (showProfileAnalysis && !canViewPrivateProfileContent) {
      setShowProfileAnalysis(false);
    }
  }, [showProfileAnalysis, canViewPrivateProfileContent]);

  const responsesCount = useMemo(() => {
    return profileUser?.stats?.responses || 0;
  }, [profileUser?.stats?.responses]);

  const renderStatValue = (value: number | undefined, compact = false) => {
    if (!hasProfileStats) {
      return <span className="block w-8 h-4 rounded-full bg-gray-100 animate-pulse" />;
    }

    const safeValue = value || 0;
    return compact && safeValue >= 1000 ? (safeValue / 1000).toFixed(1) + 'K' : safeValue.toLocaleString();
  };

  const filteredConnections = useMemo(() => {
    return connectionList.filter(c =>
      c.name.toLowerCase().includes(statSearch.toLowerCase()) ||
      c.handle.toLowerCase().includes(statSearch.toLowerCase())
    );
  }, [statSearch, connectionList]);

  const filteredPosts = useMemo(() => {
    let list = mySurveys.filter(s => !s.isDraft && !s.sharedFrom);
    if (postFilter !== 'All') {
      list = list.filter(s => s.type === postFilter);
    }
    return list.filter(s => s.title.toLowerCase().includes(statSearch.toLowerCase()));
  }, [mySurveys, postFilter, statSearch]);

  const getPostEmptyState = () => {
    const hasSearch = statSearch.trim().length > 0;
    const pluralLabels: Record<string, string> = {
      All: 'posts',
      [SurveyType.POLL]: 'polls',
      [SurveyType.SURVEY]: 'surveys',
      [SurveyType.QUIZ]: 'quizzes',
      [SurveyType.CHALLENGE]: 'challenges'
    };
    const singularLabels: Record<string, string> = {
      [SurveyType.POLL]: 'poll',
      [SurveyType.SURVEY]: 'survey',
      [SurveyType.QUIZ]: 'quiz',
      [SurveyType.CHALLENGE]: 'challenge'
    };
    const contentName = t(pluralLabels[postFilter] || 'posts');
    const singularName = t(singularLabels[postFilter] || 'post');
    const Icon = postFilter === SurveyType.POLL
      ? PieChart
      : postFilter === SurveyType.QUIZ || postFilter === SurveyType.CHALLENGE
        ? Zap
        : postFilter === SurveyType.SURVEY
          ? FileText
          : Grid;

    if (hasSearch) {
      return {
        Icon,
        title: t('No matching posts'),
        description: t('Try a different search term.')
      };
    }

    if (isMe) {
      return {
        Icon,
        title: postFilter === 'All' ? t('No posts yet') : t(`No ${contentName} yet`),
        description: postFilter === 'All'
          ? t('Create your first post to start collecting responses.')
          : t(`Create your first ${singularName} to start collecting responses.`)
      };
    }

    return {
      Icon,
      title: postFilter === 'All' ? t('No posts yet') : t(`No ${contentName} yet`),
      description: postFilter === 'All'
        ? t(`${profileUser.name} has not published any posts yet.`)
        : t(`${profileUser.name} has not published any ${contentName} yet.`)
    };
  };

  const getConnectionsEmptyState = () => {
    if (statSearch.trim()) {
      return {
        title: t('No matching people'),
        description: t('Try a different search term.')
      };
    }

    if (activeStatSheet === 'followers') {
      return {
        title: t('No followers yet'),
        description: isMe
          ? t('New followers will appear here.')
          : t(`${profileUser.name} does not have followers yet.`)
      };
    }

    return {
      title: t('Not following anyone yet'),
      description: isMe
        ? t('People you follow will appear here.')
        : t(`${profileUser.name} is not following anyone yet.`)
    };
  };

  const renderStatSheetContent = () => {
    if (!canViewPrivateProfileContent) {
      return (
        <div className="flex flex-col items-center justify-center h-[60vh] text-center p-8">
          <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mb-6 text-gray-300">
            <Lock size={40} />
          </div>
          <h3 className="text-xl font-black text-gray-900 mb-2">{t('Private Account')}</h3>
          <p className="text-gray-500 text-sm">{t('Follow this account to see their activity and posts.')}</p>
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
                placeholder={t('Search posts...')}
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
                        <span className="text-blue-600">{(post.participants || 0).toLocaleString()} {t('Responses')}</span>
                      </div>
                    </div>
                    <ChevronRight size={18} className="text-gray-300" />
                  </button>
                ))}
              </div>
            ) : (
              (() => {
                const emptyState = getPostEmptyState();
                const EmptyIcon = emptyState.Icon;
                return (
                  <div className="py-20 px-8 text-center text-gray-400">
                    <div className="w-20 h-20 mx-auto mb-5 rounded-3xl bg-gray-50 border border-gray-100 flex items-center justify-center">
                      <EmptyIcon size={34} className="text-gray-300" strokeWidth={1.75} />
                    </div>
                    <p className="text-sm font-black uppercase tracking-widest text-gray-700">{emptyState.title}</p>
                    <p className="text-xs text-gray-400 mt-2 leading-relaxed max-w-[260px] mx-auto">{emptyState.description}</p>
                  </div>
                );
              })()
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
              placeholder={t('Search connections...')}
              className="w-full bg-gray-100 border-none rounded-2xl pl-11 pr-4 py-3 text-sm focus:ring-2 focus:ring-blue-500/10"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-20 no-scrollbar">
          {isConnectionLoading && connectionList.length === 0 ? (
            <div className="divide-y divide-gray-50">
              {[1, 2, 3, 4].map(item => (
                <div key={item} className="flex items-center justify-between py-4">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-12 h-12 rounded-full bg-gray-100 animate-pulse" />
                    <div className="min-w-0 flex-1">
                      <div className="w-36 h-4 bg-gray-100 rounded-full animate-pulse mb-2" />
                      <div className="w-24 h-3 bg-gray-50 rounded-full animate-pulse" />
                    </div>
                  </div>
                  <div className="w-20 h-8 bg-gray-50 rounded-xl animate-pulse" />
                </div>
              ))}
            </div>
          ) : filteredConnections.length > 0 ? (
            <div className="divide-y divide-gray-50">
              {filteredConnections.map(person => (
                <div key={person.id} className="flex items-center justify-between py-4 group">
                  <div
                    className="flex items-center gap-3 flex-1 min-w-0"
                    onClick={() => {
                      setActiveStatSheet(null);
                      if (onAuthorClick) onAuthorClick({ id: person.id, name: person.name, avatar: person.avatar, handle: person.handle });
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
                      {person.isFollowing ? t('Unfollow') : (activeStatSheet === 'followers' ? t('Follow Back') : t('Follow'))}
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            (() => {
              const emptyState = getConnectionsEmptyState();
              return (
                <div className="py-20 px-8 text-center text-gray-400">
                  <div className="w-20 h-20 mx-auto mb-5 rounded-full bg-gray-50 border border-gray-100 flex items-center justify-center">
                    <Users size={34} className="text-gray-300" strokeWidth={1.75} />
                  </div>
                  <p className="text-sm font-black uppercase tracking-widest text-gray-700">{emptyState.title}</p>
                  <p className="text-xs text-gray-400 mt-2 leading-relaxed max-w-[260px] mx-auto">{emptyState.description}</p>
                </div>
              );
            })()
          )}
        </div>
      </div>
    );
  };

  const tabs = useMemo(() => {
    const baseTabs = [
      { id: 'content', label: t('Posts') },
      { id: 'reposts', label: t('Reposts') }
    ];

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
      baseTabs.push({ id: 'groups', label: t('Groups') });
    }

    if (isMe) {
      baseTabs.push({ id: 'drafts', label: t('Drafts') });
      baseTabs.push({ id: 'saved', label: t('Saved') });
    }
    return baseTabs;
  }, [isMe, profileUser?.groupPrivacy, targetUser?.groupPrivacy, isFollowing, t]);

  const renderTabContent = () => {
    switch (activeTab as any) {
      case 'content':
        if (!canViewPrivateProfileContent) {
          return renderPrivateProfileState();
        }

        const publishedPosts = mySurveys.filter(s => !s.isDraft && !s.sharedFrom);
        return publishedPosts.length > 0 ? (
          <div className="space-y-1 animate-in fade-in duration-300">
            {publishedPosts.map(survey => (
              <SurveyCard
                key={survey.clientKey || survey.id}
                survey={survey}
                userProfile={userProfile}
                onContentClick={() => onSurveyClick(survey.id, 'PROFILE')}
                onAnalysisClick={() => onSurveyClick(survey.id, 'PROFILE', 'analysis')}
                onVote={onVote}
                onSurveyProgress={onSurveyProgress}
                onAuthorClick={onAuthorClick}
                onShareToFeed={onShareToFeed}
                onUpdateDemographics={onUpdateDemographics}
                contextGroups={contextGroups?.length ? contextGroups : userGroups}
                onGroupClick={onGroupClick}
                sourceSurface="PROFILE"
                onLike={onLike}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 px-8 text-center text-gray-400">
            <FileText size={48} className="opacity-10 mb-4" />
            <p className="text-sm font-bold uppercase tracking-widest">{t('No posts yet')}</p>
          </div>
        );

      case 'drafts':
        const draftPosts = drafts;
        return draftPosts.length > 0 ? (
          <div className="p-4 grid grid-cols-1 gap-4 animate-in fade-in duration-300">
            {draftPosts.map(survey => (
              <button
                key={survey.clientKey || survey.id}
                onClick={() => onEditDraft?.(survey)}
                className="w-full flex items-center gap-4 p-4 rounded-3xl bg-white border border-gray-100 hover:border-blue-200 transition-all text-left shadow-sm active:scale-[0.98]"
              >
                <div className="w-12 h-12 rounded-2xl bg-orange-50 text-orange-600 flex items-center justify-center shrink-0">
                  <PenTool size={24} />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-gray-900 text-sm truncate">{survey.title || t('Untitled Draft')}</h4>
                  <div className="flex items-center gap-2 mt-1 text-[9px] font-black uppercase tracking-widest text-gray-400">
                    <span>{survey.type}</span>
                    <span>•</span>
                    <span>{t('Last edited')} {new Date(survey.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[8px] font-black text-orange-500 uppercase bg-orange-50 px-2 py-1 rounded-lg">{t('Draft')}</span>
                  <ChevronRight size={18} className="text-gray-300" />
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 px-8 text-center text-gray-400">
            <PenTool size={48} className="opacity-10 mb-4" />
            <p className="text-sm font-bold uppercase tracking-widest">{t('No drafts saved')}</p>
          </div>
        );

      case 'saved':
        return savedPosts.length > 0 ? (
          <div className="space-y-1 animate-in fade-in duration-300">
            {savedPosts.map(survey => (
              <SurveyCard
                key={survey.clientKey || survey.id}
                survey={survey}
                userProfile={userProfile}
                onContentClick={() => onSurveyClick(survey.id, 'SAVED')}
                onAnalysisClick={() => onSurveyClick(survey.id, 'SAVED', 'analysis')}
                onVote={onVote}
                onSurveyProgress={onSurveyProgress}
                onAuthorClick={onAuthorClick}
                onShareToFeed={onShareToFeed}
                contextGroups={contextGroups?.length ? contextGroups : userGroups}
                onGroupClick={onGroupClick}
                onUpdateDemographics={onUpdateDemographics}
                sourceSurface="SAVED"
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 px-8 text-center text-gray-400">
            <Bookmark size={48} className="opacity-10 mb-4" />
            <p className="text-sm font-bold uppercase tracking-widest">{t('No saved Posts')}</p>
          </div>
        );

      case 'reposts':
        if (!canViewPrivateProfileContent) {
          return renderPrivateProfileState();
        }

        const reposts = mySurveys.filter(s => !s.isDraft && s.sharedFrom);
        return reposts.length > 0 ? (
          <div className="space-y-1 animate-in fade-in duration-300">
            {reposts.map(survey => (
              <SurveyCard
                key={survey.clientKey || survey.id}
                survey={survey}
                userProfile={userProfile}
                onContentClick={() => onSurveyClick(survey.id, 'PROFILE')}
                onAnalysisClick={() => onSurveyClick(survey.id, 'PROFILE', 'analysis')}
                onVote={onVote}
                onSurveyProgress={onSurveyProgress}
                onAuthorClick={onAuthorClick}
                onShareToFeed={onShareToFeed}
                onUpdateDemographics={onUpdateDemographics}
                contextGroups={contextGroups?.length ? contextGroups : userGroups}
                onGroupClick={onGroupClick}
                sourceSurface="PROFILE"
                onLike={onLike}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 px-8 text-center text-gray-400">
            <Repeat size={48} className="opacity-10 mb-4" />
            <p className="text-sm font-bold uppercase tracking-widest">{t('No reposts yet')}</p>
          </div>
        );

      case 'groups':
        if (isGroupsLoading && displayedGroups.length === 0) {
          return (
            <div className="p-4 grid grid-cols-1 gap-3 animate-in fade-in duration-200">
              {[1, 2, 3].map(item => (
                <div key={item} className="w-full flex items-center gap-4 p-4 rounded-3xl bg-white border border-gray-100 shadow-sm">
                  <div className="w-14 h-14 rounded-2xl bg-gray-100 animate-pulse" />
                  <div className="flex-1 min-w-0">
                    <div className="w-36 h-4 bg-gray-200 rounded-full animate-pulse mb-3" />
                    <div className="w-28 h-3 bg-gray-100 rounded-full animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          );
        }

        if (groupsError) {
          return (
            <div className="flex flex-col items-center justify-center py-20 px-8 text-center text-gray-400">
              <Building2 size={48} className="opacity-10 mb-4" />
              <p className="text-sm font-bold uppercase tracking-widest">{t('Unable to load groups')}</p>
            </div>
          );
        }

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
                    <span className="text-blue-600">{(group.memberCount || 0).toLocaleString()} {t('MEMBERS')}</span>
                  </div>
                </div>
                <ChevronRight size={18} className="text-gray-300" />
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 px-8 text-center text-gray-400">
            <Building2 size={48} className="opacity-10 mb-4" />
            <p className="text-sm font-bold uppercase tracking-widest">{t('No groups yet')}</p>
          </div>
        );

      default:
        return null;
    }
  };

  if (showProfileAnalysis && canViewPrivateProfileContent) {
    return <ProfileAnalysis userProfile={profileUser} onBack={() => setShowProfileAnalysis(false)} />;
  }

  if (isLoading) {
    return (
      <div className="bg-white flex-1 overflow-y-auto min-h-full flex flex-col no-scrollbar">
        <div className={`flex items-center px-4 h-[60px] sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-gray-50 ${onBack ? 'justify-between' : 'justify-end'}`}>
          {onBack && (
            <button onClick={onBack} className="p-2 -ml-2 text-gray-600 hover:bg-gray-50 rounded-full transition-colors">
              <ArrowLeft size={24} />
            </button>
          )}
          <button className="p-2 text-gray-400 hover:bg-gray-50 rounded-full transition-colors">
            <MoreHorizontal size={22} />
          </button>
        </div>
        <div className="relative bg-white pb-6 px-6 flex flex-col items-center pt-2">
          <div className="w-28 h-28 rounded-[2.5rem] bg-gray-100 animate-pulse mb-6 border-4 border-white shadow-xl"></div>
          <div className="w-40 h-8 bg-gray-100 animate-pulse rounded-full mb-2"></div>
          <div className="w-24 h-4 bg-gray-100 animate-pulse rounded-full mb-6"></div>
          <div className="w-full max-w-sm h-12 bg-gray-50 animate-pulse rounded-2xl mb-8"></div>
          <div className="w-full bg-white rounded-[2.5rem] border border-gray-100 shadow-xl shadow-gray-200/40 px-3 py-6 h-[100px] animate-pulse"></div>
        </div>
      </div>
    );
  }

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const scrollBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    // Trigger load more 500px before reaching the bottom
    if (scrollBottom < 500 && onLoadMore && hasNextPage && !isLoadingMore) {
      onLoadMore();
    }
  };

  return (
    <div onScroll={handleScroll} className="bg-white flex-1 overflow-y-auto min-h-full flex flex-col no-scrollbar">
      <div className={`flex items-center px-4 h-[60px] sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-gray-50 ${onBack ? 'justify-between' : 'justify-end'}`}>
        {onBack && (
          <button onClick={onBack} className="p-2 -ml-2 text-gray-600 hover:bg-gray-50 rounded-full transition-colors">
            <ArrowLeft size={24} />
          </button>
        )}
        <button
          onClick={isMe ? onSettingsClick : undefined}
          className="p-3 -mr-2 text-gray-600 hover:bg-gray-50 rounded-full transition-colors relative z-20"
          aria-label="Settings"
        >
          {isMe ? <Settings size={24} /> : <MoreHorizontal size={24} />}
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
                className="absolute -bottom-2 -right-2 p-3 bg-blue-600 text-white rounded-2xl shadow-lg hover:bg-blue-700 transition-colors border-[3px] border-white active:scale-90 z-20"
                aria-label="Edit Profile"
              >
                <Edit3 size={18} />
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
                className={`flex-1 py-4 rounded-2xl font-black uppercase tracking-widest text-[11px] transition-all active:scale-95 shadow-xl ${
                  followStatus === 'PENDING'
                    ? 'bg-gray-50 text-gray-400 border border-gray-200'
                    : isFollowing
                      ? 'bg-gray-100 text-gray-600 shadow-gray-200/50'
                      : 'bg-blue-600 text-white shadow-blue-500/20'
                  } ${isFollowLoading ? 'opacity-50' : ''}`}
              >
                {followStatus === 'PENDING' ? t('Requested') : isFollowing ? t('Following') : t('Follow')}
              </button>
            </div>
          )}

          <div className="w-full bg-white rounded-[2.5rem] border border-gray-100 shadow-xl shadow-gray-200/40 px-3 py-6 mb-4">
            <div className="grid grid-cols-4 gap-0 divide-x divide-gray-50">
              <button
                disabled={!hasProfileStats}
                onClick={() => { if (hasProfileStats) { setStatSearch(''); setActiveStatSheet('following'); } }}
                className={`flex flex-col items-center group active:scale-95 transition-transform ${!hasProfileStats ? 'cursor-wait' : ''}`}
              >
                <div className="p-2 rounded-xl bg-blue-50 text-blue-600 mb-2 transition-colors">
                  <UserPlus size={16} strokeWidth={2.5} />
                </div>
                <div className="text-sm font-black text-gray-900 tabular-nums h-5 flex items-center justify-center">
                  {renderStatValue(profileUser?.stats?.following)}
                </div>
                <div className="text-[8px] font-black text-gray-400 uppercase tracking-tighter mt-1">{t('Following')}</div>
              </button>

              <button
                disabled={!hasProfileStats}
                onClick={() => { if (hasProfileStats) { setStatSearch(''); setActiveStatSheet('followers'); } }}
                className={`flex flex-col items-center group active:scale-95 transition-transform ${!hasProfileStats ? 'cursor-wait' : ''}`}
              >
                <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600 mb-2 transition-colors">
                  <Users size={16} strokeWidth={2.5} />
                </div>
                <div className="text-sm font-black text-gray-900 tabular-nums h-5 flex items-center justify-center">
                  {renderStatValue(profileUser?.stats?.followers)}
                </div>
                <div className="text-[8px] font-black text-gray-400 uppercase tracking-tighter mt-1">{t('Followers')}</div>
              </button>

              <button
                disabled={!hasProfileStats || !canViewPrivateProfileContent}
                onClick={() => { if (hasProfileStats && canViewPrivateProfileContent) { setStatSearch(''); setPostFilter('All'); setActiveStatSheet('posts'); } }}
                className={`flex flex-col items-center group active:scale-95 transition-transform ${!canViewPrivateProfileContent ? 'opacity-30 grayscale cursor-not-allowed' : !hasProfileStats ? 'cursor-wait' : ''}`}
              >
                <div className="p-2 rounded-xl bg-orange-50 text-orange-600 mb-2 transition-colors relative">
                  <FileText size={16} strokeWidth={2.5} />
                  {!canViewPrivateProfileContent && <Lock size={8} className="absolute top-1 right-1" />}
                </div>
                <div className="text-sm font-black text-gray-900 tabular-nums h-5 flex items-center justify-center">
                  {renderStatValue(profileUser?.stats?.posts)}
                </div>
                <div className="text-[8px] font-black text-gray-400 uppercase tracking-tighter mt-1">{t('Posts')}</div>
              </button>

              <button
                disabled={!hasProfileStats || !canViewPrivateProfileContent}
                onClick={() => { if (hasProfileStats && canViewPrivateProfileContent) setShowProfileAnalysis(true); }}
                className={`flex flex-col items-center group active:scale-95 transition-transform ${!canViewPrivateProfileContent ? 'opacity-30 grayscale cursor-not-allowed' : !hasProfileStats ? 'cursor-wait' : ''}`}
              >
                <div className="p-2 rounded-xl bg-green-50 text-green-600 mb-2 transition-colors relative">
                  <TrendingUp size={16} strokeWidth={2.5} />
                  {!canViewPrivateProfileContent && <Lock size={8} className="absolute top-1 right-1" />}
                </div>
                <div className="text-sm font-black text-gray-900 tabular-nums h-5 flex items-center justify-center">
                  {renderStatValue(responsesCount, true)}
                </div>
                <div className="text-[8px] font-black text-gray-400 uppercase tracking-tighter mt-1">{t('Responses')}</div>
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
          {canViewPrivateProfileContent && (activeTab === 'content' || activeTab === 'reposts') && (
            <div className="py-8 flex flex-col items-center justify-center min-h-[120px] transition-all">
              {isLoadingMore ? (
                <div className="flex flex-col items-center animate-pulse opacity-50">
                  <Activity size={32} className="text-gray-400 mb-3 animate-spin-slow" />
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{t('Loading More...')}</p>
                </div>
              ) : !hasNextPage && (mySurveys.length > 0) ? (
                <div className="flex flex-col items-center opacity-20">
                  <Activity size={32} className="text-gray-400 mb-3" />
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{t("You've reached the end")}</p>
                </div>
              ) : null}
            </div>
          )}
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
              `Posts (${mySurveys.filter(s => !s.isDraft && !s.sharedFrom).length})`
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
