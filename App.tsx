
import React, { useState, useRef, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api } from './services/api';
import { Header } from './components/Header';
import { BottomNav } from './components/BottomNav';
import { SurveyCard } from './components/SurveyCard';
import { HomeScreen } from './components/HomeScreen';
import { CreateSurveyModal } from './components/CreateSurveyModal';
import { CreatePollScreen } from './components/CreatePollScreen';
import { CreateQuizModal } from './components/CreateQuizModal';
import { CreateChallengeScreen } from './components/CreateChallengeScreen';
import { CreateAccountModal } from './components/CreateAccountModal';
import { GroupSettingsScreen } from './components/GroupSettingsScreen';
import { ProfileSettingsScreen } from './components/ProfileSettingsScreen';
import { PullToRefresh, PullToRefreshHandle } from './components/PullToRefresh';
import { SearchScreen } from './components/SearchScreen';
import { ProfileScreen } from './components/ProfileScreen';
import { NotificationsScreen } from './components/NotificationsScreen';
import { TrendsScreen } from './components/TrendsScreen';
import { MessagesScreen } from './components/MessagesScreen';
import { GroupScreen } from './components/GroupScreen';
import { PostAnalysis } from './components/PostAnalysis';
import { AuthScreen } from './components/AuthScreen';
import { UsersTableScreen } from './components/UsersTableScreen';
import { PrivacyPolicyScreen } from './components/PrivacyPolicyScreen';
import { Survey, Option, Notification, SurveyType, Group, UserProfile } from './types';
import {
  BarChart3, PieChart, Activity, ArrowLeft, Users, MessageCircle,
  Share2, MoreVertical, Globe, ShieldCheck, ChevronRight, BarChart,
  TrendingUp, FileText, Settings, HelpCircle, PlusCircle, PenLine, Zap, X
} from 'lucide-react';
import { SocketProvider } from './components/SocketContext';

const INITIAL_USER: UserProfile = {
  name: 'User Profile',
  handle: 'user',
  avatar: '',
  bio: '',
  location: '',
  website: '',
  email: '',
  phone: '',
  language: 'English (US)',
  stats: {
    followers: 0,
    following: 0,
    responses: 0
  }
};

const App: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const [activeTab, setActiveTab] = useState<'home' | 'search' | 'add' | 'trends' | 'profile' | 'notifications' | 'messages'>('home');
  const [prevTab, setPrevTab] = useState<'home' | 'search' | 'add' | 'trends' | 'profile' | 'notifications'>('home');

  // User Profile State
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalType, setAuthModalType] = useState<'flow' | 'login'>('flow');

  const handleCloseAuth = () => {
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1);
    } else {
      navigate('/', { replace: true });
    }
    setAuthModalOpen(false);
  };

  const handleCloseModal = () => {
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1);
    } else {
      navigate('/', { replace: true });
    }
    setActiveCreationFlow(null);
    setActiveCreationGroupId(null);
    setAccountModalType(null);
  };

  const getGuestId = () => localStorage.getItem('guest_id') || '';
  const fetchInitialData = (uid?: string) => fetchData(uid, userProfile || undefined);

  const handleAuthSuccess = (user: any) => {
    localStorage.setItem('si_user', JSON.stringify(user));
    setUserProfile(user);
    setIsAuthenticated(true);
    setAuthModalOpen(false);
    
    // Initialize Push Notifications if permission granted
    api.setupPushNotifications().catch(console.error);

    if (lastFetchedUserIdRef.current !== user.id) {
      lastFetchedUserIdRef.current = user.id;
      fetchData(user.id, user);
    }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setUserProfile(null);
    setSurveys([]);
    setActiveTab('home');
    lastFetchedUserIdRef.current = null;
    localStorage.removeItem('si_user');
    localStorage.removeItem('si_token');
    localStorage.removeItem('si_feed_cache');
    fetchData(); // Immediately fetch anonymous feed
  };

  // Creation Flow State
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [activeCreationFlow, setActiveCreationFlow] = useState<'survey' | 'poll' | 'quiz' | 'challenge' | null>(null);
  const [activeCreationGroupId, setActiveCreationGroupId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<Survey | null>(null);
  const [accountModalType, setAccountModalType] = useState<'group' | 'company' | null>(null);



  const normalizeSurvey = (raw: Partial<Survey>, currentUser?: UserProfile | null): Survey => ({
    ...raw,
    id: raw.id || `temp-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    title: raw.title || '',
    description: raw.description || '',
    type: raw.type || SurveyType.POLL,
    status: raw.status || (raw.isDraft ? 'DRAFT' : 'PUBLISHED'),
    options: raw.options || [],
    participants: raw.participants || 0,
    isTrending: raw.isTrending || false,
    likes: raw.likes || 0,
    isLiked: raw.isLiked || false,
    commentsCount: raw.commentsCount || 0,
    sections: raw.sections || [],
    author: raw.author?.id ? {
      id: raw.author.id,
      name: raw.author.name || 'Unknown',
      avatar: raw.author.avatar || '',
      type: raw.author.type || 'Personal',
      isFollowing: raw.author.isFollowing || false
    } : currentUser?.id ? {
      id: currentUser.id,
      name: currentUser.name || 'Unknown',
      avatar: currentUser.avatar || '',
      type: 'Personal',
      isFollowing: false
    } : {
      id: 'unknown',
      name: 'Unknown',
      avatar: '',
      type: 'Personal',
      isFollowing: false
    },
    userProgress: raw.userProgress || {
      currentQuestionIndex: 0,
      answers: {},
      followUpAnswers: {},
      historyStack: [],
      isAnonymous: false
    }
  });

  const [surveys, setSurveys] = useState<Survey[]>(() => {
    try {
      const cached = localStorage.getItem('si_feed_cache');
      if (cached) {
        const savedUser = localStorage.getItem('si_user');
        const user = savedUser ? JSON.parse(savedUser) : null;
        return JSON.parse(cached).map((s: any) => normalizeSurvey(s, user));
      }
    } catch (e) {
      console.error("Failed to parse initial feed cache", e);
    }
    return [];
  });
  const [isFeedLoading, setIsFeedLoading] = useState<boolean>(() => {
    try {
      return !localStorage.getItem('si_feed_cache');
    } catch(e) {
      return true;
    }
  });
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const [userGroups, setUserGroups] = useState<Group[]>([]);

  const fetchData = async (currentUserId?: string, currentUser?: UserProfile | null, retries = 5) => {
    try {
      if (surveys.length === 0) setIsFeedLoading(true);
      const res = await api.getSurveys(currentUserId);
      const surveysData = res.data;
      
      try {
        localStorage.setItem('si_feed_cache', JSON.stringify(surveysData.slice(0, 10)));
      } catch (storageError) {
        console.warn('Failed to cache feed to localStorage due to quota limits');
      }
      
      setSurveys(surveysData.map((s: any) => normalizeSurvey(s, currentUser)));
      setNextCursor(res.nextCursor);

      if (currentUserId) {
        const groupsData = await api.getUserGroups(currentUserId);
        setUserGroups(groupsData);
      }
      setIsFeedLoading(false);
    } catch (error) {
      console.error("Failed to load initial data", error);
      if (retries > 0) {
        // Cold start auto-retry
        setTimeout(() => fetchData(currentUserId, currentUser, retries - 1), 3000);
      } else {
        setSurveys([]);
        setIsFeedLoading(false);
      }
    }
  };

  const fetchMore = async () => {
    if (isLoadingMore || !nextCursor) return;
    setIsLoadingMore(true);
    try {
      const currentUserId = userProfile?.id || undefined;
      const res = await api.getSurveys(currentUserId, nextCursor);
      const newSurveys = res.data.map((s: any) => normalizeSurvey(s, userProfile));
      
      setSurveys(prev => [...prev, ...newSurveys]);
      setNextCursor(res.nextCursor);
    } catch (error) {
      console.error("Failed to load more data", error);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const lastFetchedUserIdRef = useRef<string | null>(null);

  React.useEffect(() => {
    const savedUser = localStorage.getItem('si_user');
    if (savedUser) {
      const user = JSON.parse(savedUser);
      setUserProfile(user);
      setIsAuthenticated(true);

      // Fetch fresh user profile to get latest stats
      api.getUser(user.id).then(freshUser => {
        setUserProfile(freshUser);
        localStorage.setItem('si_user', JSON.stringify(freshUser));
      }).catch(err => {
        console.error("Failed to refresh user profile, invalidating session", err);
        localStorage.removeItem('si_user');
        setIsAuthenticated(false);
        setUserProfile(null);
        setSurveys([]); // Clear private feed
        fetchData(); // Load public feed
      });
    } else {
      // Guest mode fetch
      fetchData();
    }

    const handleAuthExpired = () => {
      setIsAuthenticated(false);
      setUserProfile(null);
      setSurveys([]); // Clear private feed
      fetchData(); // Refetch as guest
    };

    window.addEventListener('auth_expired', handleAuthExpired);
    return () => window.removeEventListener('auth_expired', handleAuthExpired);
  }, []);

  React.useEffect(() => {
    if (isAuthenticated && userProfile?.id) {
      if (lastFetchedUserIdRef.current === userProfile.id) return;
      lastFetchedUserIdRef.current = userProfile.id;
      fetchData(userProfile.id, userProfile);
    }
  }, [isAuthenticated, userProfile?.id]);



  const [isNavVisible, setIsNavVisible] = useState(true);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  React.useEffect(() => {
    if (isAuthenticated && userProfile?.id) {
      api.getNotifications(userProfile.id)
        .then(data => {
          console.log("Fetched notifications:", data);
          setNotifications(data);
        })
        .catch(err => console.error("Failed to fetch notifications:", err));
    }
  }, [isAuthenticated, userProfile?.id]);

  const [selectedSurveyId, setSelectedSurveyId] = useState<string | null>(null);
  const [selectedSurveySurface, setSelectedSurveySurface] = useState<'FEED' | 'PROFILE' | 'SAVED' | 'SEARCH' | 'DEEP_LINK'>('FEED');
  const [detailTab, setDetailTab] = useState<'post' | 'analysis'>('post');

  const [selectedProfile, setSelectedProfile] = useState<{ id: string; name: string; avatar: string; handle?: string } | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [externalGroup, setExternalGroup] = useState<Group | null>(null);
  const [isGroupSettingsOpen, setIsGroupSettingsOpen] = useState(false);
  const [isProfileSettingsOpen, setIsProfileSettingsOpen] = useState(false);
  const [showUsersTable, setShowUsersTable] = useState(false);
  const [isPrivacyScreenOpen, setIsPrivacyScreenOpen] = useState(false);

  React.useEffect(() => {
    if (selectedProfile?.id) {
      const currentUserId = userProfile?.id || undefined;
      api.getSurveys(currentUserId, undefined, 10, selectedProfile.id).then(res => {
        const newSurveys = res.data.map((s: any) => normalizeSurvey(s, userProfile));
        setSurveys(prev => {
          const map = new Map(prev.map(s => [s.id, s]));
          newSurveys.forEach(s => map.set(s.id, s));
          return Array.from(map.values());
        });
      }).catch(console.error);
    }
  }, [selectedProfile?.id]);

  React.useEffect(() => {
    (window as any).showUsersTable = () => setShowUsersTable(true);
  }, []);

  React.useEffect(() => {
    const path = location.pathname;
    
    // Helper to reset states when not on their paths
    if (!path.startsWith('/post/')) setSelectedSurveyId(null);
    if (!path.startsWith('/profile/') && !path.startsWith('/@') && path !== '/profile') setSelectedProfile(null);
    if (!path.startsWith('/group/')) setSelectedGroupId(null);
    if (!path.startsWith('/settings/profile')) setIsProfileSettingsOpen(false);
    if (!path.startsWith('/group/') || !path.endsWith('/settings')) setIsGroupSettingsOpen(false);
    if (path !== '/privacy') setIsPrivacyScreenOpen(false);

    if (path === '/' || path === '') setActiveTab('home');
    else if (path === '/privacy') setIsPrivacyScreenOpen(true);
    else if (path === '/search') setActiveTab('search');
    else if (path === '/trends') setActiveTab('trends');
    else if (path === '/notifications') setActiveTab('notifications');
    else if (path === '/messages') setActiveTab('messages');
    else if (path === '/profile') setActiveTab('profile');
    else if (path.startsWith('/settings/profile')) {
       setActiveTab('profile');
       setIsProfileSettingsOpen(true);
    }
    else if (path.startsWith('/@')) {
       setActiveTab('profile');
       const handle = path.split('/@')[1];
       if (handle && handle !== selectedProfile?.handle) {
          api.getUserByHandle(handle).then(user => {
              setSelectedProfile(user);
          }).catch(err => {
              console.error(err);
              navigate('/'); // fallback
          });
       }
    }
    else if (path.startsWith('/profile/')) {
       setActiveTab('profile');
       const id = path.split('/profile/')[1];
       if (id && id !== selectedProfile?.id) {
          api.getUser(id).then(user => {
              if (user.handle) navigate(`/@${user.handle}`, { replace: true });
              else setSelectedProfile(user);
          }).catch(console.error);
       }
    }
    else if (path.startsWith('/group/')) {
       const id = path.split('/group/')[1]?.split('/')[0]; // handle /group/id/settings
       if (id && id !== selectedGroupId) setSelectedGroupId(id);
       if (path.endsWith('/settings')) setIsGroupSettingsOpen(true);
    }
    else if (path.startsWith('/post/')) {
       const id = path.split('/post/')[1];
       if (id && id !== selectedSurveyId) setSelectedSurveyId(id);
    }

    // Auth Routes
    if (path === '/login') {
       setAuthModalType('login');
       setAuthModalOpen(true);
    } else if (path === '/signup') {
       setAuthModalType('flow');
       setAuthModalOpen(true);
    } else {
       if (authModalOpen && !['/login', '/signup'].includes(path)) setAuthModalOpen(false);
    }

    // Create Routes
    if (path.startsWith('/create/')) {
       const type = path.split('/create/')[1];
       if (['poll', 'survey', 'quiz', 'challenge'].includes(type)) {
           setIsAddMenuOpen(false);
           setAccountModalType(null);
           setActiveCreationFlow(type as any);
       } else if (type === 'group') {
           setIsAddMenuOpen(false);
           setActiveCreationFlow(null);
           setAccountModalType('group');
       } else if (type === 'business') {
           setIsAddMenuOpen(false);
           setActiveCreationFlow(null);
           setAccountModalType('company');
       }
    } else {
       if (activeCreationFlow && !path.startsWith('/create/')) setActiveCreationFlow(null);
       if (accountModalType && !path.startsWith('/create/')) setAccountModalType(null);
    }
  }, [location.pathname]);

  React.useEffect(() => {
    if (selectedGroupId && !userGroups.find(g => g.id === selectedGroupId)) {
      api.getGroupById(selectedGroupId).then(setExternalGroup).catch(console.error);
    } else {
      setExternalGroup(null);
    }
  }, [selectedGroupId, userGroups]);

  const pullToRefreshRef = useRef<PullToRefreshHandle>(null);

  const handleUpdateDemographics = async (newDemographics: Partial<NonNullable<UserProfile['demographics']>>) => {
    if (!userProfile?.id) return;

    // 1. Optimistic Update
    const updatedProfile = {
      ...userProfile,
      demographics: {
        ...(userProfile.demographics || {}),
        ...newDemographics
      }
    };
    setUserProfile(updatedProfile);
    localStorage.setItem('si_user', JSON.stringify(updatedProfile));

    // 2. Server Update
    try {
      await api.updateUser(userProfile.id, { demographics: updatedProfile.demographics });
    } catch (error) {
      console.error("Failed to update demographics on server:", error);
    }
  };

  const handleFollowChange = (targetUserId: string, isFollowing: boolean) => {
    setSurveys(prev => prev.map(s => {
      if (s.author.id === targetUserId) {
        return { ...s, author: { ...s.author, isFollowing } };
      }
      return s;
    }));

    // Refetch data to get suddenly accessible 'Followers Only' posts
    if (userProfile?.id) {
        fetchData(userProfile.id, userProfile);
    }
  };

  React.useEffect(() => {
    const handleGlobalFollowSync = (e: Event) => {
      const customEvent = e as CustomEvent<any>;
      const { targetUserId, isFollowing } = customEvent.detail;
      handleFollowChange(targetUserId, isFollowing);
    };

    window.addEventListener('onFollowStateChange', handleGlobalFollowSync);
    return () => window.removeEventListener('onFollowStateChange', handleGlobalFollowSync);
  }, [selectedProfile]);

  const handleCreateSubmit = async (newSurveyData: Partial<Survey>) => {
    console.log("handleCreateSubmit called with data:", newSurveyData);

    if (!userProfile || !userProfile.id) {
      console.error("No user profile available");
      alert("Please log in to create a post");
      return;
    }

    // Reset UI state first to prevent white screen
    if (!activeCreationGroupId) {
      setActiveTab('home');
    }
    setActiveCreationFlow(null);
    setActiveCreationGroupId(null);
    setEditingDraft(null);
    setIsNavVisible(true);

    try {
      let resultSurvey: Survey;
      const targetId = newSurveyData.id || (editingDraft ? editingDraft.id : undefined);

      // Determine final status
      const status = newSurveyData.status || (newSurveyData.isDraft ? 'DRAFT' : 'PUBLISHED');
      console.log(`Determined status: ${status}, targetId: ${targetId}`);

      // Optimistic Update only for Published posts
      const tempId = targetId || `temp-${Date.now()}`;
      if (status === 'PUBLISHED') {
        try {
          const optimisticSurvey = normalizeSurvey({
            id: tempId,
            createdAt: new Date().toISOString(),
            ...newSurveyData,
            status: 'PUBLISHED'
          }, userProfile);

          if (!targetId) {
            setSurveys(prev => [optimisticSurvey, ...prev]);
          } else {
            setSurveys(prev => [optimisticSurvey, ...prev.filter(s => s.id !== targetId)]);
          }

          setTimeout(() => {
            pullToRefreshRef.current?.scrollToTop();
          }, 100);
        } catch (optError) {
          console.error("Error with optimistic update:", optError);
          // If optimistic update fails, we will rely on the API response only
        }
      }

      // API Call
      try {
        if (targetId) {
          resultSurvey = await api.updatePost(targetId, {
            groupId: activeCreationGroupId || undefined,
            ...newSurveyData,
            status: status,
            authorId: userProfile.id
          });
        } else {
          resultSurvey = await api.createSurvey({
            groupId: activeCreationGroupId || undefined,
            ...newSurveyData,
            status: status,
            authorId: userProfile.id
          });
        }

        console.log("API Result:", resultSurvey);

        // Replace optimistic entry or update feed
        if (resultSurvey && status === 'PUBLISHED') {
          const normalizedResult = normalizeSurvey(resultSurvey, userProfile);
          setSurveys(prev => prev.map(s => s.id === tempId ? normalizedResult : s));
        } else if (targetId && status === 'DRAFT') {
          setSurveys(prev => prev.filter(s => s.id !== targetId));
        }
      } catch (apiError) {
        // Rollback optimistic update on failure only if it's a new temporary post
        if (!targetId) {
          setSurveys(prev => prev.filter(s => s.id !== tempId));
        }
        throw apiError;
      }
    } catch (error) {
      console.error("Failed to create/publish survey:", error);
      alert("Something went wrong. Please check your connection.");
    }
  };

  const handleShareToFeed = async (originalSurvey: Survey, caption: string) => {
    if (!userProfile) {
      console.error("No user profile available");
      alert("Please log in to share");
      return;
    }

    try {
      // 1. Save to DB
      const resultSurvey = await api.sharePost(originalSurvey.id, userProfile.id, caption);
      
      if (resultSurvey.action === 'unshared') {
          // Remove the repost from the feed if it's there
          setSurveys(prev => prev.filter(s => !(s.sharedFrom?.id === originalSurvey.id && s.author?.id === userProfile.id && !s.sharedCaption)));
          // Decrement original count in state
          setSurveys(prev => prev.map(s => {
              if (s.id === originalSurvey.id) {
                  return { ...s, repostCount: Math.max(0, (s.repostCount || 0) - 1), hasReposted: false };
              }
              return s;
          }));
          return;
      }

      // 2. Normalize with current user perspective
      const normalizedResult = normalizeSurvey(resultSurvey, userProfile);

      // 3. Update UI Feed
      setSurveys(prev => {
          // If it was a clean repost, also update the original post's stats locally
          const updatedFeed = prev.map(s => {
              if (s.id === originalSurvey.id) {
                  return { ...s, repostCount: (s.repostCount || 0) + 1, hasReposted: true };
              }
              return s;
          });
          return [normalizedResult, ...updatedFeed];
      });

      setActiveTab('home');
      setSelectedSurveyId(null);
      setSelectedProfile(null);
      setSelectedGroupId(null);
      setIsGroupSettingsOpen(false);

      setTimeout(() => {
        pullToRefreshRef.current?.scrollToTop();
      }, 100);
    } catch (error) {
      console.error("Failed to share post:", error);
      alert("Failed to share post. Please try again.");
    }
  };


  const handleSaveDraft = async (draftData: Partial<Survey>) => {
    console.log("handleSaveDraft called with data:", draftData);

    if (!userProfile) {
      console.error("No user profile available");
      alert("Please log in to save a draft");
      return;
    }

    try {
      // Ensure status is DRAFT regardless of what's in draftData
      const finalData = {
        ...draftData,
        status: 'DRAFT',
        authorId: userProfile?.id
      };

      if (editingDraft || draftData.id) {
        const id = (editingDraft?.id || draftData.id)!;
        await api.updatePost(id, finalData);
      } else {
        await api.createSurvey(finalData);
      }

      // Explicitly remove from feed surveys if it was being edited from a published one (shouldn't happen but just in case)
      if (editingDraft?.id || draftData.id) {
        const id = editingDraft?.id || draftData.id;
        setSurveys(prev => prev.filter(s => s.id !== id));
      }

      setActiveCreationFlow(null);
      setActiveCreationGroupId(null);
      setEditingDraft(null);
      setIsNavVisible(true);
    } catch (error) {
      console.error("Failed to save draft:", error);
      alert("Failed to save draft. Please check your connection.");
    }
  };

  const handleAddMenuOption = (option: 'survey' | 'poll' | 'quiz' | 'challenge' | 'group' | 'business') => {
    if (!isAuthenticated || !userProfile) {
       navigate('/signup');
       return;
    }
    setIsAddMenuOpen(false);
    setActiveCreationGroupId(null);
    setEditingDraft(null);
    navigate(`/create/${option}`);
  };

  const handleTabChange = async (tab: 'home' | 'search' | 'add' | 'trends' | 'profile' | 'notifications' | 'messages') => {
    if ((tab === 'profile' || tab === 'notifications' || tab === 'add' || tab === 'messages' || tab === 'trends') && (!isAuthenticated || !userProfile)) {
       navigate('/signup');
       return;
    }

    if (tab === 'home' && activeTab === 'home') {
      if (pullToRefreshRef.current) {
        if (!pullToRefreshRef.current.isAtTop()) {
          pullToRefreshRef.current.scrollToTop();
        } else {
          await pullToRefreshRef.current.triggerRefresh();
        }
      }
    } else {
      if (activeTab !== 'messages') setPrevTab(activeTab as any);
      if (tab === 'home') navigate('/');
      else navigate(`/${tab}`);
    }
  };

  const handleSurveyClick = (id: string, surface: any = 'FEED', tab: 'post' | 'analysis' = 'post') => {
    setSelectedSurveySurface(surface);
    setDetailTab(tab);
    setIsNavVisible(false);
    navigate(`/post/${id}`);
  };

  const navigateToProfile = (user: {id: string; name?: string; handle?: string; avatar?: string} | null) => {
    if (user) {
       if (user.handle) navigate(`/@${user.handle}`);
       else navigate(`/profile/${user.id}`);
    }
    else navigate(-1);
  };

  const navigateToGroup = (id: string | null) => {
    if (id) navigate(`/group/${id}`);
    else navigate(-1);
  };

  const handleVote = (
    surveyId: string,
    optionIds: string[],
    isAnonymous?: boolean,
    newOption?: Option
  ) => {
    const previousSurveys = [...surveys];
    setSurveys(prev =>
      prev.map(s => {
        const isDirect = s.id === surveyId;
        const isShared = s.sharedFrom?.id === surveyId;
        
        if (!isDirect && !isShared) return s;

        const applyVote = (target: Survey): Survey => {
          // 1) Completion path (Survey/Quiz) => no option votes, only mark participated + store anon
          if (optionIds.length === 0) {
            return {
              ...target,
              hasParticipated: true,
              participants: target.hasParticipated ? target.participants : target.participants + 1,
              userProgress: {
                currentQuestionIndex: target.userProgress?.currentQuestionIndex || 0,
                answers: target.userProgress?.answers || {},
                followUpAnswers: target.userProgress?.followUpAnswers || {},
                historyStack: target.userProgress?.historyStack || [],
                isAnonymous: !!isAnonymous
              }
            };
          }

          // 2) Poll/Challenge vote path
          let updatedOptions = [...(target.options || [])];

          if (newOption && !updatedOptions.some(o => o.id === newOption.id)) {
            updatedOptions.push({ ...newOption, votes: 0 });
          }

          const newOptions = updatedOptions.map(opt =>
            optionIds.includes(opt.id)
              ? { ...opt, votes: opt.votes + 1 }
              : opt
          );

          return {
            ...target,
            options: newOptions,
            hasParticipated: true,
            userSelectedOptions: optionIds,
            participants: target.hasParticipated ? target.participants : target.participants + 1,
            userProgress: {
              currentQuestionIndex: target.userProgress?.currentQuestionIndex || 0,
              answers: target.userProgress?.answers || {},
              followUpAnswers: target.userProgress?.followUpAnswers || {},
              historyStack: target.userProgress?.historyStack || [],
              isAnonymous: !!isAnonymous
            }
          };
        };

        if (isDirect) {
          return applyVote(s);
        } else {
          return {
            ...s,
            sharedFrom: applyVote(s.sharedFrom!)
          };
        }
      })
    );


    // Server Call with Rollback
    if (optionIds.length > 0) {
      api.vote(surveyId, optionIds, userProfile?.id, isAnonymous)
        .catch(error => {
            console.error("Failed to submit votes to server, rolling back:", error);
            setSurveys(previousSurveys);
        });
    }
  };

  type SurveyProgressPayload = {
    index: number;
    answers: Record<string, any>;
    followUpAnswers?: Record<string, string>;
    historyStack?: number[];
    isAnonymous?: boolean;
  };

  const handleSurveyProgress = (surveyId: string, progress: SurveyProgressPayload) => {
    setSurveys(prev =>
      prev.map(s => {
        const isDirect = s.id === surveyId;
        const isShared = s.sharedFrom?.id === surveyId;
        if (!isDirect && !isShared) return s;

        const applyProgress = (target: any) => ({
          ...target,
          hasParticipated: true,
          userProgress: {
            currentQuestionIndex: progress.index,
            answers: progress.answers,
            followUpAnswers: progress.followUpAnswers || {},
            historyStack: progress.historyStack || [],
            isAnonymous: progress.isAnonymous ?? target.userProgress?.isAnonymous ?? false
          }
        });

        if (isDirect) {
          return applyProgress(s);
        } else {
          return {
            ...s,
            sharedFrom: applyProgress(s.sharedFrom)
          };
        }
      })
    );
  };

  const handleLikePost = (surveyId: string, isLiked: boolean) => {
    const previousSurveys = [...surveys];
    setSurveys(prev => prev.map(s => {
      const isDirect = s.id === surveyId;
      const isShared = s.sharedFrom?.id === surveyId;
      if (!isDirect && !isShared) return s;

      const applyLike = (target: any) => ({
        ...target,
        isLiked,
        likes: isLiked ? (target.likes || 0) + 1 : Math.max(0, (target.likes || 1) - 1)
      });

      if (isDirect) {
        return applyLike(s);
      } else {
        return {
          ...s,
          sharedFrom: applyLike(s.sharedFrom)
        };
      }
    }));

    // Server Call with Rollback
    if (userProfile?.id) {
      api.likeSurvey(surveyId, userProfile.id)
        .catch(error => {
          console.error("Failed to like post, rolling back:", error);
          setSurveys(previousSurveys);
        });
    }
  };

  const getActiveCreationFlow = (type: string): 'survey' | 'poll' | 'quiz' | 'challenge' | null => {
    const t = type.toLowerCase();
    if (t === 'survey' || t === 'poll' || t === 'quiz' || t === 'challenge') return t;
    return null;
  };

  const renderContent = () => {
    const publishedSurveys = surveys.filter(s => s.status === 'PUBLISHED');
    switch (activeTab) {
      case 'home':
        return (
          <HomeScreen
            surveys={surveys}
            userProfile={userProfile}
            isLoading={isFeedLoading}
            onSurveyClick={handleSurveyClick}
            onVote={handleVote}
            onSurveyProgress={handleSurveyProgress}
            onAuthorClick={navigateToProfile}
            onShareToFeed={handleShareToFeed}
            onUpdateDemographics={handleUpdateDemographics}
            onCloseShareSheet={() => {/* no op for simple close */ }}
            contextGroups={userGroups}
            onGroupClick={navigateToGroup}
            onLike={handleLikePost}
            onLoadMore={fetchMore}
            hasNextPage={!!nextCursor}
            isLoadingMore={isLoadingMore}
          />
        );
      case 'search':
        return <SearchScreen surveys={publishedSurveys} onSurveyClick={handleSurveyClick} onAuthorClick={navigateToProfile} />;
      case 'trends':
        return <TrendsScreen surveys={publishedSurveys} onSurveyClick={handleSurveyClick} />;
      case 'profile':
        if (isProfileSettingsOpen) return <ProfileSettingsScreen userProfile={userProfile!} onUpdateProfile={(prof) => { setUserProfile(prof); localStorage.setItem('si_user', JSON.stringify(prof)); }} onBack={() => navigate('/profile')} onLogout={handleLogout} />;
        return <ProfileScreen surveys={surveys} userGroups={userGroups} userProfile={userProfile!} user={selectedProfile || undefined} onSurveyClick={handleSurveyClick} onGroupClick={navigateToGroup} onVote={handleVote} onAuthorClick={navigateToProfile} onSurveyProgress={handleSurveyProgress} onShareToFeed={handleShareToFeed} onSettingsClick={() => navigate('/settings/profile')} onEditDraft={(d) => { navigate(`/create/${d.type.toLowerCase()}`); setEditingDraft(d); }} onUpdateDemographics={handleUpdateDemographics} onUpdateCurrentUser={(updates) => setUserProfile(prev => ({ ...prev!, ...updates }))} onFollowChange={handleFollowChange} onLike={handleLikePost} />;
      case 'notifications':
        return <NotificationsScreen notifications={notifications} onNotificationsChange={(newNotifs) => {
          if (userProfile?.id) {
            const oldUnread = notifications.filter(n => !n.isRead);
            const newUnread = newNotifs.filter(n => !n.isRead);
            if (newUnread.length === 0 && oldUnread.length > 0) {
              // Mass read
              api.markNotificationsRead(userProfile.id).catch(console.error);
            } else if (oldUnread.length > newUnread.length) {
              // Some were read individually
              const newlyReadIds = oldUnread.filter(oldN => !newUnread.find(n => n.id === oldN.id)).map(n => n.id);
              newlyReadIds.forEach(id => {
                api.markNotificationRead(userProfile.id as string, id).catch(console.error);
              });
            }
          }
          setNotifications(newNotifs);
        }} onBack={() => handleTabChange('home')} onItemClick={(tid, ttype, actor) => ttype === 'profile' ? navigateToProfile({ id: actor?.id || '', name: actor?.name || '', avatar: actor?.avatar || '' }) : handleSurveyClick(tid)} />;
      case 'messages':
        return <MessagesScreen onBack={() => handleTabChange(prevTab)} />;
      default:
        // When activeTab isn't explicitly matched but a modal is open
        if (activeCreationFlow || accountModalType) {
           return <HomeScreen
             surveys={surveys}
             userProfile={userProfile}
             isLoading={isFeedLoading}
             onSurveyClick={handleSurveyClick}
             onVote={handleVote}
             onSurveyProgress={handleSurveyProgress}
             onAuthorClick={navigateToProfile}
             onShareToFeed={handleShareToFeed}
             onUpdateDemographics={handleUpdateDemographics}
             onCloseShareSheet={() => {}}
             contextGroups={userGroups}
             onGroupClick={navigateToGroup}
             onLike={handleLikePost}
             onLoadMore={fetchMore}
             hasNextPage={!!nextCursor}
             isLoadingMore={isLoadingMore}
           />;
        }
        return <div className="flex flex-col items-center justify-center h-[60vh] text-gray-400"><BarChart3 size={48} className="mb-4 opacity-20" /><p>Section coming soon.</p></div>;
    }
  };

  const unreadNotificationsCount = notifications.filter(n => !n.isRead).length;

  const activeGroup = userGroups.find(g => g.id === selectedGroupId) || externalGroup;
  const selectedSurvey = surveys.find(s => s.id === selectedSurveyId);

  const canSeeAnalysis = useMemo(() => {
    if (!selectedSurvey) return false;

    const isAuthor = !!userProfile?.id && String(selectedSurvey.author.id) === String(userProfile.id);
    if (isAuthor) return true; // Author bypasses all limits

    const who = selectedSurvey.resultsWho || 'Public';
    const timing = selectedSurvey.resultsTiming || 'AnyTime';

    let whoPasses = false;
    if (who === 'Public') {
      whoPasses = true;
    } else if (who === 'Followers') {
      whoPasses = !!selectedSurvey.author.isFollowing;
    } else if (who === 'Participants') {
      whoPasses = !!selectedSurvey.hasParticipated;
    } else if (who === 'OnlyMe') {
      whoPasses = false;
    }

    if (!whoPasses) return false;

    let whenPasses = false;
    if (timing === 'AnyTime') {
      whenPasses = true;
    } else if (timing === 'Immediately') {
      whenPasses = !!selectedSurvey.hasParticipated;
    } else if (timing === 'AfterEnd') {
      const isExpired = selectedSurvey.expiresAt ? new Date(selectedSurvey.expiresAt).getTime() <= Date.now() : false;
      whenPasses = isExpired;
    }

    return whenPasses;
  }, [selectedSurvey, userProfile]);

  React.useEffect(() => {
    let startX: number | null = null;
    let startY: number | null = null;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (startX === null || startY === null) return;
      
      // If swipe started from the very edge (iOS Safari / PWA back gesture zone)
      if (startX < 40 || startX > window.innerWidth - 40) {
        const diffX = e.touches[0].clientX - startX;
        const diffY = e.touches[0].clientY - startY;
        
        // If it's a primarily horizontal swipe, aggressively prevent browser traversal
        if (Math.abs(diffX) > Math.abs(diffY)) {
          if (e.cancelable) {
            e.preventDefault();
          }
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (startX === null || startY === null) return;
      
      if (startX < 40 || startX > window.innerWidth - 40) {
        const endX = e.changedTouches[0].clientX;
        const endY = e.changedTouches[0].clientY;
        const diffX = endX - startX;
        const diffY = endY - startY;
        
        if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 50) {
           if (selectedSurveyId || selectedProfile || selectedGroupId) {
             setSelectedSurveyId(null);
             setSelectedProfile(null);
             setSelectedGroupId(null);
           } else if (activeTab === 'home') {
             if (pullToRefreshRef.current) pullToRefreshRef.current.triggerRefresh();
           }
        }
      }
      startX = null;
      startY = null;
    };

    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    // IMPORTANT: passive: false is REQUIRED to stop iOS/Android from closing the PWA tab!
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [selectedSurveyId, selectedProfile, selectedGroupId, activeTab]);

  return (
    <SocketProvider user={userProfile}>
      {authModalOpen && (
        <div className="fixed inset-0 z-[100] bg-white animate-in zoom-in-95 duration-200">
          <button onClick={handleCloseAuth} className="absolute top-4 right-4 z-[110] p-2 bg-gray-100 rounded-full hover:bg-gray-200">
            <X size={20} />
          </button>
          <AuthScreen onAuthSuccess={handleAuthSuccess} initialViewMode={authModalType} />
        </div>
      )}
      <div className="min-h-screen bg-gray-100/50 flex justify-center items-center">
        <div className="w-full max-w-md bg-white h-[100dvh] max-h-screen relative shadow-2xl overflow-hidden flex flex-col">

        {showUsersTable ? (
          <UsersTableScreen onBack={() => setShowUsersTable(false)} onUserClick={(u) => { setShowUsersTable(false); setSelectedProfile({ id: u.id, name: u.name, avatar: u.avatar }); }} />
        ) : isPrivacyScreenOpen ? (
          <PrivacyPolicyScreen />
        ) : selectedGroupId && activeGroup ? (
          isGroupSettingsOpen ? (
            <GroupSettingsScreen
              group={activeGroup}
              currentUserId={userProfile.id}
              onBack={() => navigate(`/group/${activeGroup.id}`)}
              onUpdateGroup={(id, updates) => setUserGroups(prev => prev.map(g => g.id === id ? { ...g, ...updates } : g))}
              onDeleteGroup={(id) => { setUserGroups(prev => prev.filter(g => g.id !== id)); navigateToGroup(null); }}
            />
          ) : (
            <GroupScreen
              group={activeGroup}
              surveys={surveys}
              userProfile={userProfile}
              onBack={() => navigateToGroup(null)}
              onSurveyClick={handleSurveyClick}
              onVote={handleVote}
              onSurveyProgress={handleSurveyProgress}
              onSettingsClick={() => navigate(`/group/${activeGroup.id}/settings`)}
              onCreatePost={() => { navigate('/create/survey'); setActiveCreationGroupId(activeGroup.id); }}
              onShareToFeed={handleShareToFeed}
              onUpdateDemographics={handleUpdateDemographics}
            />
          )
        ) : selectedProfile ? (
          <ProfileScreen surveys={surveys} userGroups={[]} userProfile={userProfile} onSurveyClick={handleSurveyClick} onGroupClick={navigateToGroup} onVote={handleVote} onSurveyProgress={handleSurveyProgress} user={selectedProfile} onBack={() => navigateToProfile(null)} onAuthorClick={navigateToProfile} onShareToFeed={handleShareToFeed} onUpdateDemographics={handleUpdateDemographics} onUpdateCurrentUser={(updates) => setUserProfile(prev => ({ ...prev!, ...updates }))} onFollowChange={handleFollowChange} />
        ) : selectedSurveyId && selectedSurvey ? (
          <>
            <div className="bg-white z-10 sticky top-0 border-b border-gray-100">
              <div className="flex items-center px-4 py-3">
                <button onClick={() => navigate(-1)} className="p-2 -ml-2 hover:bg-gray-50 rounded-full text-gray-600 transition-colors"><ArrowLeft size={24} /></button>
                <span className="font-bold text-lg ml-2">Detail View</span>
              </div>
              {/* Detail Tabs */}
              <div className="flex px-4">
                <button
                  onClick={() => setDetailTab('post')}
                  className={`flex-1 py-3 text-sm font-black uppercase tracking-widest transition-all relative ${detailTab === 'post' ? 'text-blue-600' : 'text-gray-400'}`}
                >
                  Post
                  {detailTab === 'post' && <div className="absolute bottom-0 left-1/4 right-1/4 h-1 bg-blue-600 rounded-full" />}
                </button>
                <button
                  onClick={() => setDetailTab('analysis')}
                  className={`flex-1 py-3 text-sm font-black uppercase tracking-widest transition-all relative ${detailTab === 'analysis' ? 'text-blue-600' : 'text-gray-400'}`}
                >
                  Analysis
                  {detailTab === 'analysis' && <div className="absolute bottom-0 left-1/4 right-1/4 h-1 bg-blue-600 rounded-full" />}
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto bg-white no-scrollbar">
              {detailTab === 'post' ? (
                <SurveyCard
                  survey={selectedSurvey}
                  userProfile={userProfile || undefined}
                  contextGroups={userGroups}
                  isDetailView={true}
                  onVote={handleVote}
                  onSurveyProgress={handleSurveyProgress}
                  onAuthorClick={navigateToProfile}
                  onShareToFeed={handleShareToFeed}
                  onUpdateDemographics={handleUpdateDemographics}
                  onGroupClick={navigateToGroup}
                  sourceSurface="FEED" /* Or PROFILE if we track where they came from */
                  onLike={handleLikePost}
                />
              ) : (
                <PostAnalysis survey={selectedSurvey} isAccessDenied={!canSeeAnalysis} />
              )}
            </div>
          </>
        ) : (
          <>
            {activeTab !== 'search' && activeTab !== 'profile' && activeTab !== 'notifications' && activeTab !== 'messages' && (
              <Header 
                onProfileClick={() => navigate('/profile')} 
                onMessagesClick={() => navigate('/messages')} 
                userProfile={userProfile || undefined} 
                onLoginClick={() => navigate('/login')}
                onSignUpClick={() => navigate('/signup')}
              />
            )}

            {activeTab === 'home' ? (
              <PullToRefresh ref={pullToRefreshRef} onRefresh={async () => { await new Promise(r => setTimeout(r, 1000)); }} onScrollChange={dir => setIsNavVisible(dir === 'up')} className="flex-1 mt-16 pb-[75px] bg-white no-scrollbar">
                {renderContent()}
              </PullToRefresh>
            ) : (
              <div className={`flex-1 ${activeTab !== 'search' && activeTab !== 'profile' && activeTab !== 'notifications' && activeTab !== 'messages' ? 'mt-16' : ''} pb-[75px] bg-white overflow-y-auto no-scrollbar`}>
                {renderContent()}
              </div>
            )}

            <BottomNav
              activeTab={activeTab} onTabChange={handleTabChange}
              onAddClick={() => setIsAddMenuOpen(!isAddMenuOpen)}
              isVisible={(isNavVisible || activeTab !== 'home') && activeTab !== 'messages'}
              isAddMenuOpen={isAddMenuOpen}
              onAddMenuOption={handleAddMenuOption}
              unreadNotificationsCount={unreadNotificationsCount}
            />
          </>
        )}

        {/* Creation Flows */}
        {activeCreationFlow === 'survey' && (
          <CreateSurveyModal isOpen={true} onClose={handleCloseModal} onSubmit={handleCreateSubmit} onSaveDraft={handleSaveDraft} userProfile={userProfile} draft={editingDraft || undefined} userGroups={userGroups} initialGroupId={activeCreationGroupId} />
        )}

        {activeCreationFlow === 'poll' && (
          <CreatePollScreen onClose={handleCloseModal} onSubmit={handleCreateSubmit} onSaveDraft={handleSaveDraft} userProfile={userProfile} draft={editingDraft || undefined} userGroups={userGroups} initialGroupId={activeCreationGroupId} />
        )}

        {activeCreationFlow === 'quiz' && (
          <CreateQuizModal isOpen={true} onClose={handleCloseModal} onSubmit={handleCreateSubmit} onSaveDraft={handleSaveDraft} userProfile={userProfile} draft={editingDraft || undefined} userGroups={userGroups} initialGroupId={activeCreationGroupId} />
        )}

        {activeCreationFlow === 'challenge' && (
          <CreateChallengeScreen onClose={handleCloseModal} onSubmit={handleCreateSubmit} userProfile={userProfile} draft={editingDraft || undefined} userGroups={userGroups} initialGroupId={activeCreationGroupId} />
        )}

        <CreateAccountModal isOpen={accountModalType !== null} onClose={handleCloseModal} initialType={accountModalType} onGroupCreated={(g) => setUserGroups([...userGroups, g])} userProfile={userProfile} />
      </div>
    </div>
    </SocketProvider>
  );
};

export default App;
