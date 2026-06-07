
import React, { useState, useRef, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from './services/api';
import { Header } from './components/Header';
import { BottomNav } from './components/BottomNav';
import { SurveyCard } from './components/SurveyCard';
import { HomeScreen } from './components/HomeScreen';
import { CreateSurveyModal } from './components/CreateSurveyModal';
import { CreatePollScreen } from './components/CreatePollScreen';
import { BottomSheet } from './components/BottomSheet';
import { CreateQuizModal } from './components/CreateQuizModal';
import { CreateChallengeScreen } from './components/CreateChallengeScreen';
import { CreateAccountModal } from './components/CreateAccountModal';
import { GroupSettingsScreen } from './components/GroupSettingsScreen';
import { ProfileSettingsScreen } from './components/ProfileSettingsScreen';
import { ErrorBoundary } from './components/ErrorBoundary';
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
import { PostAnswerPayload, Survey, Option, Notification, SurveyType, Group, UserProfile } from './types';
import {
  BarChart3, PieChart, Activity, ArrowLeft, Users, MessageCircle,
  Share2, MoreVertical, Globe, ShieldCheck, ChevronRight, BarChart,
  TrendingUp, FileText, Settings, HelpCircle, PlusCircle, PenLine, Zap, X, Trash2
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

const getFeedCacheKey = (userId?: string | null) => `si_feed_cache:${userId || 'guest'}`;

const App: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, i18n } = useTranslation();

  React.useEffect(() => {
    if (['ar', 'ur'].includes(i18n.language?.split('-')[0])) {
      document.documentElement.dir = 'rtl';
      document.documentElement.lang = i18n.language;
    } else {
      document.documentElement.dir = 'ltr';
      document.documentElement.lang = i18n.language || 'en';
    }
  }, [i18n.language]);

  const [activeTab, setActiveTab] = useState<'home' | 'search' | 'add' | 'trends' | 'profile' | 'notifications' | 'messages'>('home');
  const [prevTab, setPrevTab] = useState<'home' | 'search' | 'add' | 'trends' | 'profile' | 'notifications'>('home');

  // User Profile State
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authBootstrapped, setAuthBootstrapped] = useState(false);
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

  const handleAuthSuccess = (authPayload: any) => {
    const authenticatedUser = authPayload?.user || authPayload;
    const authToken = authPayload?.token || authenticatedUser?.token;
    const { token: _token, ...profile } = authenticatedUser || {};

    if (authToken) {
      localStorage.setItem('si_token', authToken);
    }
    localStorage.setItem('si_user', JSON.stringify(profile));
    setUserProfile(profile);
    setIsAuthenticated(true);
    setAuthBootstrapped(true);
    setAuthModalOpen(false);
    setAuthModalType('flow');
    setSelectedSurveyId(null);
    setSelectedProfile(null);
    setSelectedGroupId(null);
    setIsProfileSettingsOpen(false);
    setIsGroupSettingsOpen(false);
    setActiveCreationFlow(null);
    setAccountModalType(null);
    setActiveTab('home');
    lastFetchedUserIdRef.current = null;
    navigate('/', { replace: true });

    // Initialize Push Notifications if permission granted
    api.setupPushNotifications().catch(console.error);
  };

  const handleLogout = () => {
    const previousUserId = userProfile?.id;
    setIsAuthenticated(false);
    setUserProfile(null);
    setSurveys([]);
    setProfileSurveys([]);
    setProfileNextCursor(null);
    setNotifications([]);
    setSelectedSurveyId(null);
    setDetailSurvey(null);
    setDetailError(null);
    setSelectedProfile(null);
    setSelectedGroupId(null);
    setExternalGroup(null);
    setIsProfileSettingsOpen(false);
    setIsGroupSettingsOpen(false);
    setAuthModalOpen(false);
    setActiveCreationFlow(null);
    setActiveCreationGroupId(null);
    setAccountModalType(null);
    setShowUsersTable(false);
    setActiveTab('home');
    setIsNavVisible(true);
    navigate('/', { replace: true });
    lastFetchedUserIdRef.current = null;
    localStorage.removeItem('si_user');
    localStorage.removeItem('si_token');
    localStorage.removeItem('si_feed_cache');
    if (previousUserId) localStorage.removeItem(getFeedCacheKey(previousUserId));
  };

  // Creation Flow State
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [activeCreationFlow, setActiveCreationFlow] = useState<'survey' | 'poll' | 'quiz' | 'challenge' | null>(null);
  const [activeCreationGroupId, setActiveCreationGroupId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<Survey | null>(null);
  const [accountModalType, setAccountModalType] = useState<'group' | 'company' | null>(null);
  const [editRestrictionState, setEditRestrictionState] = useState<{isOpen: boolean, surveyId?: string, isConfirming?: boolean}>({isOpen: false});



  const normalizeQuizQuestion = (question: any) => {
    const options = Array.isArray(question?.options) ? question.options : [];
    const correctOption = options.find((opt: any) => opt?.isCorrect === true || opt?.isCorrect === 'true' || opt?.isCorrect === 1);

    return {
      ...question,
      options,
      correctOptionId: question?.correctOptionId || correctOption?.id
    };
  };

  const normalizeSurvey = (raw: Partial<Survey>, currentUser?: UserProfile | null): Survey => {
    const questions = Array.isArray(raw.questions)
      ? raw.questions.map(normalizeQuizQuestion)
      : raw.questions;
    const sections = Array.isArray(raw.sections)
      ? raw.sections.map((section: any) => ({
        ...section,
        questions: Array.isArray(section.questions)
          ? section.questions.map(normalizeQuizQuestion)
          : []
      }))
      : [];

    return {
      ...raw,
      id: raw.id || `temp-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      clientKey: raw.clientKey || raw.id || `temp-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      title: raw.title || '',
      description: raw.description || '',
      type: raw.type || SurveyType.POLL,
      status: raw.status || (raw.isDraft ? 'DRAFT' : 'PUBLISHED'),
      options: raw.options || [],
      questions,
      participants: raw.participants || 0,
      isTrending: raw.isTrending || false,
      likes: raw.likes || 0,
      isLiked: raw.isLiked || false,
      commentsCount: raw.commentsCount || 0,
      sections,
      sharedFrom: raw.sharedFrom ? normalizeSurvey(raw.sharedFrom as Partial<Survey>, currentUser) : undefined,
      author: raw.author?.id ? {
        id: raw.author.id,
        name: raw.author.name || 'Unknown',
        handle: raw.author.handle,
        avatar: raw.author.avatar || '',
        type: raw.author.type || 'Personal',
        isFollowing: raw.author.isFollowing || false,
        isPrivate: raw.author.isPrivate
      } : currentUser?.id ? {
        id: currentUser.id,
        name: currentUser.name || 'Unknown',
        handle: currentUser.handle,
        avatar: currentUser.avatar || '',
        type: 'Personal',
        isFollowing: false,
        isPrivate: currentUser.isPrivate
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
    };
  };

  const [surveys, setSurveys] = useState<Survey[]>(() => {
    try {
      const savedUser = localStorage.getItem('si_user');
      const user = savedUser ? JSON.parse(savedUser) : null;
      const cached = localStorage.getItem(getFeedCacheKey(user?.id));
      if (cached) {
        return JSON.parse(cached).map((s: any) => normalizeSurvey(s, user));
      }
    } catch (e) {
      console.error("Failed to parse initial feed cache", e);
    }
    return [];
  });
  const [isFeedLoading, setIsFeedLoading] = useState<boolean>(() => {
    try {
      const savedUser = localStorage.getItem('si_user');
      const user = savedUser ? JSON.parse(savedUser) : null;
      return !localStorage.getItem(getFeedCacheKey(user?.id));
    } catch (e) {
      return true;
    }
  });
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const isLoadingMoreRef = useRef(false);

  // Profile-specific feed states
  const [profileSurveys, setProfileSurveys] = useState<Survey[]>([]);
  const [profileNextCursor, setProfileNextCursor] = useState<string | null>(null);
  const [isProfileLoadingMore, setIsProfileLoadingMore] = useState(false);
  const isProfileLoadingMoreRef = useRef(false);

  const [userGroups, setUserGroups] = useState<Group[]>([]);

  const fetchData = async (currentUserId?: string, currentUser?: UserProfile | null, retries = 5) => {
    try {
      setIsFeedLoading(true);
      const res = await api.getSurveys(currentUserId);
      const surveysData = res.data;

      try {
        localStorage.setItem(getFeedCacheKey(currentUserId), JSON.stringify(surveysData.slice(0, 10)));
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
    if (activeTab === 'profile') {
      if (isProfileLoadingMoreRef.current || !profileNextCursor || !selectedProfile) return;
      isProfileLoadingMoreRef.current = true;
      setIsProfileLoadingMore(true);
      try {
        const currentUserId = userProfile?.id || undefined;
        const res = await api.getSurveys(currentUserId, profileNextCursor, 10, selectedProfile.id);
        const newSurveys = res.data.map((s: any) => normalizeSurvey(s, userProfile));

        setProfileSurveys(prev => {
          const existingIds = new Set(prev.map(s => s.id));
          const uniqueNew = newSurveys.filter((s: Survey) => !existingIds.has(s.id));
          return [...prev, ...uniqueNew];
        });
        setProfileNextCursor(res.nextCursor);
      } catch (error) {
        console.error("Failed to load more profile data", error);
      } finally {
        isProfileLoadingMoreRef.current = false;
        setIsProfileLoadingMore(false);
      }
      return;
    }

    if (isLoadingMoreRef.current || !nextCursor) return;
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);
    try {
      const currentUserId = userProfile?.id || undefined;
      const res = await api.getSurveys(currentUserId, nextCursor);
      const newSurveys = res.data.map((s: any) => normalizeSurvey(s, userProfile));

      setSurveys(prev => {
        const existingIds = new Set(prev.map(s => s.id));
        const uniqueNew = newSurveys.filter((s: Survey) => !existingIds.has(s.id));
        return [...prev, ...uniqueNew];
      });
      setNextCursor(res.nextCursor);
    } catch (error) {
      console.error("Failed to load more data", error);
    } finally {
      isLoadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const scrollBottom = target.scrollHeight - target.scrollTop - target.clientHeight;

    // Trigger load more 800px before reaching the bottom
    if (scrollBottom < 800) {
      if (activeTab === 'profile') {
        if (!isProfileLoadingMoreRef.current && profileNextCursor) {
          fetchMore();
        }
      } else {
        if (!isLoadingMoreRef.current && nextCursor) {
          if (activeTab === 'home' || activeTab === 'search') {
            fetchMore();
          }
        }
      }
    }
  };

  const lastFetchedUserIdRef = useRef<string | null>(null);

  React.useEffect(() => {
    const savedUser = localStorage.getItem('si_user');
    if (savedUser) {
      try {
        const user = JSON.parse(savedUser);
        setUserProfile(user);
        setIsAuthenticated(true);
        setAuthBootstrapped(true);

        // Refresh the cached profile in the background without blocking first paint.
        api.getUser(user.id).then(freshUser => {
          setUserProfile(freshUser);
          localStorage.setItem('si_user', JSON.stringify(freshUser));
        }).catch(err => {
          console.error("Failed to refresh user profile, invalidating session", err);
          localStorage.removeItem('si_user');
          localStorage.removeItem('si_token');
          localStorage.removeItem(getFeedCacheKey(user.id));
          setIsAuthenticated(false);
          setUserProfile(null);
          setSurveys([]);
        });
      } catch (err) {
        console.error("Failed to parse cached user, starting guest session", err);
        localStorage.removeItem('si_user');
        setIsAuthenticated(false);
        setUserProfile(null);
        setSurveys([]);
        setAuthBootstrapped(true);
      }
    } else {
      setAuthBootstrapped(true);
    }

    const handleAuthExpired = () => {
      const expiredUserId = userProfile?.id;
      setIsAuthenticated(false);
      setUserProfile(null);
      setSurveys([]);
      lastFetchedUserIdRef.current = null;
      if (expiredUserId) localStorage.removeItem(getFeedCacheKey(expiredUserId));
    };

    window.addEventListener('auth_expired', handleAuthExpired);
    return () => window.removeEventListener('auth_expired', handleAuthExpired);
  }, []);

  React.useEffect(() => {
    if (!authBootstrapped) return;

    if (isAuthenticated && userProfile?.id) {
      const viewerKey = `user:${userProfile.id}`;
      if (lastFetchedUserIdRef.current === viewerKey) return;
      lastFetchedUserIdRef.current = viewerKey;
      fetchData(userProfile.id, userProfile);
      return;
    }

    if (!isAuthenticated) {
      const viewerKey = 'guest';
      if (lastFetchedUserIdRef.current === viewerKey) return;
      lastFetchedUserIdRef.current = viewerKey;
      fetchData();
    }
  }, [authBootstrapped, isAuthenticated, userProfile?.id]);



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
  const [selectedSurveySurface, setSelectedSurveySurface] = useState<'FEED' | 'PROFILE' | 'SAVED' | 'SEARCH' | 'DEEP_LINK' | 'GROUP'>('DEEP_LINK');
  const [detailSurvey, setDetailSurvey] = useState<Survey | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const detailRequestRef = useRef(0);
  const [detailTab, setDetailTab] = useState<'post' | 'analysis'>('post');

  const [selectedProfile, setSelectedProfile] = useState<{ id: string; name: string; avatar: string; handle?: string } | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [externalGroup, setExternalGroup] = useState<Group | null>(null);
  const [isGroupLoading, setIsGroupLoading] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  const groupRequestRef = useRef(0);
  const [isGroupSettingsOpen, setIsGroupSettingsOpen] = useState(false);
  const [isProfileSettingsOpen, setIsProfileSettingsOpen] = useState(false);
  const [showUsersTable, setShowUsersTable] = useState(false);
  const [isPrivacyScreenOpen, setIsPrivacyScreenOpen] = useState(false);
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const profileRequestRef = useRef(0);

  React.useEffect(() => {
    if (!selectedProfile?.id) {
      setProfileSurveys([]);
      setProfileNextCursor(null);
    }
  }, [selectedProfile?.id]);

  React.useEffect(() => {
    (window as any).showUsersTable = () => setShowUsersTable(true);
  }, []);

  React.useEffect(() => {
    if (!authBootstrapped) return;

    const path = location.pathname;
    const isPostRoute = path.startsWith('/post/');
    const isProfileRoute = path.startsWith('/profile/') || path.startsWith('/@') || path === '/profile';
    const isGroupRoute = path.startsWith('/group/');

    // Helper to reset states when not on their paths
    if (!isPostRoute) {
      setSelectedSurveyId(null);
      setDetailSurvey(null);
      setDetailError(null);
      setIsDetailLoading(false);
    }
    if (!isProfileRoute) {
      setSelectedProfile(null);
      setProfileError(null);
      setIsProfileLoading(false);
    }
    if (!isGroupRoute) {
      setSelectedGroupId(null);
      setGroupError(null);
      setIsGroupLoading(false);
    }
    if (!path.startsWith('/settings/profile')) setIsProfileSettingsOpen(false);
    if (!isGroupRoute || !path.endsWith('/settings')) setIsGroupSettingsOpen(false);
    if (path !== '/privacy') setIsPrivacyScreenOpen(false);

    if (path === '/' || path === '') setActiveTab('home');
    else if (path === '/privacy') setIsPrivacyScreenOpen(true);
    else if (path === '/search') setActiveTab('search');
    else if (path === '/trends') setActiveTab('trends');
    else if (path === '/notifications') setActiveTab('notifications');
    else if (path === '/messages') setActiveTab('messages');
    else if (path === '/profile') {
      setActiveTab('profile');
      if (!userProfile?.id) {
        setIsProfileLoading(false);
        navigate('/login', { replace: true });
      } else {
        const requestId = ++profileRequestRef.current;
        setIsProfileLoading(true);
        setProfileError(null);
        setSelectedProfile(null);
        setProfileSurveys([]);
        api.getSurveys(userProfile.id, undefined, 10, userProfile.id).then(res => {
          if (profileRequestRef.current !== requestId) return;
          const newSurveys = res.data.map((s: any) => normalizeSurvey(s, userProfile));
          setProfileSurveys(newSurveys);
          setProfileNextCursor(res.nextCursor);
          setSelectedProfile(userProfile);
        }).catch(err => {
          if (profileRequestRef.current !== requestId) return;
          console.error(err);
          setProfileError('Failed to load profile.');
        }).finally(() => {
          if (profileRequestRef.current === requestId) setIsProfileLoading(false);
        });
      }
    }
    else if (path.startsWith('/settings/profile')) {
      setActiveTab('profile');
      if (!userProfile?.id) {
        navigate('/login', { replace: true });
      } else {
        setIsProfileSettingsOpen(true);
      }
    }
    else if (path.startsWith('/@')) {
      setActiveTab('profile');
      const handle = decodeURIComponent(path.split('/@')[1] || '').split('/')[0];
      if (handle) {
        const requestId = ++profileRequestRef.current;
        setIsProfileLoading(true);
        setProfileError(null);
        setSelectedProfile(null);
        setProfileSurveys([]);
        const currentUserId = userProfile?.id || undefined;
        Promise.all([
          api.getUserByHandle(handle),
          api.getSurveys(currentUserId, undefined, 10, undefined, handle)
        ]).then(([user, res]) => {
          if (profileRequestRef.current !== requestId) return;
          const newSurveys = res.data.map((s: any) => normalizeSurvey(s, userProfile));
          setProfileSurveys(newSurveys);
          setProfileNextCursor(res.nextCursor);
          setSelectedProfile(user);
        }).catch(err => {
          if (profileRequestRef.current !== requestId) return;
          console.error(err);
          setProfileError('Failed to load profile.');
        }).finally(() => {
          if (profileRequestRef.current === requestId) setIsProfileLoading(false);
        });
      }
    }
    else if (path.startsWith('/profile/')) {
      setActiveTab('profile');
      const id = decodeURIComponent(path.split('/profile/')[1] || '').split('/')[0];
      if (id) {
        const requestId = ++profileRequestRef.current;
        setIsProfileLoading(true);
        setProfileError(null);
        setSelectedProfile(null);
        setProfileSurveys([]);
        const currentUserId = userProfile?.id || undefined;
        Promise.all([
          api.getUser(id),
          api.getSurveys(currentUserId, undefined, 10, id)
        ]).then(([user, res]) => {
          if (profileRequestRef.current !== requestId) return;
          const newSurveys = res.data.map((s: any) => normalizeSurvey(s, userProfile));
          setProfileSurveys(newSurveys);
          setProfileNextCursor(res.nextCursor);
          setSelectedProfile(user);
          if (user.handle) {
            navigate(`/@${user.handle}`, { replace: true });
          }
        }).catch(err => {
          if (profileRequestRef.current !== requestId) return;
          console.error(err);
          setProfileError('Failed to load profile.');
        }).finally(() => {
          if (profileRequestRef.current === requestId) setIsProfileLoading(false);
        });
      }
    }
    else if (path.startsWith('/group/')) {
      const id = path.split('/group/')[1]?.split('/')[0]; // handle /group/id/settings
      if (id) setSelectedGroupId(id);
      if (path.endsWith('/settings')) setIsGroupSettingsOpen(true);
    }
    else if (path.startsWith('/post/')) {
      const id = path.split('/post/')[1]?.split('/')[0];
      if (id) setSelectedSurveyId(id);
    }

    // Auth Routes
    if ((path === '/login' || path === '/signup') && isAuthenticated && userProfile?.id) {
      setAuthModalOpen(false);
      setAuthModalType('flow');
      navigate('/', { replace: true });
      return;
    }

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
  }, [location.pathname, authBootstrapped, isAuthenticated, userProfile?.id, authModalOpen]);

  React.useEffect(() => {
    if (!authBootstrapped) return;

    if (!selectedGroupId) {
      setExternalGroup(null);
      setIsGroupLoading(false);
      setGroupError(null);
      return;
    }

    const requestId = ++groupRequestRef.current;
    setIsGroupLoading(true);
    setGroupError(null);
    setExternalGroup(null);

    api.getGroupById(selectedGroupId)
      .then(group => {
        if (groupRequestRef.current === requestId) setExternalGroup(group);
      })
      .catch(err => {
        if (groupRequestRef.current !== requestId) return;
        console.error(err);
        setGroupError('Failed to load group.');
      })
      .finally(() => {
        if (groupRequestRef.current === requestId) setIsGroupLoading(false);
      });
  }, [authBootstrapped, selectedGroupId]);

  React.useEffect(() => {
    if (!authBootstrapped) return;

    if (!selectedSurveyId) {
      setDetailSurvey(null);
      setDetailError(null);
      setIsDetailLoading(false);
      return;
    }

    const requestId = ++detailRequestRef.current;
    setDetailSurvey(null);
    setDetailError(null);
    setIsDetailLoading(true);

    api.getSurveyById(selectedSurveyId, userProfile?.id || undefined)
      .then(post => {
        if (detailRequestRef.current !== requestId) return;
        const normalized = normalizeSurvey(post, userProfile);
        setDetailSurvey(normalized);
        setSurveys(prev => {
          const exists = prev.some(s => s.id === normalized.id);
          return exists ? prev.map(s => s.id === normalized.id ? normalized : s) : [normalized, ...prev];
        });
      })
      .catch(err => {
        if (detailRequestRef.current !== requestId) return;
        console.error(err);
        setDetailError('Failed to load post.');
      })
      .finally(() => {
        if (detailRequestRef.current === requestId) setIsDetailLoading(false);
      });
  }, [authBootstrapped, selectedSurveyId, userProfile?.id]);

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

  React.useEffect(() => {
    const handleEditRestricted = (e: Event) => {
      const customEvent = e as CustomEvent<any>;
      if (customEvent.detail && customEvent.detail.surveyId) {
        setEditRestrictionState({ isOpen: true, surveyId: customEvent.detail.surveyId });
      }
    };
    window.addEventListener('onEditRestricted', handleEditRestricted);
    return () => window.removeEventListener('onEditRestricted', handleEditRestricted);
  }, []);

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

      // Strict Enforcement: Reject edit if > 5 minutes
      if (targetId && status === 'PUBLISHED') {
        const createdAtTime = newSurveyData.createdAt || editingDraft?.createdAt;
        if (createdAtTime) {
          const createdAt = new Date(createdAtTime).getTime();
          const now = Date.now();
          const diffInMinutes = (now - createdAt) / (1000 * 60);
          
          if (diffInMinutes > 5) {
            setEditRestrictionState({ isOpen: true, surveyId: targetId });
            return;
          }
        }
      }
      console.log(`Determined status: ${status}, targetId: ${targetId}`);

      // Optimistic Update only for Published posts
      const tempId = targetId || `temp-${Date.now()}`;
      if (status === 'PUBLISHED') {
        try {
          const optimisticSurvey = normalizeSurvey({
            id: tempId,
            clientKey: tempId,
            createdAt: new Date().toISOString(),
            ...newSurveyData,
            status: 'PUBLISHED'
          }, userProfile);

          if (!targetId) {
            setSurveys(prev => [optimisticSurvey, ...prev]);
            setProfileSurveys(prev => [optimisticSurvey, ...prev]);
          } else {
            setSurveys(prev => [optimisticSurvey, ...prev.filter(s => s.id !== targetId)]);
            setProfileSurveys(prev => [optimisticSurvey, ...prev.filter(s => s.id !== targetId)]);
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
          setSurveys(prev => prev.map(s => s.id === tempId ? { ...normalizedResult, clientKey: s.clientKey } : s));
          setProfileSurveys(prev => prev.map(s => s.id === tempId ? { ...normalizedResult, clientKey: s.clientKey } : s));
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

  const navigateToProfile = (user: { id: string; name?: string; handle?: string; avatar?: string } | null) => {
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

  const buildProgressFromAnswerPayload = (payload?: PostAnswerPayload[]) => {
    if (!payload || payload.length === 0) return null;

    const progressAnswers: Record<string, any> = {};
    const progressFollowUps: Record<string, string> = {};

    payload.forEach(answer => {
      if (!answer.questionId) return;

      if (answer.optionId) {
        const existing = progressAnswers[answer.questionId];
        progressAnswers[answer.questionId] = Array.isArray(existing)
          ? [...existing, answer.optionId]
          : existing
            ? [existing, answer.optionId]
            : [answer.optionId];

        if (answer.textValue) {
          progressFollowUps[answer.optionId] = answer.textValue;
        }
      } else if (answer.textValue) {
        progressAnswers[answer.questionId] = answer.textValue;
      }
    });

    return { answers: progressAnswers, followUpAnswers: progressFollowUps };
  };

  const handleVote = (
    surveyId: string,
    optionIds: string[],
    isAnonymous?: boolean,
    newOption?: Option,
    followUpAnswers?: Record<string, string>,
    answers?: PostAnswerPayload[]
  ) => {
    const previousSurveys = [...surveys];
    const submittedProgress = buildProgressFromAnswerPayload(answers);
    setSurveys(prev =>
      prev.map(s => {
        const isDirect = s.id === surveyId;
        const isShared = s.sharedFrom?.id === surveyId;

        if (!isDirect && !isShared) return s;

        const applyVote = (target: Survey): Survey => {
          const nextProgressAnswers = submittedProgress?.answers || target.userProgress?.answers || {};
          const nextFollowUpAnswers = {
            ...(target.userProgress?.followUpAnswers || {}),
            ...(followUpAnswers || {}),
            ...(submittedProgress?.followUpAnswers || {})
          };

          // 1) Completion path (Survey without questions/options) => no option votes, only mark participated + store anon
          if (optionIds.length === 0) {
            return {
              ...target,
              hasParticipated: true,
              participants: target.hasParticipated ? target.participants : target.participants + 1,
              userProgress: {
                currentQuestionIndex: target.userProgress?.currentQuestionIndex || 0,
                answers: nextProgressAnswers,
                followUpAnswers: nextFollowUpAnswers,
                historyStack: target.userProgress?.historyStack || [],
                isAnonymous: !!isAnonymous
              }
            };
          }

          // 2) Quiz vote path (update options within questions)
          if (target.type === 'Quiz' || target.type === 'Survey') {
            const updatedQuestions = target.questions?.map(q => ({
              ...q,
              options: q.options?.map(opt =>
                optionIds.includes(opt.id)
                  ? { ...opt, votes: (opt.votes || 0) + 1 }
                  : opt
              )
            }));
            const updatedSections = target.sections?.map(section => ({
              ...section,
              questions: section.questions.map(q => ({
                ...q,
                options: q.options?.map(opt =>
                  optionIds.includes(opt.id)
                    ? { ...opt, votes: (opt.votes || 0) + 1 }
                    : opt
                )
              }))
            }));

            return {
              ...target,
              questions: updatedQuestions,
              sections: updatedSections,
              hasParticipated: true,
              userSelectedOptions: optionIds,
              participants: target.hasParticipated ? target.participants : target.participants + 1,
              userProgress: {
                currentQuestionIndex: target.userProgress?.currentQuestionIndex || 0,
                answers: nextProgressAnswers,
                followUpAnswers: nextFollowUpAnswers,
                historyStack: target.userProgress?.historyStack || [],
                isAnonymous: !!isAnonymous
              }
            };
          }

          // 3) Poll/Challenge vote path
          let updatedOptions = [...(target.options || [])];

          if (newOption && !updatedOptions.some(o => o.id === newOption.id)) {
            updatedOptions.push({ ...newOption, votes: 0 });
          }

          const newOptions = updatedOptions.map(opt =>
            optionIds.includes(opt.id)
              ? { ...opt, votes: (opt.votes || 0) + 1 }
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
              answers: nextProgressAnswers,
              followUpAnswers: nextFollowUpAnswers,
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
    if (optionIds.length > 0 || (answers && answers.length > 0)) {
      api.vote(surveyId, optionIds, userProfile?.id, isAnonymous, newOption, followUpAnswers, answers)
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
        if (isProfileSettingsOpen) {
          if (!userProfile) return <div className="flex-1 flex items-center justify-center p-8 text-center"><h2 className="text-xl font-bold">Please log in to view settings.</h2></div>;
          return (
            <ErrorBoundary>
              <ProfileSettingsScreen userProfile={userProfile} onUpdateProfile={(prof) => { setUserProfile(prof); localStorage.setItem('si_user', JSON.stringify(prof)); }} onBack={() => window.history.length > 2 ? navigate(-1) : navigate('/profile', { replace: true })} onLogout={handleLogout} />
            </ErrorBoundary>
          );
        }
        return <ProfileScreen isLoading={isProfileLoading} surveys={profileSurveys} userGroups={userGroups} userProfile={userProfile!} user={selectedProfile || undefined} onSurveyClick={handleSurveyClick} onGroupClick={navigateToGroup} onVote={handleVote} onAuthorClick={navigateToProfile} onSurveyProgress={handleSurveyProgress} onShareToFeed={handleShareToFeed} onSettingsClick={() => navigate('/settings/profile')} onEditDraft={(d) => { navigate(`/create/${d.type.toLowerCase()}`); setEditingDraft(d); }} onUpdateDemographics={handleUpdateDemographics} onUpdateCurrentUser={(updates) => setUserProfile(prev => ({ ...prev!, ...updates }))} onFollowChange={handleFollowChange} onLike={handleLikePost} />;
      case 'notifications':
        return <NotificationsScreen currentUserId={userProfile?.id || ""} notifications={notifications} onNotificationsChange={(newNotifs) => {
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
        }} onBack={() => window.history.length > 2 ? navigate(-1) : navigate('/', { replace: true })} onItemClick={(tid, ttype, actor) => (ttype === 'profile' || ttype === 'user') ? navigateToProfile({ id: tid || actor?.id || '', name: actor?.name || '', avatar: actor?.avatar || '' }) : handleSurveyClick(tid)} />;
      case 'messages':
        return <MessagesScreen onBack={() => window.history.length > 2 ? navigate(-1) : navigate('/', { replace: true })} />;
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
            onCloseShareSheet={() => { }}
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

  const activeGroup = externalGroup || userGroups.find(g => g.id === selectedGroupId);
  const selectedSurveyFromFeed = useMemo(
    () => surveys.find(s => s.id === selectedSurveyId),
    [surveys, selectedSurveyId]
  );
  const selectedSurvey = detailSurvey || selectedSurveyFromFeed;
  const viewerProfile = userProfile || INITIAL_USER;

  const canSeeAnalysis = useMemo(() => {
    if (!selectedSurvey) return false;

    const analysisSurvey = selectedSurvey.sharedFrom || selectedSurvey;
    const isAuthor = !!userProfile?.id && String(analysisSurvey.author.id) === String(userProfile.id);
    if (isAuthor) return true; // Author bypasses all limits

    if (analysisSurvey.author.isPrivate && !analysisSurvey.author.isFollowing) {
      return false;
    }

    const who = analysisSurvey.resultsWho || 'Public';
    const timing = analysisSurvey.resultsTiming || 'AnyTime';

    let whoPasses = false;
    if (who === 'Public') {
      whoPasses = true;
    } else if (who === 'Followers') {
      whoPasses = !!analysisSurvey.author.isFollowing;
    } else if (who === 'Participants') {
      whoPasses = !!(analysisSurvey.hasParticipated ?? selectedSurvey.hasParticipated);
    } else if (who === 'OnlyMe') {
      whoPasses = false;
    }

    if (!whoPasses) return false;

    let whenPasses = false;
    if (timing === 'AnyTime') {
      whenPasses = true;
    } else if (timing === 'Immediately') {
      whenPasses = !!(analysisSurvey.hasParticipated ?? selectedSurvey.hasParticipated);
    } else if (timing === 'AfterEnd') {
      const isExpired = analysisSurvey.expiresAt ? new Date(analysisSurvey.expiresAt).getTime() <= Date.now() : false;
      whenPasses = isExpired;
    }

    return whenPasses;
  }, [selectedSurvey, userProfile]);

  React.useEffect(() => {
    if (detailTab === 'analysis' && selectedSurvey && !canSeeAnalysis) {
      setDetailTab('post');
    }
  }, [detailTab, selectedSurvey, canSeeAnalysis]);

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
          <AuthScreen key={authModalType} onAuthSuccess={handleAuthSuccess} initialViewMode={authModalType} />
        </div>
      )}
      <div className="min-h-screen bg-gray-100/50 flex justify-center items-center">
        <div className="w-full max-w-md bg-white h-[100dvh] max-h-screen relative shadow-2xl overflow-hidden flex flex-col">

          {!authBootstrapped ? (
            <div className="flex-1 flex flex-col items-center justify-center bg-white px-8">
              <div className="w-16 h-16 rounded-full bg-gray-200 animate-pulse mb-5" />
              <div className="w-40 h-4 rounded-full bg-gray-200 animate-pulse mb-3" />
              <div className="w-28 h-3 rounded-full bg-gray-100 animate-pulse" />
            </div>
          ) : showUsersTable ? (
            <UsersTableScreen onBack={() => setShowUsersTable(false)} onUserClick={(u) => { setShowUsersTable(false); setSelectedProfile({ id: u.id, name: u.name, avatar: u.avatar }); }} />
          ) : isPrivacyScreenOpen ? (
            <PrivacyPolicyScreen />
          ) : selectedGroupId && isGroupLoading ? (
            <div className="flex-1 bg-white pt-10 px-5">
              <div className="w-full h-40 rounded-2xl bg-gray-100 animate-pulse mb-5" />
              <div className="w-44 h-6 rounded-full bg-gray-200 animate-pulse mb-3" />
              <div className="w-64 h-4 rounded-full bg-gray-100 animate-pulse mb-8" />
              <div className="space-y-4">
                <div className="w-full h-28 rounded-2xl bg-gray-100 animate-pulse" />
                <div className="w-full h-28 rounded-2xl bg-gray-100 animate-pulse" />
              </div>
            </div>
          ) : selectedGroupId && groupError ? (
            <div className="flex-1 flex flex-col items-center justify-center bg-white px-8 text-center">
              <Users size={42} className="text-gray-300 mb-4" />
              <h2 className="text-lg font-black text-gray-900 mb-2">Group unavailable</h2>
              <p className="text-sm text-gray-500 mb-6">{groupError}</p>
              <button onClick={() => navigate('/')} className="px-5 py-2 rounded-full bg-gray-900 text-white text-sm font-bold">Back home</button>
            </div>
          ) : selectedGroupId && activeGroup ? (
            isGroupSettingsOpen ? (
              <GroupSettingsScreen
                group={activeGroup}
                currentUserId={viewerProfile.id || ''}
                onBack={() => window.history.length > 2 ? navigate(-1) : navigate(`/group/${activeGroup.id}`, { replace: true })}
                onUpdateGroup={async (id, updates) => {
                  await api.updateGroup(id, updates);
                  setActiveGroup(prev => prev && prev.id === id ? { ...prev, ...updates } : prev);
                  setUserGroups(prev => prev.map(g => g.id === id ? { ...g, ...updates } : g));
                }}
                onDeleteGroup={async (id) => {
                  await api.deleteGroup(id);
                  setUserGroups(prev => prev.filter(g => g.id !== id));
                  navigateToGroup(null);
                }}
                onManageRoles={async (memberId, newRole) => {
                  await api.updateMemberRole(activeGroup.id, memberId, newRole);
                }}
                onKickMember={async (memberId) => {
                  await api.kickMember(activeGroup.id, memberId);
                }}
                onBanMember={async (memberId) => {
                  await api.banMember(activeGroup.id, memberId);
                }}
                onUnbanMember={async (memberId) => {
                  await api.unbanMember(activeGroup.id, memberId);
                }}
                onApproveJoinRequest={async (memberId) => {
                  await api.approveJoinRequest(activeGroup.id, memberId);
                }}
                onRejectJoinRequest={async (memberId) => {
                  await api.rejectJoinRequest(activeGroup.id, memberId);
                }}
                onApprovePendingPost={async (postId) => {
                  await api.approvePendingPost(activeGroup.id, postId);
                }}
                onRejectPendingPost={async (postId, reason) => {
                  await api.rejectPendingPost(activeGroup.id, postId, reason);
                }}
              />
            ) : (
              <GroupScreen
                group={activeGroup}
                surveys={surveys}
                userProfile={viewerProfile}
                onBack={() => navigateToGroup(null)}
                onPostClick={handleSurveyClick}
                onVote={handleVote}
                onSurveyProgress={handleSurveyProgress}
                onSettingsClick={() => navigate(`/group/${activeGroup.id}/settings`)}
                onCreatePost={(type) => {
                  setActiveCreationGroupId(activeGroup.id);
                  const routes = {
                    Poll: '/create/poll',
                    Survey: '/create/survey',
                    Quiz: '/create/quiz',
                    Challenge: '/create/challenge',
                  };
                  navigate(routes[type] || '/create/survey');
                }}
                onInviteUser={async (groupId, userId) => {
                  await api.inviteToGroup(groupId, userId);
                }}
                onShareToFeed={handleShareToFeed}
                onUpdateDemographics={handleUpdateDemographics}
                onLike={handleLikePost}
              />
            )
          ) : profileError ? (
            <div className="flex-1 flex flex-col items-center justify-center bg-white px-8 text-center">
              <Users size={42} className="text-gray-300 mb-4" />
              <h2 className="text-lg font-black text-gray-900 mb-2">Profile unavailable</h2>
              <p className="text-sm text-gray-500 mb-6">{profileError}</p>
              <button onClick={() => navigate('/')} className="px-5 py-2 rounded-full bg-gray-900 text-white text-sm font-bold">Back home</button>
            </div>
          ) : isProfileLoading ? (
            <div className="flex-1 flex flex-col items-center justify-center pt-20">
              <div className="w-24 h-24 bg-gray-200 rounded-full animate-pulse mb-6 shadow-md border-4 border-white"></div>
              <div className="w-40 h-6 bg-gray-200 rounded-full animate-pulse mb-3"></div>
              <div className="w-24 h-4 bg-gray-200 rounded-full animate-pulse mb-8"></div>
              
              <div className="flex gap-12 mb-10 w-full max-w-sm px-8 justify-center">
                <div className="flex flex-col items-center"><div className="w-10 h-6 bg-gray-200 rounded mb-1 animate-pulse"></div><div className="w-16 h-3 bg-gray-200 rounded animate-pulse"></div></div>
                <div className="flex flex-col items-center"><div className="w-10 h-6 bg-gray-200 rounded mb-1 animate-pulse"></div><div className="w-16 h-3 bg-gray-200 rounded animate-pulse"></div></div>
                <div className="flex flex-col items-center"><div className="w-10 h-6 bg-gray-200 rounded mb-1 animate-pulse"></div><div className="w-16 h-3 bg-gray-200 rounded animate-pulse"></div></div>
              </div>

              <div className="w-full px-4 space-y-4">
                <div className="w-full h-32 bg-gray-100 rounded-2xl animate-pulse"></div>
                <div className="w-full h-32 bg-gray-100 rounded-2xl animate-pulse"></div>
              </div>
            </div>
          ) : selectedProfile ? (
            <ProfileScreen 
              surveys={profileSurveys} 
              userGroups={userGroups} 
              userProfile={viewerProfile}
              onSurveyClick={handleSurveyClick} 
              onGroupClick={navigateToGroup} 
              onVote={handleVote} 
              onSurveyProgress={handleSurveyProgress} 
              user={selectedProfile} 
              onBack={() => navigateToProfile(null)} 
              onAuthorClick={navigateToProfile} 
              onShareToFeed={handleShareToFeed} 
              onUpdateDemographics={handleUpdateDemographics} 
              onUpdateCurrentUser={(updates) => setUserProfile(prev => ({ ...prev!, ...updates }))} 
              onFollowChange={handleFollowChange}
              isLoadingMore={isProfileLoadingMore}
              hasNextPage={!!profileNextCursor}
              onLoadMore={fetchMore}
              onSettingsClick={() => navigate('/settings/profile')}
              onEditDraft={(d) => { navigate(`/create/${d.type.toLowerCase()}`); setEditingDraft(d); }}
              onLike={handleLikePost}
            />
          ) : selectedSurveyId ? (
            selectedSurvey ? (
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
                    onClick={() => { if (canSeeAnalysis) setDetailTab('analysis'); }}
                    disabled={!canSeeAnalysis}
                    className={`flex-1 py-3 text-sm font-black uppercase tracking-widest transition-all relative ${detailTab === 'analysis' ? 'text-blue-600' : 'text-gray-400'} ${!canSeeAnalysis ? 'opacity-40 cursor-not-allowed' : ''}`}
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
                    sourceSurface={selectedSurveySurface as any}
                    onLike={handleLikePost}
                  />
                ) : (
                  <PostAnalysis survey={selectedSurvey} isAccessDenied={!canSeeAnalysis} />
                )}
              </div>
            </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center bg-white px-8 text-center">
                {isDetailLoading ? (
                  <>
                    <div className="w-full max-w-xs h-36 rounded-2xl bg-gray-100 animate-pulse mb-5" />
                    <div className="w-48 h-4 rounded-full bg-gray-200 animate-pulse mb-3" />
                    <div className="w-32 h-3 rounded-full bg-gray-100 animate-pulse" />
                  </>
                ) : (
                  <>
                    <FileText size={42} className="text-gray-300 mb-4" />
                    <h2 className="text-lg font-black text-gray-900 mb-2">Post unavailable</h2>
                    <p className="text-sm text-gray-500 mb-6">{detailError || 'This post could not be loaded.'}</p>
                    <button onClick={() => navigate('/')} className="px-5 py-2 rounded-full bg-gray-900 text-white text-sm font-bold">Back home</button>
                  </>
                )}
              </div>
            )
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
                <PullToRefresh ref={pullToRefreshRef} onScroll={handleScroll} onRefresh={async () => { await fetchData(userProfile?.id || undefined, userProfile); }} onScrollChange={dir => setIsNavVisible(dir === 'up')} className="flex-1 mt-16 pb-[75px] bg-white no-scrollbar">
                  {isFeedLoading && surveys.length > 0 && (
                    <div className="sticky top-0 z-20 h-1 bg-gray-100 overflow-hidden">
                      <div className="h-full w-1/2 bg-blue-500 rounded-r-full animate-pulse" />
                    </div>
                  )}
                  {renderContent()}
                </PullToRefresh>
              ) : (
                <div onScroll={handleScroll} className={`flex-1 ${activeTab !== 'search' && activeTab !== 'profile' && activeTab !== 'notifications' && activeTab !== 'messages' ? 'mt-16' : ''} pb-[75px] bg-white overflow-y-auto no-scrollbar`}>
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

      <BottomSheet isOpen={editRestrictionState.isOpen} onClose={() => {
        setEditRestrictionState({ isOpen: false });
        setActiveTab('home');
        navigate('/');
      }} title={t('Editing Disabled')}>
        <div className="p-4 space-y-4">
          {editRestrictionState.isConfirming ? (
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-2 shadow-sm border border-red-100">
                <Trash2 size={32} strokeWidth={1.5} />
              </div>
              <h3 className="text-xl font-black text-gray-900 mb-2">Delete Post</h3>
              <p className="text-sm text-gray-500 leading-relaxed max-w-xs mx-auto">
                Are you sure you want to delete this post? This action cannot be undone.
              </p>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={async () => {
                    const sid = editRestrictionState.surveyId;
                    if (sid && userProfile?.id) {
                      try {
                        await api.deletePost(sid, userProfile.id);
                        setSurveys(prev => prev.filter(s => s.id !== sid));
                        setProfileSurveys(prev => prev.filter(s => s.id !== sid));
                      } catch (e) {
                        console.error("Failed to delete post:", e);
                      }
                    }
                    setEditRestrictionState({ isOpen: false });
                    setActiveTab('home');
                    navigate('/');
                  }}
                  className="flex-1 bg-red-600 text-white p-4 rounded-2xl font-black uppercase tracking-widest text-xs shadow-lg shadow-red-600/20 active:scale-95 transition-all"
                >
                  Confirm Delete
                </button>
                <button
                  onClick={() => setEditRestrictionState(prev => ({ ...prev, isConfirming: false }))}
                  className="flex-1 bg-gray-100 text-gray-700 p-4 rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-gray-200 active:scale-95 transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-600 whitespace-pre-wrap">{t('Edit Restricted Message')}</p>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setEditRestrictionState(prev => ({ ...prev, isConfirming: true }))}
                  className="flex-1 bg-red-600 text-white p-3 rounded-xl font-bold shadow-md shadow-red-600/20 active:scale-95 transition-all"
                >
                  {t('Delete Post')}
                </button>
                <button
                  onClick={() => {
                    setEditRestrictionState({ isOpen: false });
                    setActiveTab('home');
                    navigate('/');
                  }}
                  className="flex-1 bg-gray-100 text-gray-700 p-3 rounded-xl font-bold active:scale-95 transition-all"
                >
                  {t('Cancel')}
                </button>
              </div>
            </>
          )}
        </div>
      </BottomSheet>
    </SocketProvider>
  );
};

export default App;
