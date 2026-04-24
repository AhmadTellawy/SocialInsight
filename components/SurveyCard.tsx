import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Survey, SurveyType, Option, LogicRule, UserProfile } from '../types';
import { Clock, Users, TrendingUp, MoreHorizontal, Share2, CheckCircle2, Flag, EyeOff, Bookmark, Link as LinkIcon, UserMinus, ThumbsUp, MessageCircle, FileText, PieChart, HelpCircle, Globe, Lock, Plus, AlertCircle, ImageIcon, ChevronLeft, ChevronRight, Check, ArrowRight, XCircle, Trophy, Target, X, ListChecks, Zap, Timer, Play, Repeat, UserPlus, PlusCircle, Shield, Shuffle, Heart, Search, Send, Star, Maximize2, BarChart3, Trash2, Edit3 } from 'lucide-react';
import { Analytics } from '../utils/analytics';
import { BottomSheet } from './BottomSheet';
import { CommentsSheet } from './CommentsSheet';
import { ShareSheet } from './ShareSheet';
import { ParticipantsSheet } from './ParticipantsSheet';
import { LikersSheet } from './LikersSheet';
import { RichTextRenderer } from './RichTextRenderer';
import { UserAvatar } from './UserAvatar';
import { api } from '../services/api';
import { useFollowState } from '../hooks/useFollowState';

interface SurveyCardProps {
  survey: Survey;
  userProfile?: UserProfile;
  isDetailView?: boolean;
  onContentClick?: () => void;
  onVote?: (surveyId: string, optionIds: string[], isAnonymous?: boolean, newOption?: Option) => void;
  onSurveyProgress?: (surveyId: string, progress: { index: number, answers: Record<string, any>, followUpAnswers?: Record<string, string>, historyStack?: number[], isAnonymous?: boolean }) => void;
  onAuthorClick?: (author: { id: string; name: string; avatar: string }) => void;
  onShareToFeed?: (survey: Survey, caption: string) => void;
  onUpdateDemographics?: (demographics: Partial<NonNullable<UserProfile['demographics']>>) => void;
  positionInFeed?: number;
  sourceSurface?: 'FEED' | 'PROFILE' | 'SAVED' | 'SEARCH' | 'DEEP_LINK';
  onAnalysisClick?: () => void;
  contextGroups?: any[];
  onGroupClick?: (groupId: string) => void;
  onLike?: (surveyId: string, isLiked: boolean) => void;
  onDelete?: (surveyId: string) => void;
}

interface FlatQuestion {
  id: string;
  text: string;
  type: 'text' | 'multiple_choice' | 'true_false';
  options?: Option[];
  image?: string;
  imageLayout?: 'vertical' | 'horizontal';
  sectionTitle: string;
  sectionId: string;
  minSelection?: number;
  maxSelection?: number;
  sectionCondition?: LogicRule;
  weight?: number;
  correctOptionId?: string;
}

// Configuration for demographic questions
const DEM_CONFIG: Record<string, { title: string, question: string, options: string[], profileKey: keyof NonNullable<UserProfile['demographics']> }> = {
  gender: {
    title: 'Gender Identity',
    question: 'Please select your gender to help us analyze the results.',
    options: ['Male', 'Female', 'Prefer not to say'],
    profileKey: 'gender'
  },
  marital_status: {
    title: 'Marital Status',
    question: 'What is your current marital status?',
    options: ['Single', 'Engaged', 'Married', 'Widowed', 'Divorced', 'Separated', 'Prefer not to say'],
    profileKey: 'maritalStatus'
  },
  age_group: {
    title: 'Age Group',
    question: 'Which age group do you belong to?',
    options: ['Under 18', '18-24', '25-34', '35-44', '45-54', '55+'],
    profileKey: 'ageGroup'
  },
  education: {
    title: 'Education Level',
    question: 'What is your highest level of education?',
    options: [
      'Primary Education', 
      'Preparatory / Middle School', 
      'Secondary Education (High School)', 
      'Diploma', 
      'Higher Diploma / Postgraduate Diploma', 
      'Bachelor’s Degree', 
      'Professional Diploma', 
      'Master’s Degree', 
      'Doctorate (PhD)', 
      'Prefer not to say'
    ],
    profileKey: 'education'
  },
  employment: {
    title: 'Employment Status',
    question: 'What is your current employment status?',
    options: ['Employed', 'Unemployed', 'Student', 'Retired', 'Homemaker', 'prefer not to specify'],
    profileKey: 'employment'
  },
  industry: {
    title: 'Employment Type',
    question: 'What is your current employment type?',
    options: ['Government', 'Private Sector', 'Non-profit / NGO', 'Self-employed / Freelancer', 'Not Applicable', 'Prefer not to say'],
    profileKey: 'industry'
  },
  sector: {
    title: 'Employment Sector',
    question: 'What is your current employment sector?',
    options: [
      'Agriculture, Forestry, And Fishing',
      'Mining',
      'Construction',
      'Manufacturing',
      'Transportation, Communications, Electric, Gas, And Sanitary Services',
      'Wholesale Trade',
      'Retail Trade',
      'Finance, Insurance, And Real Estate',
      'Services',
      'Public Administration',
      'Not Applicable',
      'Prefer Not To Specify'
    ],
    profileKey: 'sector'
  }
};

export const SurveyCard: React.FC<SurveyCardProps> = ({
  survey,
  userProfile,
  isDetailView = false,
  onContentClick,
  onAnalysisClick,
  onVote,
  onSurveyProgress,
  onAuthorClick,
  onShareToFeed,
  onUpdateDemographics,
  positionInFeed,
  sourceSurface = 'FEED',
  contextGroups = [],
  onGroupClick,
  onLike,
  onDelete
}) => {
  const [timeLeftStr, setTimeLeftStr] = useState('');
  const [isExpired, setIsExpired] = useState(false);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    const calculateTime = () => {
      const now = new Date().getTime();
      const targetSurvey = survey.sharedFrom || survey;

      if (!targetSurvey.expiresAt) {
        setTimeLeftStr('');
        setIsExpired(false);
        return false;
      }

      const expiryDate = new Date(targetSurvey.expiresAt);
      if (isNaN(expiryDate.getTime())) {
        setTimeLeftStr('');
        setIsExpired(false);
        return false;
      }

      const expiry = expiryDate.getTime();
      const diff = expiry - now;

      if (diff > 1000 * 60 * 60 * 24 * 365) {
        setTimeLeftStr('');
        setIsExpired(false);
        return false;
      }

      if (diff <= 0) {
        setIsExpired(true);
        setTimeLeftStr('Expired');
        return true;
      }

      setIsExpired(false);
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const secs = Math.floor((diff % (1000 * 60)) / 1000);

      if (days > 0) setTimeLeftStr(`${days}d ${hours}h left`);
      else if (hours > 0) setTimeLeftStr(`${hours}h ${mins}m left`);
      else if (mins > 0) setTimeLeftStr(`${mins}m ${secs}s left`);
      else setTimeLeftStr(`${secs}s left`);

      return false;
    };

    calculateTime();
    interval = setInterval(calculateTime, 1000);
    return () => clearInterval(interval);
  }, [survey.id, survey.sharedFrom, survey.expiresAt]);

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isReportSheetOpen, setIsReportSheetOpen] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportDescription, setReportDescription] = useState('');
  const [isReporting, setIsReporting] = useState(false);
  const [isSaved, setIsSaved] = useState(survey.isSaved || false);
  const [isHidden, setIsHidden] = useState(false);

  const [isCommentsOpen, setIsCommentsOpen] = useState(false);
  const [isShareSheetOpen, setIsShareSheetOpen] = useState(false);
  const [isParticipantsOpen, setIsParticipantsOpen] = useState(false);
  const [isAnonInfoOpen, setIsAnonInfoOpen] = useState(false);
  const [expandedImageUrl, setExpandedImageUrl] = useState<string | null>(null);
  const [portraitImages, setPortraitImages] = useState<Set<string>>(new Set());
  const [isLikersSheetOpen, setIsLikersSheetOpen] = useState(false);
  const [isRepostMenuOpen, setIsRepostMenuOpen] = useState(false);
  const [shareSheetInitialStep, setShareSheetInitialStep] = useState<'menu' | 'repost-editor'>('menu');

  // Unified Demographic Flow State
  const [isDemographicSheetOpen, setIsDemographicSheetOpen] = useState(false);
  const [pendingDemoSteps, setPendingDemoSteps] = useState<string[]>([]);
  const [currentDemoIdx, setCurrentDemoIdx] = useState(0);
  const [isDemoSuccess, setIsDemoSuccess] = useState(false);
  const [imageError, setImageError] = useState(false);

  const sourceSurvey = survey.sharedFrom || survey;

  const [isAnonToggled, setIsAnonToggled] = useState(false);
  const [showShareToast, setShowShareToast] = useState(false);
  const [isLiked, setIsLiked] = useState(sourceSurvey.isLiked || survey.isLiked || false);
  const [likeCount, setLikeCount] = useState(sourceSurvey.likes || survey.likes || 0);
  const [commentsCount, setCommentsCount] = useState(sourceSurvey.commentsCount || survey.commentsCount || 0);

  useEffect(() => {
    setIsLiked(sourceSurvey.isLiked || survey.isLiked || false);
    setLikeCount(sourceSurvey.likes || survey.likes || 0);
    setCommentsCount(sourceSurvey.commentsCount || survey.commentsCount || 0);
  }, [sourceSurvey.isLiked, sourceSurvey.likes, sourceSurvey.commentsCount, survey.isLiked, survey.likes, survey.commentsCount]);

  // Tracking Refs
  const viewRef = useRef<HTMLDivElement>(null);
  const dwellStartTime = useRef<number | null>(null);
  const totalDwellTime = useRef<number>(0);
  const viewLogged = useRef<boolean>(false);

  const isCurrentlyAnonymous = sourceSurvey.forceAnonymous ? true : (sourceSurvey.allowAnonymous ? isAnonToggled : false);

  const [localOptions, setLocalOptions] = useState<Option[]>([]);
  const [selectedOptions, setSelectedOptions] = useState<string[]>(sourceSurface === 'SHARE_CAPTURE' ? [] : (survey.userSelectedOptions || []));
  const [hasVoted, setHasVoted] = useState(sourceSurface === 'SHARE_CAPTURE' ? false : (survey.hasParticipated || false));

  // Voter-added option state
  const [isAddingCustomOption, setIsAddingCustomOption] = useState(false);
  const [customOptionText, setCustomOptionText] = useState('');

  // Challenge State
  const [challengeActivePair, setChallengeActivePair] = useState<string[]>([]);
  const [challengeEliminatedIds, setChallengeEliminatedIds] = useState<Set<string>>(new Set());
  const [isChallengeTransitioning, setIsChallengeTransitioning] = useState<string | null>(null);

  const [currentQIndex, setCurrentQIndex] = useState(sourceSurface === 'SHARE_CAPTURE' ? 0 : (survey.userProgress?.currentQuestionIndex || 0));
  const [reviewQIndex, setReviewQIndex] = useState(0);
  const [surveyAnswers, setSurveyAnswers] = useState<Record<string, any>>(sourceSurface === 'SHARE_CAPTURE' ? {} : (survey.userProgress?.answers || {}));
  const [followUpAnswers, setFollowUpAnswers] = useState<Record<string, string>>(sourceSurface === 'SHARE_CAPTURE' ? {} : (survey.userProgress?.followUpAnswers || {}));
  const [surveyCompleted, setSurveyCompleted] = useState(sourceSurface === 'SHARE_CAPTURE' ? false : (survey.hasParticipated || false));
  const [slideDirection, setSlideDirection] = useState<'next' | 'prev'>('next');
  const [historyStack, setHistoryStack] = useState<number[]>(sourceSurface === 'SHARE_CAPTURE' ? [] : (survey.userProgress?.historyStack || []));

  const [quizStarted, setQuizStarted] = useState(() => {
    if (sourceSurface === 'SHARE_CAPTURE') return false;
    const answers = survey.userProgress?.answers;
    return (answers && Object.keys(answers).length > 0) || false;
  });

  const [quizStats, setQuizStats] = useState<{ correct: number, total: number } | null>(null);

  const authorType = survey.author?.type || 'User'; // Adjust based on your schema if needed
  const [isInteracted, setIsInteracted] = useFollowState(survey.author?.id, survey.author?.isFollowing || false);
  const [isInteractLoading, setIsInteractLoading] = useState(false);

  useEffect(() => {
    setIsInteracted(survey.author?.isFollowing || false);
  }, [survey.author?.isFollowing]);

  const handleFollowInteraction = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!userProfile?.id || !survey.author?.id) return;
    const authorId = survey.author.id;
    const newStatus = !isInteracted;
    setIsInteracted(newStatus);
    setIsInteractLoading(true);

    Analytics.track({
      event_type: 'FOLLOW_TOGGLE',
      target_user_id: authorId,
      new_state: newStatus,
      actor_user_id: userProfile.id,
      source_surface: sourceSurface,
      position_in_feed: positionInFeed
    });

    try {
      const resp = await api.followUser(authorId, userProfile.id);
      if (resp && resp.isFollowing !== undefined) {
        setIsInteracted(resp.isFollowing);
      }
    } catch (error) {
      console.error("Failed to follow/join", error);
      setIsInteracted(!newStatus);
    } finally {
      setIsInteractLoading(false);
    }
  };

  const renderInteractionButton = () => {
    const isMe = userProfile?.id === survey.author?.id;
    if (isMe) return null;
    const label = authorType === 'Group' ? 'Join' : 'Follow';
    const activeLabel = authorType === 'Group' ? 'Joined' : 'Following';

    return (
      <div className="flex items-center">
        <span className="text-gray-400 mx-2 text-[10px]">•</span>
        <button
          onClick={handleFollowInteraction}
          disabled={isInteractLoading}
          className={`text-sm font-bold transition-all active:scale-95 ${isInteracted ? 'text-gray-500' : 'text-[#1877F2]'} ${isInteractLoading ? 'opacity-50' : ''}`}
        >
          {isInteracted ? activeLabel : label}
        </button>
      </div>
    );
  };

  const flatQuestions: FlatQuestion[] = useMemo(() => {
    const source = survey.sharedFrom || survey;
    if (!source.sections) return [];
    return source.sections.flatMap(section =>
      section.questions.map(q => ({
        ...q,
        sectionTitle: section.title,
        sectionId: section.id,
        sectionCondition: section.displayCondition
      }))
    );
  }, [survey]);

  useEffect(() => {
    setIsMenuOpen(false);
    setIsReportSheetOpen(false);
    setIsCommentsOpen(false);
    setIsShareSheetOpen(false);
    setIsParticipantsOpen(false);
    setIsAnonInfoOpen(false);
    setExpandedImageUrl(null);
    setFollowUpAnswers(sourceSurface === 'SHARE_CAPTURE' ? {} : (survey.userProgress?.followUpAnswers || {}));
    setSurveyAnswers(sourceSurface === 'SHARE_CAPTURE' ? {} : (survey.userProgress?.answers || {}));
    setHistoryStack(sourceSurface === 'SHARE_CAPTURE' ? [] : (survey.userProgress?.historyStack || []));
    setCurrentQIndex(sourceSurface === 'SHARE_CAPTURE' ? 0 : (survey.userProgress?.currentQuestionIndex || 0));
    setReviewQIndex(0);
    setChallengeActivePair([]);
    setChallengeEliminatedIds(new Set());

    if (!(survey.sharedFrom || survey).allowAnonymous) {
      setIsAnonToggled(false);
    }
  }, [survey.id]);

  useEffect(() => {
    const s = survey.sharedFrom || survey;
    let opts = [...(s.options || [])];

    if (survey.type === SurveyType.CHALLENGE && s.randomPairing && !survey.hasParticipated) {
      opts.sort(() => Math.random() - 0.5);
    } else if (s.pollChoiceType === 'rating') {
      opts.sort((a, b) => (b.ratingValue || 0) - (a.ratingValue || 0));
    }

    setLocalOptions(opts);

    if (sourceSurface === 'SHARE_CAPTURE') {
      setHasVoted(false);
      setSelectedOptions([]);
      setSurveyCompleted(false);
      setQuizStarted(false);
      setQuizStats(null);
    } else {
      setHasVoted(survey.hasParticipated || false);
      setSelectedOptions(survey.userSelectedOptions || []);

      if (survey.hasParticipated) {
        setSurveyCompleted(true);
        if (survey.type === SurveyType.QUIZ) {
          calculateAndSetScore(survey.userProgress?.answers || {});
        }
      } else {
        setSurveyCompleted(false);
        const hasAnswers = survey.userProgress?.answers && Object.keys(survey.userProgress.answers).length > 0;
        if (!hasAnswers && !quizStarted) {
          setQuizStarted(false);
        }
        setQuizStats(null);
      }
    }
  }, [survey.id, survey.hasParticipated, sourceSurface]);

  useEffect(() => {
    setIsSaved(sourceSurvey.isSaved || survey.isSaved || false);
    setIsLiked(sourceSurvey.isLiked || survey.isLiked || false);
    setLikeCount(sourceSurvey.likes || survey.likes || 0);
  }, [sourceSurvey.id, sourceSurvey.isSaved, sourceSurvey.isLiked, sourceSurvey.likes, survey.id, survey.isSaved, survey.isLiked, survey.likes]);

  // E1: POST_VIEW Tracking
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          // Entry
          dwellStartTime.current = Date.now();
          if (!viewLogged.current) {
            Analytics.track({
              event_type: 'POST_VIEW_START',
              post_id: survey.id,
              actor_user_id: userProfile?.id,
              source_surface: sourceSurface,
              position_in_feed: positionInFeed
            });
            viewLogged.current = true;
          }
        } else {
          // Exit
          if (dwellStartTime.current) {
            totalDwellTime.current += (Date.now() - dwellStartTime.current);
            dwellStartTime.current = null;
          }
        }
      });
    }, { threshold: 0.1 }); // 10% visible

    if (viewRef.current) observer.observe(viewRef.current);

    return () => {
      if (dwellStartTime.current) {
        totalDwellTime.current += (Date.now() - dwellStartTime.current);
      }
      if (totalDwellTime.current >= 500) {
        Analytics.track({
          event_type: 'POST_VIEW_END',
          post_id: survey.id,
          actor_user_id: userProfile?.id,
          dwell_time_ms: totalDwellTime.current,
          source_surface: sourceSurface,
          position_in_feed: positionInFeed
        });
      }
      observer.disconnect();
    };
  }, [survey.id, userProfile?.id, positionInFeed, sourceSurface]);

  useEffect(() => {
    if (survey.type === SurveyType.CHALLENGE && !hasVoted && localOptions.length >= 2 && challengeActivePair.length === 0) {
      setChallengeActivePair([localOptions[0].id, localOptions[1].id]);
    }
  }, [survey.type, hasVoted, localOptions, challengeActivePair.length]);

  // Handle completion and demographic check
  const startDemographicFlow = () => {
    if (!sourceSurvey.demographics || !userProfile) return;

    // Filter to only demographics requested by creator that are MISSING from user profile
    const pending = sourceSurvey.demographics.filter(d => {
      const config = DEM_CONFIG[d];
      if (!config) return false;
      return !userProfile.demographics?.[config.profileKey];
    });

    if (pending.length > 0) {
      setPendingDemoSteps(pending);
      setCurrentDemoIdx(0);
      setIsDemoSuccess(false);
      setTimeout(() => {
        setIsDemographicSheetOpen(true);
      }, 800);
    }
  };

  const handleDemographicSelection = (option: string) => {
    const currentAttr = pendingDemoSteps[currentDemoIdx];
    const config = DEM_CONFIG[currentAttr];

    if (onUpdateDemographics && config) {
      onUpdateDemographics({ [config.profileKey]: option });
    }

    // Move to next step or finish
    if (currentDemoIdx < pendingDemoSteps.length - 1) {
      setCurrentDemoIdx(prev => prev + 1);
    } else {
      // Final step complete
      setIsDemoSuccess(true);
      setTimeout(() => {
        setIsDemographicSheetOpen(false);
        setTimeout(() => setIsDemoSuccess(false), 500);
      }, 1500);
    }
  };

  const handleChallengeVote = (winnerId: string) => {
    if (hasVoted || isChallengeTransitioning) return;

    const loserId = challengeActivePair.find(id => id !== winnerId)!;
    setIsChallengeTransitioning(loserId);

    setTimeout(() => {
      const newEliminated = new Set(challengeEliminatedIds).add(loserId);
      setChallengeEliminatedIds(newEliminated);

      const nextCandidate = localOptions.find(opt =>
        !newEliminated.has(opt.id) && !challengeActivePair.includes(opt.id)
      );

      if (nextCandidate) {
        setChallengeActivePair(prev => prev.map(id => id === loserId ? nextCandidate.id : id));
        setIsChallengeTransitioning(null);
      } else {
        setHasVoted(true);
        setSelectedOptions([winnerId]);
        if (onVote) onVote(sourceSurvey.id, [winnerId], isCurrentlyAnonymous);
        setIsChallengeTransitioning(null);
        startDemographicFlow();
      }
    }, 400);
  };

  const calculateAndSetScore = (answers: Record<string, any>) => {
    let correctCount = 0;
    flatQuestions.forEach(q => {
      const userAns = answers[q.id];
      const correctId = q.correctOptionId;
      if (correctId && userAns && Array.isArray(userAns) && userAns.includes(correctId)) {
        correctCount++;
      } else if (correctId && userAns === correctId) {
        correctCount++;
      }
    });
    setQuizStats({ correct: correctCount, total: flatQuestions.length });
  };

  const isSurveyMode = (survey.type === SurveyType.SURVEY || survey.type === SurveyType.QUIZ) && (survey.sections || survey.sharedFrom?.sections);
  const showQuizStartCard = survey.type === SurveyType.QUIZ && !quizStarted && !surveyCompleted && flatQuestions.length > 0;
  const showInteractiveSurvey = isSurveyMode && !surveyCompleted && !isExpired && !showQuizStartCard;

  const currentQuestion = flatQuestions[currentQIndex];
  const totalQuestions = flatQuestions.length;
  const progressPercentage = totalQuestions > 0 ? Math.round(((currentQIndex) / totalQuestions) * 100) : 0;

  const evaluateRule = (rule?: LogicRule): boolean => {
    if (!rule) return true;
    const answer = surveyAnswers[rule.triggerQuestionId];
    const answerVal = Array.isArray(answer) ? answer[0] : answer;
    if (rule.operator === 'equals') return answerVal === rule.value;
    if (rule.operator === 'not_equals') return answerVal !== rule.value;
    if (rule.operator === 'contains') return Array.isArray(answer) && answer.includes(rule.value);
    return true;
  };

  const resolveDynamicText = (text: string) => {
    return text.replace(/\{\{([a-zA-Z0-9-]+)\}\}/g, (_, qId) => {
      const ans = surveyAnswers[qId];
      if (!ans) return '...';
      if (Array.isArray(ans)) return ans.join(', ');
      return ans.toString();
    });
  };

  const handleSurveyAnswer = (optionId: string | string[]) => {
    if (!currentQuestion || isExpired) return;

    let newAnswer: string | string[];
    const isQuiz = survey.type === SurveyType.QUIZ;

    if (currentQuestion.type === 'multiple_choice' || currentQuestion.type === 'true_false') {
      const currentAns = (surveyAnswers[currentQuestion.id] as string[]) || [];
      if (Array.isArray(optionId)) {
        newAnswer = optionId;
      } else {
        if (isQuiz || currentQuestion.type === 'true_false' || (currentQuestion.maxSelection || 1) === 1) {
          newAnswer = [optionId];
        } else {
          if (currentAns.includes(optionId)) {
            newAnswer = currentAns.filter(id => id !== optionId);
          } else {
            if (currentQuestion.maxSelection && currentAns.length >= currentQuestion.maxSelection) {
              return;
            }
            newAnswer = [...currentAns, optionId];
          }
        }
      }
    } else {
      newAnswer = optionId;
    }

    const newAnswers = { ...surveyAnswers, [currentQuestion.id]: newAnswer };
    setSurveyAnswers(newAnswers);

    if (onSurveyProgress) {
      onSurveyProgress(sourceSurvey.id, {
        index: currentQIndex,
        answers: newAnswers,
        followUpAnswers,
        historyStack,
        isAnonymous: isCurrentlyAnonymous
      });
    }
  };

  const handleFollowUpChange = (optionId: string, text: string) => {
    const newFollowUpAnswers = { ...followUpAnswers, [optionId]: text };
    setFollowUpAnswers(newFollowUpAnswers);
    if (onSurveyProgress) {
      onSurveyProgress(sourceSurvey.id, {
        index: currentQIndex,
        answers: surveyAnswers,
        followUpAnswers: newFollowUpAnswers,
        historyStack,
        isAnonymous: isCurrentlyAnonymous
      });
    }
  };

  const handleNextQuestion = (currentAnswers = surveyAnswers) => {
    if (!currentQuestion || isExpired) return;
    const answer = currentAnswers[currentQuestion.id];

    if (currentQuestion.minSelection) {
      const count = Array.isArray(answer) ? answer.length : (answer ? 1 : 0);
      if (count < currentQuestion.minSelection) return;
    }
    if (currentQuestion.type === 'text' && (!answer || answer.trim() === '')) {
      return;
    }

    let nextStepIndex = currentQIndex + 1;
    let isTerminal = false;

    if ((currentQuestion.type === 'multiple_choice' || currentQuestion.type === 'true_false') && currentQuestion.options) {
      const selectedIds = Array.isArray(answer) ? answer : [answer];
      const terminalOption = currentQuestion.options.find(o => selectedIds.includes(o.id) && o.isTerminal);
      if (terminalOption) {
        isTerminal = true;
      }
      const jumpOption = currentQuestion.options.find(o => selectedIds.includes(o.id) && o.jumpToQuestionId);
      if (jumpOption && jumpOption.jumpToQuestionId) {
        const targetIndex = flatQuestions.findIndex(q => q.id === jumpOption.jumpToQuestionId);
        if (targetIndex !== -1) {
          nextStepIndex = targetIndex;
        }
      }
    }

    if (isTerminal) {
      finishSurvey(currentAnswers);
      return;
    }

    while (nextStepIndex < totalQuestions) {
      const targetQ = flatQuestions[nextStepIndex];
      if (!targetQ.sectionCondition || evaluateRule(targetQ.sectionCondition)) {
        break;
      }
      nextStepIndex++;
    }

    if (nextStepIndex < totalQuestions) {
      setSlideDirection('next');
      const newStack = [...historyStack, currentQIndex];
      setHistoryStack(newStack);
      setCurrentQIndex(nextStepIndex);
      if (onSurveyProgress) {
        onSurveyProgress(sourceSurvey.id, {
          index: nextStepIndex,
          answers: currentAnswers,
          followUpAnswers,
          historyStack: newStack,
          isAnonymous: isCurrentlyAnonymous
        });
      }
    } else {
      finishSurvey(currentAnswers);
    }
  };

  const handlePrevQuestion = () => {
    if (historyStack.length > 0) {
      setSlideDirection('prev');
      const prevIndex = historyStack[historyStack.length - 1];
      const newStack = historyStack.slice(0, -1);
      setHistoryStack(newStack);
      setCurrentQIndex(prevIndex);
      if (onSurveyProgress) {
        onSurveyProgress(sourceSurvey.id, {
          index: prevIndex,
          answers: surveyAnswers,
          followUpAnswers,
          historyStack: newStack,
          isAnonymous: isCurrentlyAnonymous
        });
      }
    } else if (currentQIndex > 0) {
      setSlideDirection('prev');
      setCurrentQIndex(prev => prev - 1);
    }
  };

  const finishSurvey = (finalAnswers: Record<string, any>) => {
    if (survey.type === SurveyType.QUIZ) {
      calculateAndSetScore(finalAnswers);
    }
    setSurveyCompleted(true);

    if (onVote) {
      const allSelectedOptionIds = Object.values(finalAnswers).flat().filter(Boolean) as string[];
      onVote(sourceSurvey.id, allSelectedOptionIds, undefined, isCurrentlyAnonymous);
    }

    if (onSurveyProgress) {
      onSurveyProgress(sourceSurvey.id, {
        index: currentQIndex,
        answers: finalAnswers,
        followUpAnswers,
        historyStack,
        isAnonymous: isCurrentlyAnonymous
      });
    }
    startDemographicFlow();
  };

  const handleDetectOrientation = (url: string, e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.naturalHeight > img.naturalWidth) {
      setPortraitImages(prev => new Set(prev).add(url));
    }
  };

  const isMultiple = sourceSurvey.allowMultipleSelection || false;
  const isRating = sourceSurvey.pollChoiceType === 'rating';
  const hasImages = (localOptions || []).some(opt => opt.image);

  // NEW LOGIC: Any selected option has clarification enabled?
  const hasActiveFollowUp = selectedOptions.some(id => localOptions.find(o => o.id === id)?.withFollowUp);
  const followUpRequiredAndMissing = selectedOptions.some(optId => {
    const opt = localOptions.find(o => o.id === optId);
    return opt?.withFollowUp && (!followUpAnswers[optId] || followUpAnswers[optId].trim() === '');
  });

  // Update participate button logic to include clarifications
  const showParticipateButton = !hasVoted && !isExpired && (isMultiple || (sourceSurvey.allowUserOptions || false) || hasActiveFollowUp);

  const resultsPrivate = sourceSurvey.resultsVisibility === 'Private';
  const shouldShowResults = (hasVoted || isExpired) && !resultsPrivate;
  const totalVotes = (localOptions || []).reduce((acc, curr) => acc + curr.votes, 0);

  const averageRating = useMemo(() => {
    if (!isRating || totalVotes === 0) return 0;
    const totalScore = (localOptions || []).reduce((acc, curr) => {
      const val = curr.ratingValue || 0;
      return acc + (val * curr.votes);
    }, 0);
    return (totalScore / totalVotes).toFixed(1);
  }, [localOptions, isRating, totalVotes]);

  const handlePollOptionClick = (optionId: string) => {
    if (hasVoted || isExpired) return;

    if (isMultiple) {
      setSelectedOptions(prev =>
        prev.includes(optionId)
          ? prev.filter(id => id !== optionId)
          : [...prev, optionId]
      );
    } else {
      setSelectedOptions([optionId]);

      const targetOpt = localOptions.find(o => o.id === optionId);
      // If clarification is needed, we WAIT for the Participate button
      if (!targetOpt?.withFollowUp && !showParticipateButton && onVote) {
        onVote(sourceSurvey.id, [optionId], isCurrentlyAnonymous);
        setHasVoted(true);
        startDemographicFlow();
      }
    }
  };

  const hasAddedCustomOption = useMemo(() => localOptions.some(o => o.id.startsWith('custom-')), [localOptions]);

  const handleAddCustomOption = () => {
    if (!customOptionText.trim() || hasVoted || isExpired || hasAddedCustomOption) return;

    const newOpt: Option = {
      id: `custom-${Date.now()}`,
      text: customOptionText,
      votes: 0
    };

    // Update local state ONLY - do not submit vote yet
    setLocalOptions(prev => [...prev, newOpt]);

    if (isMultiple) {
      setSelectedOptions(prev => [...prev, newOpt.id]);
    } else {
      setSelectedOptions([newOpt.id]);
    }

    setIsAddingCustomOption(false);
    setCustomOptionText('');
  };



  const handleLike = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!userProfile?.id) return;

    const previousLiked = isLiked;
    const nextLiked = !previousLiked;

    setIsLiked(nextLiked);
    setLikeCount(prev => nextLiked ? prev + 1 : prev - 1);

    Analytics.track({
      event_type: nextLiked ? 'LIKE' : 'UNLIKE',
      post_id: sourceSurvey.id,
      actor_user_id: userProfile.id,
      source_surface: sourceSurface,
      position_in_feed: positionInFeed
    });

    if (onLike) {
      // Delegate API call to parent
      onLike(sourceSurvey.id, nextLiked);
    } else {
      // Fallback for isolated cards without parents
      try {
        await api.likeSurvey(sourceSurvey.id, userProfile.id);
      } catch (error) {
        console.error("Failed to like survey", error);
        setIsLiked(previousLiked);
        setLikeCount(prev => previousLiked ? prev + 1 : prev - 1);
      }
    }
  };

  const handleSave = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!userProfile?.id) return;
    setIsMenuOpen(false);
    const previous = isSaved;
    const nextStatus = !previous;
    setIsSaved(nextStatus);
    try {
      const res = await api.savePost(sourceSurvey.id, userProfile.id);
      setIsSaved(res.saved);
      Analytics.track({
        event_type: 'SAVE_TOGGLE',
        post_id: sourceSurvey.id,
        new_state: res.saved,
        actor_user_id: userProfile.id,
        source_surface: sourceSurface,
        position_in_feed: positionInFeed
      });
    } catch (error) {
      console.error(error);
      setIsSaved(previous);
    }
  };

  const handleDeletePost = async () => {
    if (!window.confirm("Are you sure you want to delete this post? This action cannot be undone.")) return;
    try {
      setIsMenuOpen(false);
      await api.deletePost(survey.id, userProfile?.id || '');
      if (onDelete) {
        onDelete(survey.id);
      } else {
        setIsHidden(true);
      }
    } catch (err) {
      console.error('Failed to delete post:', err);
    }
  };

  const handleHide = async () => {
    if (!userProfile?.id) return;
    setIsMenuOpen(false);
    setIsHidden(true);
    Analytics.track({
      event_type: 'HIDE_POST',
      post_id: survey.id,
      actor_user_id: userProfile.id,
      source_surface: sourceSurface
    });
    try {
      await api.hidePost(survey.id, userProfile.id);
    } catch (error) {
      console.error(error);
    }
  };

  const handleReport = async () => {
    if (!userProfile?.id || !reportReason) return;
    setIsReporting(true);
    try {
      await api.reportPost(survey.id, userProfile.id, reportReason, reportDescription);
      setIsReportSheetOpen(false);
      alert("Post reported successfully. Thank you for helping us keep the community safe.");
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : "Failed to report post");
    } finally {
      setIsReporting(false);
      setReportReason('');
      setReportDescription('');
    }
  };

  const handleCopyLink = async () => {
    setIsMenuOpen(false);
    try {
      const shareUrl = `${window.location.origin}/post/${survey.id}`;
      await navigator.clipboard.writeText(shareUrl);
      setShowShareToast(true);
      Analytics.track({
        event_type: 'SHARE_OR_COPY_LINK',
        post_id: survey.id,
        method: 'COPY_LINK',
        actor_user_id: userProfile?.id,
        source_surface: sourceSurface
      });
      setTimeout(() => setShowShareToast(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleAuthorClickInternal = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onAuthorClick && survey.author) {
      onAuthorClick({ id: survey.author.id, name: survey.author.name, avatar: survey.author.avatar });
    }
  };

  const getPercentage = (votes: number) => totalVotes === 0 ? 0 : Math.round((votes / totalVotes) * 100);
  const formatCount = (num: number) => num >= 1000 ? (num / 1000).toFixed(1) + 'K' : num;
  const getTimeAgo = (dateStr: string) => {
    if (!dateStr) return 'Just now';
    const now = new Date();
    const past = new Date(dateStr);
    if (isNaN(past.getTime())) return 'Just now';
    
    const diffInSeconds = Math.floor((now.getTime() - past.getTime()) / 1000);
    if (diffInSeconds < 60) return 'Just now';
    const diffInMinutes = Math.floor(diffInSeconds / 60);
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours}h ago`;
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 7) return `${diffInDays}d ago`;
    const diffInWeeks = Math.floor(diffInDays / 7);
    if (diffInWeeks < 4) return `${diffInWeeks}w ago`;
    const diffInMonths = Math.floor(diffInDays / 30);
    if (diffInMonths < 12) return `${diffInMonths}mo ago`;
    const diffInYears = Math.floor(diffInDays / 365);
    return `${diffInYears}y ago`;
  };

  const getTypeConfig = (type: SurveyType) => {
    switch (type) {
      case SurveyType.POLL: return { icon: PieChart, label: 'Poll', color: 'text-green-600' };
      case SurveyType.SURVEY: return { icon: FileText, label: 'Survey', color: 'text-blue-600' };
      case SurveyType.QUIZ: return { icon: HelpCircle, label: 'Quiz', color: 'text-purple-600' };
      case SurveyType.CHALLENGE: return { icon: Zap, label: 'Challenge', color: 'text-amber-600' };
      case SurveyType.TRENDING: return { icon: PieChart, label: 'Poll', color: 'text-green-600' };
      default: return { icon: FileText, label: 'Survey', color: 'text-blue-600' };
    }
  };

  const typeConfig = getTypeConfig(survey.type);
  const TypeIcon = typeConfig.icon;
  const VisibilityIcon = sourceSurvey.resultsVisibility === 'Private' ? Lock : Globe;

  const authorName = sourceSurvey.author?.name || 'Anonymous';
  const authorAvatar = sourceSurvey.author?.avatar || 'https://picsum.photos/40/40';
  const isMyPost = !!userProfile?.id && survey.author?.id === userProfile.id;
  const isMySource = !!userProfile?.id && sourceSurvey.author?.id === userProfile.id;



  const renderChallengeInteractive = () => {
    if (hasVoted) {
      const winner = localOptions.find(o => selectedOptions.includes(o.id));
      if (!winner) return null;
      return (
        <div className="bg-amber-50 rounded-2xl p-6 text-center border border-amber-100 animate-in zoom-in duration-500">
          <div className="w-16 h-16 bg-amber-600 text-white rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg ring-4 ring-amber-100">
            <Trophy size={32} strokeWidth={2.5} />
          </div>
          <h3 className="text-xl font-black text-gray-900 mb-1">Your Final Choice</h3>
          <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest mb-6">Challenge Completed</p>

          <div className="bg-white p-4 rounded-xl border border-amber-200 shadow-sm flex items-center gap-4 text-left">
            {winner.image && <img src={winner.image} crossOrigin="anonymous" className="w-16 h-16 rounded-lg object-cover" alt="" />}
            <div className="flex-1">
              <h4 className="font-bold text-gray-900 leading-tight">{winner.text}</h4>
              <div className="flex items-center gap-1.5 mt-1 text-green-600 font-bold text-[10px] uppercase">
                <CheckCircle2 size={12} /> Winner
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (challengeActivePair.length < 2) return null;

    const pairOptions = challengeActivePair.map(id => localOptions.find(o => o.id === id)!);
    const totalPossibleEliminations = Math.max(1, localOptions.length - 1);
    const progress = Math.round((challengeEliminatedIds.size / totalPossibleEliminations) * 100);

    return (
      <div className="space-y-4 animate-in fade-in duration-300">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <Shuffle size={12} className="text-amber-600" />
            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Pick your favorite</span>
          </div>
          <span className="text-[10px] font-bold text-gray-500 tabular-nums">Round {challengeEliminatedIds.size + 1}</span>
        </div>

        <div className="grid grid-cols-2 gap-3 relative">
          {pairOptions.map((opt) => {
            if (!opt) return null;
            const isLeaving = isChallengeTransitioning === opt.id;
            const isPortrait = opt.image && portraitImages.has(opt.image);
            return (
              <button
                key={opt.id}
                disabled={isChallengeTransitioning !== null}
                onClick={() => handleChallengeVote(opt.id)}
                className={`relative flex flex-col items-stretch text-left group overflow-hidden rounded-2xl border bg-white transition-all duration-300 ${isLeaving ? 'scale-90 opacity-0 -translate-y-4' : 'hover:border-amber-400 hover:shadow-md active:scale-95 border-gray-100 shadow-sm animate-in zoom-in fade-in'}`}
              >
                <div className="aspect-[4/5] w-full bg-gray-50 relative overflow-hidden">
                  {opt.image ? (
                    <>
                      <img
                        src={opt.image}
                        crossOrigin="anonymous"
                        onLoad={(e) => handleDetectOrientation(opt.image!, e)}
                        className="w-full h-full object-cover transition-transform group-hover:scale-110"
                        alt=""
                      />
                      {isPortrait && (
                        <div
                          className="absolute inset-0 bg-black/10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-zoom-in"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedImageUrl(opt.image!);
                          }}
                        >
                          <Maximize2 size={24} className="text-white drop-shadow-md" />
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-200">
                      <ImageIcon size={32} />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 pointer-events-none" />
                </div>
                <div className="p-3 bg-white flex-1 flex flex-col justify-center border-t border-gray-50 min-h-[60px]">
                  <span className="text-sm font-bold text-gray-800 leading-tight line-clamp-2">{opt.text}</span>
                </div>
              </button>
            );
          })}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-amber-600 text-white flex items-center justify-center font-black text-[10px] border-4 border-white shadow-lg z-10">VS</div>
        </div>

        <div className="px-1">
          <div className="h-1 w-full bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-amber-500 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>
    );
  };

  const renderQuizStartCard = () => (
    <div className="bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-sm mt-3 animate-in zoom-in-95 duration-300">
      <div className="p-8 text-center flex flex-col items-center">
        <div className="w-16 h-16 bg-purple-100 text-purple-600 rounded-[1.5rem] flex items-center justify-center mb-6 shadow-sm">
          <Play size={32} fill="currentColor" className="ml-1" />
        </div>
        <h3 className="text-xl font-black text-gray-900 mb-2">{sourceSurvey.title}</h3>
        <p className="text-sm text-gray-500 mb-8 max-w-xs">{sourceSurvey.description || "Test your knowledge in this challenge."}</p>
        <div className="flex items-center gap-4 mb-8">
          <div className="flex flex-col items-center">
            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Challenges</span>
            <span className="text-lg font-bold text-gray-900">{flatQuestions.length}</span>
          </div>
          <div className="w-px h-6 bg-gray-100" />
          <div className="flex flex-col items-center">
            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Time Limit</span>
            <span className="text-lg font-bold text-gray-900">{sourceSurvey.quizTimeLimit ? `${sourceSurvey.quizTimeLimit}m` : '∞'}</span>
          </div>
        </div>
        <button
          onClick={() => setQuizStarted(true)}
          className="w-full bg-purple-600 text-white py-4 rounded-xl font-black uppercase tracking-widest text-xs shadow-lg shadow-purple-200 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
        >
          Start Quiz <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );

  const renderSurveyInteractive = () => {
    if (!currentQuestion) return null;
    const answer = surveyAnswers[currentQuestion.id];
    const resolvedTitle = resolveDynamicText(currentQuestion.text);
    const isTF = currentQuestion.type === 'true_false';
    const isHorizontal = currentQuestion.imageLayout === 'horizontal' || (!currentQuestion.imageLayout && sourceSurvey.imageLayout === 'horizontal');

    return (
      <div className="bg-white rounded-xl overflow-hidden border border-gray-100 shadow-sm mt-3">
        <div className="bg-gray-50 px-4 py-3 border-b border-gray-100">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-bold text-blue-600 uppercase tracking-wider flex items-center gap-1">
              <FileText size={10} /> {currentQuestion.sectionTitle}
            </span>
            <span className="text-xs font-medium text-gray-400 tabular-nums">
              {currentQIndex + 1} / {totalQuestions}
            </span>
          </div>
          <div className="h-1.5 w-full bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full bg-blue-600 rounded-full transition-all duration-500 ease-out" style={{ width: `${Math.max(5, progressPercentage)}%` }} />
          </div>
        </div>
        <div className="relative overflow-hidden">
          <div key={currentQuestion.id} className={`w-full flex flex-col ${slideDirection === 'next' ? 'animate-in slide-in-from-right-10 fade-in duration-500' : 'animate-in slide-in-from-left-10 fade-in duration-500'}`}>
            <div className="p-5 pb-8 no-scrollbar scroll-smooth">
              {currentQuestion.image && (
                <div className="w-full aspect-square rounded-xl overflow-hidden mb-4 border border-gray-100 shadow-sm">
                  <img src={currentQuestion.image} crossOrigin="anonymous" className="w-full h-full object-cover" alt="Question context" />
                </div>
              )}
              <div className="flex items-start justify-between gap-4 mb-3">
                <h3 className="text-lg font-bold text-gray-900 leading-tight">{resolvedTitle}</h3>
                {survey.type === SurveyType.QUIZ && currentQuestion.weight && (
                  <span className="shrink-0 bg-purple-50 text-purple-600 text-[10px] font-black px-2 py-1 rounded-md border border-purple-100">
                    {currentQuestion.weight} PTS
                  </span>
                )}
              </div>
              <div className="pb-4">
                {currentQuestion.type === 'multiple_choice' || isTF ? (
                  <div className={`${isTF ? 'grid grid-cols-2 gap-3' : isHorizontal ? 'flex gap-3 overflow-x-auto no-scrollbar snap-x pb-2' : 'grid grid-cols-1 space-y-2'}`}>
                    {currentQuestion.options?.map((opt, idx) => {
                      const selectedIds = Array.isArray(answer) ? answer : (answer ? [answer] : []);
                      const isSelected = selectedIds.includes(opt.id);
                      const isMaxReached = !isTF && currentQuestion.maxSelection && (currentQuestion.maxSelection || 1) > 1 && selectedIds.length >= (currentQuestion.maxSelection || 1) && !isSelected;
                      const isPortrait = opt.image && portraitImages.has(opt.image);

                      return (
                        <div key={opt.id} className={`group ${isHorizontal && !isTF ? 'min-w-[51%] snap-center' : ''}`}>
                          <button onClick={() => handleSurveyAnswer(opt.id)} disabled={isMaxReached as boolean} className={`w-full text-left p-3 rounded-xl border transition-all duration-200 flex items-center justify-between active:scale-[0.99] h-auto ${isSelected ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm' : isMaxReached ? 'opacity-50 border-gray-100 bg-gray-50' : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50/30 active:scale-[0.99]'} ${isTF ? 'flex-col gap-2 items-center text-center justify-center py-6' : ''} ${isHorizontal && opt.image ? 'flex-col items-stretch p-1 pb-3' : ''}`}>
                            {opt.image && (
                              <div
                                className={`${isHorizontal ? 'w-full aspect-square mb-3' : 'w-14 h-14 shrink-0 mr-3'} rounded-lg overflow-hidden border border-gray-100 bg-gray-50 relative group/img`}
                                onClick={(e) => {
                                  if (isPortrait) {
                                    e.stopPropagation();
                                    setExpandedImageUrl(opt.image!);
                                  }
                                }}
                              >
                                <img
                                  src={opt.image}
                                  crossOrigin="anonymous"
                                  onLoad={(e) => handleDetectOrientation(opt.image!, e)}
                                  className="w-full h-full object-cover transition-transform group-hover/img:scale-105"
                                  alt=""
                                />
                                {isPortrait && (
                                  <div className="absolute inset-0 bg-black/10 opacity-0 group-hover/img:opacity-100 flex items-center justify-center transition-opacity cursor-zoom-in">
                                    <Maximize2 size={16} className="text-white drop-shadow-sm" />
                                  </div>
                                )}
                              </div>
                            )}
                            <div className={`flex items-center ${isTF || (isHorizontal && opt.image) ? 'flex-col' : 'gap-3'} flex-1`}>
                              {!isTF && !(isHorizontal && opt.image) && !opt.isRating && <span className={`w-6 h-6 rounded-md text-xs font-bold flex items-center justify-center shrink-0 transition-colors ${isSelected ? 'bg-blue-200 text-blue-700' : 'bg-gray-100 text-gray-500 group-hover:bg-white'}`}>{idx + 1}.</span>}

                              {opt.isRating ? (
                                <div className="flex items-center gap-2 py-1">
                                  <div className="flex text-yellow-500">
                                    {Array.from({ length: opt.ratingValue || 0 }).map((_, i) => (
                                      <Star key={i} size={18} fill="currentColor" />
                                    ))}
                                  </div>
                                </div>
                              ) : (
                                <span className={`font-bold ${isTF ? 'text-base' : 'text-sm'} leading-snug break-words uppercase tracking-wide flex-1 ${isHorizontal && opt.image ? 'text-center px-2' : ''}`}>{opt.text}</span>
                              )}
                            </div>
                          </button>
                          {isSelected && opt.withFollowUp && (
                            <div className="mt-2 pl-3 animate-in fade-in slide-in-from-top-1">
                              <label className="text-xs font-bold text-gray-500 ml-1 mb-1 block">{opt.followUpLabel || "Please provide more details:"}</label>
                              <input type="text" value={followUpAnswers[opt.id] || ''} onChange={(e) => handleFollowUpChange(opt.id, e.target.value)} placeholder="Type here..." className="w-full p-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500 focus:bg-white transition-all" />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="animate-in fade-in">
                    <textarea value={answer || ''} onChange={(e) => {
                      const newAnswers = { ...surveyAnswers, [currentQuestion.id]: e.target.value };
                      setSurveyAnswers(newAnswers);
                      if (onSurveyProgress) onSurveyProgress(sourceSurvey.id, { index: currentQIndex, answers: newAnswers, followUpAnswers, historyStack, isAnonymous: isCurrentlyAnonymous });
                    }} placeholder="Type your answer here..." className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm min-h-[120px] resize-none" autoFocus />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="px-5 py-4 border-t border-gray-50 flex items-center justify-between bg-white relative z-10">
          <button onClick={handlePrevQuestion} disabled={currentQIndex === 0 && historyStack.length === 0} className={`flex items-center gap-1 text-sm font-medium transition-colors ${(currentQIndex === 0 && historyStack.length === 0) ? 'text-gray-300 cursor-not-allowed' : 'text-gray-500 hover:text-gray-800'}`}>
            <ChevronLeft size={18} /> Back
          </button>
          <button onClick={() => handleNextQuestion()} disabled={(!answer || (Array.isArray(answer) && answer.length === 0) || (typeof answer === 'string' && !answer.trim())) || (currentQuestion.minSelection && (Array.isArray(answer) ? answer.length : 1) < currentQuestion.minSelection)} className={`px-6 py-2 rounded-full text-sm font-bold text-white transition-all shadow-md flex items-center gap-2 ${(!answer || (Array.isArray(answer) && answer.length === 0) || (typeof answer === 'string' && !answer.trim())) || (currentQuestion.minSelection && (Array.isArray(answer) ? answer.length : 1) < currentQuestion.minSelection) ? 'bg-gray-300 cursor-not-allowed' : 'bg-gray-900 hover:bg-gray-800 active:scale-[0.99]'}`}>{currentQIndex >= totalQuestions - 1 ? 'Finish' : 'Next'} <ArrowRight size={14} /></button>
        </div>
      </div>
    );
  };

  const renderPollStandard = () => {
    const isHorizontal = sourceSurvey.imageLayout === 'horizontal';
    const allowUserOptions = sourceSurvey.allowUserOptions || false;

    const renderHorizontal = () => (
      <div className="flex gap-3 overflow-x-scroll pb-4 snap-x snap-mandatory -mx-4 px-4" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
        {(localOptions || []).map((option) => {
          const isSelected = selectedOptions.includes(option.id);
          const percentage = shouldShowResults ? getPercentage(option.votes) : 0;
          const isPortrait = option.image && portraitImages.has(option.image);
          return (
            <div key={option.id} className={`flex-shrink-0 relative w-[75%] sm:w-[280px] rounded-xl border snap-center overflow-hidden flex flex-col transition-all duration-300 bg-white shadow-sm ${isSelected ? 'ring-2 ring-blue-500 border-blue-500' : 'border-gray-200'}`}>
              <div className="w-full aspect-square bg-gray-100 relative group/opt-img">
                {option.image ? (
                  <>
                    <img
                      src={option.image}
                      crossOrigin="anonymous"
                      onLoad={(e) => handleDetectOrientation(option.image!, e)}
                      alt={option.text}
                      className="w-full h-full object-cover"
                    />
                    {isPortrait && (
                      <div
                        className="absolute inset-0 bg-black/10 opacity-0 group-hover/opt-img:opacity-100 flex items-center justify-center transition-opacity cursor-zoom-in"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedImageUrl(option.image!);
                        }}
                      >
                        <Maximize2 size={24} className="text-white drop-shadow-md" />
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-300">
                    <ImageIcon size={38} />
                  </div>
                )}
                {isSelected && !hasVoted && !isExpired && (
                  <div className="absolute inset-0 bg-blue-500/10 flex items-center justify-center animate-in fade-in duration-200 pointer-events-none">
                    <div className="bg-blue-500 text-white p-2 rounded-full shadow-lg"><CheckCircle2 size={24} /></div>
                  </div>
                )}
              </div>
              <div className="bg-gray-50 p-4 border-t border-gray-100 flex-1 flex flex-col justify-center min-h-[80px]">
                <div className="flex justify-between items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-gray-900 truncate text-base leading-snug">
                      {option.isRating ? (
                        <div className="flex text-yellow-500">
                          {Array.from({ length: option.ratingValue || 0 }).map((_, i) => (
                            <Star key={i} size={14} fill="currentColor" />
                          ))}
                        </div>
                      ) : option.text}
                    </h3>
                    {shouldShowResults && <div className="text-[10px] text-gray-500 mt-1">{option.votes.toLocaleString()} votes</div>}
                  </div>
                  <div className="shrink-0">
                    {!hasVoted && !isExpired ? (
                      <button onClick={() => handlePollOptionClick(option.id)} className={`text-sm font-bold px-6 py-2 rounded-lg transition-colors border shadow-sm active:scale-95 ${isSelected ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-100'}`}>{isSelected && isMultiple ? 'Selected' : 'Vote'}</button>
                    ) : (
                      isSelected ? <div className="flex items-center gap-1 text-blue-600 font-bold text-sm bg-blue-50 px-3 py-1.5 rounded-full"><CheckCircle2 size={16} /> <span>Voted</span></div> : <span className="text-sm text-gray-400 font-bold px-2">{percentage}%</span>
                    )}
                  </div>
                </div>
                {shouldShowResults && <div className="mt-3 animate-in fade-in slide-in-from-bottom-1 duration-500"><div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden"><div className="h-full bg-blue-500 rounded-full transition-all duration-700 ease-out" style={{ width: `${percentage}%` }} /></div></div>}
              </div>

              {/* Horizontal Clarification Question */}
              {isSelected && !hasVoted && option.withFollowUp && (
                <div className="p-4 pt-0 animate-in fade-in slide-in-from-top-1">
                  <label className="text-[11px] font-black text-blue-600 uppercase tracking-widest mb-1.5 block">{option.followUpLabel || "Please explain:"}</label>
                  <textarea
                    value={followUpAnswers[option.id] || ''}
                    onChange={(e) => handleFollowUpChange(option.id, e.target.value)}
                    placeholder="Your response..."
                    className="w-full p-3 text-sm bg-blue-50/50 border border-blue-100 rounded-xl focus:bg-white transition-all min-h-[60px] resize-none"
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    );
    const renderVertical = () => (
      <div className="space-y-2">
        {(localOptions || []).map((option) => {
          const isSelected = selectedOptions.includes(option.id);
          const percentage = shouldShowResults ? getPercentage(option.votes) : 0;
          const isPortrait = option.image && portraitImages.has(option.image);
          return (
            <div key={option.id} className="flex flex-col gap-2">
              <button onClick={() => handlePollOptionClick(option.id)} disabled={hasVoted || isExpired} className={`relative w-full text-left rounded-xl border transition-all duration-300 overflow-hidden group ${hasImages ? 'p-1 pr-3' : 'p-3'} ${hasVoted || isExpired ? isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-100 bg-gray-50' : isSelected ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500/20' : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50/30 active:scale-[0.99]'}`}>
                {shouldShowResults && <div className={`absolute top-0 left-0 bottom-0 transition-all duration-1000 ease-out ${isSelected ? 'bg-blue-100/50' : 'bg-gray-200/50'}`} style={{ width: `${percentage}%` }} />}
                <div className={`relative flex justify-between items-center z-10 ${hasImages ? 'min-h-[44px]' : ''}`}>
                  <div className={`flex items-center overflow-hidden ${hasImages ? 'gap-3' : 'gap-3'}`}>
                    {hasImages && (
                      <div
                        className="w-16 h-16 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center shrink-0 overflow-hidden relative group/opt-img"
                        onClick={(e) => {
                          if (isPortrait) {
                            e.stopPropagation();
                            setExpandedImageUrl(option.image!);
                          }
                        }}
                      >
                        {option.image ? (
                          <>
                            <img
                              src={option.image}
                              crossOrigin="anonymous"
                              onLoad={(e) => handleDetectOrientation(option.image!, e)}
                              alt=""
                              className="w-full h-full object-cover transition-transform group-hover/opt-img:scale-110"
                            />
                            {isPortrait && (
                              <div className="absolute inset-0 bg-black/10 opacity-0 group-hover/opt-img:opacity-100 flex items-center justify-center transition-opacity cursor-zoom-in">
                                <Maximize2 size={14} className="text-white drop-shadow-sm" />
                              </div>
                            )}
                          </>
                        ) : (
                          <ImageIcon size={24} className="text-gray-300" />
                        )}
                      </div>
                    )}

                    {isRating ? (
                      <div className="flex items-center gap-2">
                        <div className="flex text-yellow-500">
                          {Array.from({ length: option.ratingValue || 0 }).map((_, i) => (
                            <Star key={i} size={18} fill="currentColor" />
                          ))}
                        </div>
                      </div>
                    ) : (
                      <span className={`font-medium text-sm truncate ${isSelected ? 'text-blue-700' : 'text-gray-700'} ${hasImages ? 'py-1' : ''}`}>{option.text}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 pl-2 shrink-0">
                    {hasVoted || isExpired ? (shouldShowResults ? <span className="text-xs font-bold text-gray-500">{percentage}%</span> : isSelected && <CheckCircle2 size={16} className="text-blue-600" />) : <div className={`w-4 h-4 rounded-full border-2 transition-colors flex items-center justify-center ${isSelected ? 'border-blue-500 bg-blue-500' : 'border-gray-300 group-hover:border-blue-400 group-hover:bg-blue-400/20'}`}>{isSelected && <div className="w-1.5 h-1.5 bg-white rounded-full" />}</div>}
                  </div>
                </div>
              </button>

              {/* Vertical Clarification Question */}
              {isSelected && !hasVoted && option.withFollowUp && (
                <div className="px-2 pb-3 pt-1 animate-in fade-in slide-in-from-top-1">
                  <div className="p-4 bg-blue-50/50 border border-blue-100 rounded-2xl">
                    <label className="text-[11px] font-black text-blue-600 uppercase tracking-widest mb-2 block">
                      {option.followUpLabel || "Please explain your choice:"}
                    </label>
                    <textarea
                      value={followUpAnswers[option.id] || ''}
                      onChange={(e) => handleFollowUpChange(option.id, e.target.value)}
                      placeholder="Type your response..."
                      className="w-full p-3 text-sm bg-white border border-blue-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 transition-all min-h-[90px] resize-none shadow-sm"
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
    return (
      <div className="mb-4">
        {isHorizontal ? renderHorizontal() : renderVertical()}

        {!hasVoted && !isExpired && allowUserOptions && !hasAddedCustomOption && !isRating && (
          <div className="mt-3">
            {isAddingCustomOption ? (
              <div className="flex gap-2 animate-in slide-in-from-top-1 duration-200">
                <input
                  autoFocus
                  type="text"
                  value={customOptionText}
                  onChange={(e) => setCustomOptionText(e.target.value)}
                  placeholder="Add your own choice..."
                  className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:bg-white focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all"
                  onKeyDown={(e) => e.key === 'Enter' && handleAddCustomOption()}
                />
                <button
                  onClick={handleAddCustomOption}
                  disabled={!customOptionText.trim()}
                  className="bg-blue-600 text-white p-2.5 rounded-xl disabled:opacity-50 shadow-md active:scale-95 transition-all"
                >
                  <Send size={18} />
                </button>
                <button
                  onClick={() => setIsAddingCustomOption(false)}
                  className="bg-gray-100 text-gray-500 p-2.5 rounded-xl hover:bg-gray-200 active:scale-95 transition-all"
                >
                  <X size={18} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setIsAddingCustomOption(true)}
                className="w-full py-2.5 border-2 border-dashed border-gray-100 rounded-xl text-gray-400 font-bold text-xs hover:border-blue-300 hover:text-blue-600 transition-all flex items-center justify-center gap-1.5"
              >
                <Plus size={14} /> Add your own choice
              </button>
            )}
          </div>
        )}

        {showParticipateButton && (
          <button
            onClick={() => {
              if (!hasVoted && onVote) {
                // Identify the newly created custom option to pass to the parent
                const customOpt = localOptions.find(o => o.id.startsWith('custom-') && selectedOptions.includes(o.id));
                onVote(sourceSurvey.id, selectedOptions, isCurrentlyAnonymous, customOpt);
                setHasVoted(true);
                startDemographicFlow();
              }
            }}
            disabled={selectedOptions.length === 0 || followUpRequiredAndMissing}
            className={`w-full mt-4 bg-gray-900 text-white py-3 rounded-xl font-semibold text-sm transition-all shadow-lg shadow-gray-200 ${(selectedOptions.length === 0 || followUpRequiredAndMissing) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-800 active:scale-[0.98]'}`}
          >
            Participate
          </button>
        )}
      </div>
    );
  };

  const renderQuizCompletion = () => {
    const correct = quizStats?.correct || 0;
    const total = quizStats?.total || 1;
    const percentage = (correct / total) * 100;
    const achievementLabel = percentage === 100 ? 'Perfect Score' : percentage >= 70 ? 'Great Job' : 'Nice Effort';

    if (flatQuestions.length > 0) {
      const q = flatQuestions[reviewQIndex];
      const userAnsIds = Array.isArray(surveyAnswers[q.id]) ? surveyAnswers[q.id] : (surveyAnswers[q.id] ? [surveyAnswers[q.id]] : []);
      const isCorrect = q.correctOptionId && userAnsIds.includes(q.correctOptionId);

      return (
        <div className="space-y-4 mt-4 animate-in fade-in duration-500">
          <div className="bg-gray-900 text-white rounded-xl p-3 flex items-center justify-between shadow-lg">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1"><Trophy size={14} className="text-yellow-400" /><span className="text-[10px] font-black uppercase">{correct}/{total} Correct</span></div>
              <div className="w-px h-3 bg-white/20" /><span className="text-[10px] font-bold text-white/70">{Math.round(percentage)}% Accuracy</span>
            </div>
            <span className="text-[10px] font-black uppercase tracking-widest text-purple-400">{achievementLabel}</span>
          </div>
          <div className={`p-4 rounded-2xl border bg-white overflow-hidden transition-all shadow-sm ${isCorrect ? 'border-green-100' : 'border-red-100'}`}>
            <div className="flex justify-between items-center mb-3">
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Question {reviewQIndex + 1} of {flatQuestions.length}</span>
              {isCorrect ? <CheckCircle2 size={16} className="text-green-500" /> : <XCircle size={16} className="text-red-500" />}
            </div>
            {q.image && <div className="w-full aspect-square rounded-xl overflow-hidden mb-4 border border-gray-100 shadow-sm bg-gray-50"><img src={q.image} crossOrigin="anonymous" className="w-full h-full object-cover" alt="Question" /></div>}
            <h5 className={`font-bold text-sm leading-tight mb-4 ${isCorrect ? 'text-green-800' : 'text-red-800'}`}>{q.text}</h5>
            <div className="space-y-2">
              {q.options?.map((opt) => {
                const isUserChoice = userAnsIds.includes(opt.id);
                const isCorrectOpt = q.correctOptionId === opt.id;
                let variantClasses = 'text-gray-400 opacity-60 bg-gray-50/50 border-transparent';
                if (isCorrectOpt) variantClasses = 'border-green-200 bg-green-50 text-green-700 opacity-100 font-bold';
                else if (isUserChoice && !isCorrectOpt) variantClasses = 'border-red-200 bg-red-50 text-red-700 opacity-100 font-bold';
                return (
                  <div key={opt.id} className={`flex items-center gap-3 px-3 py-2 rounded-xl border text-[11px] transition-all ${variantClasses}`}>
                    {opt.image && <div className="w-10 h-10 rounded-lg overflow-hidden border border-gray-100 bg-white shrink-0"><img src={opt.image} crossOrigin="anonymous" className="w-full h-full object-cover" alt="" /></div>}
                    <span className="flex-1 truncate">{opt.text}</span>
                    <div className="shrink-0 flex items-center">{isCorrectOpt && <Check size={12} className="ml-2" strokeWidth={3} />}{isUserChoice && !isCorrectOpt && <div className="w-1.5 h-1.5 bg-red-500 rounded-full ml-2" />}</div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex items-center justify-between px-2 pt-1">
            <button onClick={() => setReviewQIndex(prev => Math.max(0, prev - 1))} disabled={reviewQIndex === 0} className={`p-2 rounded-full transition-colors ${reviewQIndex === 0 ? 'text-gray-200' : 'text-gray-600 hover:bg-gray-100'}`}><ChevronLeft size={24} /></button>
            <div className="flex gap-1">{flatQuestions.map((_, i) => <div key={i} className={`h-1 rounded-full transition-all ${i === reviewQIndex ? 'w-6 bg-purple-600' : 'w-1.5 bg-gray-200'}`} />)}</div>
            <button onClick={() => setReviewQIndex(prev => Math.min(flatQuestions.length - 1, prev + 1))} disabled={reviewQIndex === flatQuestions.length - 1} className={`p-2 rounded-full transition-colors ${reviewQIndex === flatQuestions.length - 1 ? 'text-gray-200' : 'text-gray-600 hover:bg-gray-100'}`}><ChevronRight size={24} /></button>
          </div>
        </div>
      );
    }
    return null;
  };

  const renderSurveyCompletion = () => (
    <div className="bg-blue-50 rounded-xl p-8 text-center border border-blue-100 mt-4 animate-in zoom-in duration-300">
      <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4"><CheckCircle2 size={32} /></div>
      <h3 className="text-lg font-bold text-gray-900 mb-2">{isExpired ? 'Survey Closed' : 'Survey Completed!'}</h3>
      <p className="text-sm text-gray-600 mb-6">{isExpired ? 'This survey has ended.' : 'Thank you for your feedback.'}</p>
      {resultsPrivate ? <div className="inline-flex items-center gap-2 px-4 py-2 bg-white rounded-lg text-xs font-medium text-gray-500 border border-gray-200"><Lock size={12} /> Results are private</div> : <div className="text-sm text-gray-500 italic">Results available on dashboard</div>}
    </div>
  );

  const renderBodyContent = () => {
    if (survey.type === SurveyType.CHALLENGE) {
      return renderChallengeInteractive();
    }
    if (showQuizStartCard) {
      return renderQuizStartCard();
    }
    if (showInteractiveSurvey) {
      return renderSurveyInteractive();
    }
    if ((surveyCompleted || isExpired) && isSurveyMode) {
      return survey.type === SurveyType.QUIZ ? renderQuizCompletion() : renderSurveyCompletion();
    }
    return renderPollStandard();
  };

  const renderDemographicStep = () => {
    if (isDemoSuccess) {
      return (
        <div className="p-4 py-12 space-y-6 text-center animate-in zoom-in duration-300">
          <div className="w-16 h-16 bg-green-50 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm border border-green-100">
            <CheckCircle2 size={32} />
          </div>
          <h4 className="text-xl font-black text-gray-900">Thank you!</h4>
          <p className="text-sm text-gray-500 font-medium leading-relaxed px-4">
            Your information helps us generate more accurate and meaningful insights.
          </p>
        </div>
      );
    }

    const currentAttr = pendingDemoSteps[currentDemoIdx];
    const config = DEM_CONFIG[currentAttr];
    if (!config) return null;

    return (
      <div className="p-4 pb-8 space-y-6 text-center animate-in fade-in slide-in-from-right-4 duration-300">
        <div className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 bg-blue-600 rounded-full" />
              <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest">{config.title}</span>
            </div>
            <span className="text-[10px] font-bold text-gray-400 tabular-nums">Step {currentDemoIdx + 1} of {pendingDemoSteps.length}</span>
          </div>
          <h3 className="text-lg font-bold text-gray-900 leading-tight">
            {config.question}
          </h3>
          <p className="text-[10px] text-gray-400 leading-relaxed font-medium uppercase tracking-wide">
            Your personal data remains anonymized and protected.
          </p>
        </div>

        <div className={`grid gap-3 ${config.options.length > 5 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {config.options.map((opt) => (
            <button
              key={opt}
              onClick={() => handleDemographicSelection(opt)}
              className={`py-4 px-4 bg-white border border-gray-100 rounded-2xl font-bold text-gray-800 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-600 transition-all active:scale-[0.98] shadow-sm text-sm ${opt === 'Prefer not to say' && config.options.length % 2 !== 0 ? 'col-span-2' : ''}`}
            >
              {opt}
            </button>
          ))}
        </div>

        {pendingDemoSteps.length > 1 && (
          <div className="flex items-center justify-center gap-2 pt-2">
            {pendingDemoSteps.map((_, i) => (
              <div key={i} className={`h-1.5 rounded-full transition-all duration-300 ${i === currentDemoIdx ? 'w-6 bg-blue-600' : 'w-1.5 bg-gray-200'}`} />
            ))}
          </div>
        )}
      </div>
    );
  };

  if (isHidden) return null;

  return (
    <>
      <div ref={viewRef} className="bg-white pt-5 pb-2 border-b-8 border-gray-100 animate-in fade-in slide-in-from-bottom-4 duration-500 relative">
        <div className="px-4">
          
          {/* SHARER HEADER (If this is a repost) */}
          {survey.sharedFrom && (
             <div className="mb-3">
               <div
                 className="flex items-center text-gray-500 font-bold text-xs gap-1.5 cursor-pointer hover:text-blue-600 transition-colors mb-2"
                 onClick={(e) => { e.stopPropagation(); if (onAuthorClick && survey.author) onAuthorClick({ id: survey.author.id, name: survey.author.name, avatar: survey.author.avatar }); }}
               >
                 <Repeat size={14} className="text-gray-400" />
                 <span>{survey.author?.name || 'Anonymous'} reposted this</span>
               </div>
               {survey.sharedCaption && <p className="text-gray-900 text-[15px] mb-3 leading-relaxed whitespace-pre-wrap font-normal">{survey.sharedCaption}</p>}
             </div>
          )}

          {/* INNER ORIGINAL POST CONTAINER */}
          <div className={survey.sharedFrom ? "border border-gray-200 rounded-2xl p-4 bg-gray-50/50 overflow-hidden mb-3 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] flex flex-col" : "flex flex-col"}>

            <div className="flex justify-between items-start mb-3">
              <div className="flex items-center gap-3 w-full">
                <div className="flex items-center gap-3 group-hover:opacity-80 transition-opacity flex-1 overflow-hidden" onClick={(e) => {
                  e.stopPropagation();
                  if (onAuthorClick && sourceSurvey.author) {
                    onAuthorClick({ id: sourceSurvey.author.id, name: sourceSurvey.author.name, avatar: sourceSurvey.author.avatar });
                  }
                }}>
                  <div className="relative shrink-0">
                    <div className="relative w-10 h-10 md:w-12 md:h-12 rounded-full overflow-hidden border border-gray-100 shrink-0 cursor-pointer bg-white">
                      <UserAvatar
                        src={authorAvatar}
                        name={authorName}
                        size={48}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    {sourceSurvey.targetGroups && sourceSurvey.targetGroups.length > 0 && (
                      <div className="absolute -bottom-1 -right-1 w-5 h-5 md:w-6 md:h-6 bg-blue-100 rounded-lg flex items-center justify-center border-2 border-white overflow-hidden shadow-sm">
                        <Users size={12} className="text-blue-600" />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <div className="flex items-center flex-wrap gap-x-1.5">
                      <h3 className="font-bold text-gray-900 text-[15px] cursor-pointer hover:underline transition-colors truncate max-w-[140px] leading-tight">{authorName}</h3>
                      {sourceSurvey.targetGroups && sourceSurvey.targetGroups.length > 0 && (
                        <>
                          <span className="text-gray-400 text-sm shrink-0">▸</span>
                          <div className="flex items-center gap-1.5 min-w-0">
                            {(() => {
                              const groupId = sourceSurvey.targetGroups![0];
                              const matchedGroup = contextGroups.find((g: any) => g.id === groupId);
                              return (
                                <span
                                  className="font-bold text-gray-900 text-[15px] hover:underline cursor-pointer truncate max-w-[120px] leading-tight"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (onGroupClick) {
                                      onGroupClick(groupId);
                                    }
                                  }}
                                >
                                  {matchedGroup?.name || 'A Group'}
                                </span>
                              );
                            })()}
                          </div>
                        </>
                      )}
                      {((userProfile?.id !== survey.author?.id) && !survey.sharedFrom) && renderInteractionButton()}
                    </div>
                    <div className="flex items-center flex-wrap gap-y-1 gap-x-1 text-xs text-gray-500 mt-0.5 font-medium">
                      <span>{getTimeAgo(sourceSurvey.createdAt)}</span>
                      <span className="text-gray-300 text-[10px] mx-0.5">•</span>
                      <VisibilityIcon size={12} className="text-gray-400" />
                      <span className="text-gray-300 text-[10px] mx-0.5">•</span>
                      <div className={`flex items-center gap-1 bg-gray-50 px-1.5 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider ${typeConfig.color}`}><TypeIcon size={10} /> <span>{typeConfig.label}</span></div>
                    </div>
                  </div>
                </div>
              </div>
              <button onClick={() => setIsMenuOpen(true)} className="text-gray-400 hover:text-gray-600 p-2 -mr-2 rounded-full hover:bg-gray-50 transition-colors shrink-0"><MoreHorizontal size={20} /></button>
            </div>

          <div className="mb-4">
            <div className="flex items-start gap-2 mb-2">
              <div className="flex-1 min-w-0">
                <h2
                  onClick={onContentClick}
                  className={`font-semibold text-base text-gray-900 leading-tight whitespace-pre-wrap ${onContentClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''} ${!isDetailView ? 'line-clamp-2' : ''}`}
                >
                  <RichTextRenderer text={sourceSurvey.title} inline />
                </h2>
                {!isDetailView && (sourceSurvey.title?.length > 80 || (sourceSurvey.title?.match(/\n/g) || []).length > 1) && (
                  <button onClick={onContentClick} className="text-gray-400 hover:text-gray-700 font-bold text-xs mt-0.5 text-left inline-block">
                    ... See more
                  </button>
                )}
              </div>
              {sourceSurvey.isTrending && <span className="inline-flex items-center gap-1 bg-red-50 text-red-600 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider shrink-0 mt-1"><TrendingUp size={10} /> Hot</span>}
            </div>

            {sourceSurvey.coverImage && <div onClick={onContentClick} className={`w-full rounded-xl overflow-hidden mb-3 bg-gray-100 ${onContentClick ? 'cursor-pointer hover:opacity-95 transition-opacity' : ''}`}><img src={sourceSurvey.coverImage} crossOrigin="anonymous" alt="Cover" className="w-full max-h-[500px] object-cover block" /></div>}

            <div className="relative mb-3">
              <p
                onClick={onContentClick}
                className={`text-gray-600 text-[13px] leading-relaxed whitespace-pre-wrap ${onContentClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''} ${!isDetailView ? 'line-clamp-3' : ''}`}
              >
                <RichTextRenderer text={sourceSurvey.description} />
              </p>
              {!isDetailView && (sourceSurvey.description?.length > 150 || (sourceSurvey.description?.match(/\n/g) || []).length > 2) && (
                <button onClick={onContentClick} className="text-gray-500 hover:text-gray-800 font-bold text-sm mt-0.5 block text-left">
                  ... See more
                </button>
              )}
            </div>
            {renderBodyContent()}
          </div>

          <div className="flex items-center justify-between text-[11px] text-gray-400 font-medium mb-3 px-1 mt-2">
            <div className="flex items-center gap-3">
              <button onClick={() => setIsParticipantsOpen(true)} className="flex items-center gap-1 hover:text-blue-600 transition-colors">
                <Users size={12} />
                <span>{sourceSurvey.participants.toLocaleString()} {survey.type === SurveyType.POLL ? 'votes' : 'responses'}</span>
              </button>
              {isRating && Number(averageRating) > 0 && (
                <div className="flex items-center gap-1 text-yellow-600 bg-yellow-50 px-2 py-0.5 rounded-md border border-yellow-200/60 shadow-sm pt-[3px]">
                  <Star size={11} fill="currentColor" />
                  <span className="font-bold text-[10px] uppercase tracking-widest">{averageRating} Average</span>
                </div>
              )}
              {timeLeftStr && (
                <div className="flex items-center gap-1">
                  {isExpired ? <XCircle size={12} className="text-red-500" /> : <Clock size={12} />}
                  <span className={isExpired ? 'text-red-500 font-bold' : ''}>{timeLeftStr}</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              {sourceSurvey.forceAnonymous ? (
                <button
                  onClick={() => setIsAnonInfoOpen(true)}
                  className="flex items-center gap-1 text-gray-500 hover:text-blue-600 transition-colors font-bold uppercase tracking-widest text-[9px]"
                >
                  <Lock size={10} />
                  <span>Anonymous responses</span>
                </button>
              ) : (sourceSurvey.allowAnonymous && !hasVoted && !isExpired ? (
                <div className="flex items-center gap-2 cursor-pointer" onClick={() => setIsAnonToggled(!isAnonToggled)}>
                  <span className="text-[9px] font-bold uppercase tracking-widest text-gray-500">Anonymous</span>
                  <button
                    className={`w-7 h-4 rounded-full relative transition-colors ${isAnonToggled ? 'bg-blue-600' : 'bg-gray-200'}`}
                    title="Respond Anonymously"
                  >
                    <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${isAnonToggled ? 'left-3.5' : 'left-0.5'}`} />
                  </button>
                </div>
              ) : null)}
            </div>
          </div>
         </div>
        </div>
        <div className="border-t border-gray-100 mt-2 px-2 pt-2 pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <button onClick={handleLike} className={`flex flex-col items-center justify-center gap-1 py-1.5 min-w-[50px] rounded-lg transition-all active:scale-95 group ${isLiked ? 'text-blue-600' : 'text-gray-500 hover:bg-gray-50'}`}>
                <ThumbsUp size={18} fill={isLiked ? "currentColor" : "none"} strokeWidth={2} className={`transition-transform duration-300 ${isLiked ? 'scale-110 text-blue-600' : 'group-hover:scale-110'}`} />
                <span className={`text-[10px] font-semibold ${isLiked ? 'text-blue-600' : 'text-gray-500'}`}>{likeCount > 0 ? formatCount(likeCount) : 'Like'}</span>
              </button>
            </div>
            {survey.allowComments !== false && (
              <button onClick={(e) => { e.stopPropagation(); setIsCommentsOpen(true); }} className="flex flex-col items-center justify-center gap-1 py-1.5 min-w-[50px] rounded-lg text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-all active:scale-95 group">
                <MessageCircle size={18} strokeWidth={2} className="group-hover:scale-110 transition-transform" />
                <span className="text-[10px] font-semibold">{commentsCount > 0 ? formatCount(commentsCount) : 'Comment'}</span>
              </button>
            )}
            <button onClick={(e) => { e.stopPropagation(); setIsRepostMenuOpen(true); }} className="flex flex-col items-center justify-center gap-1 py-1.5 min-w-[50px] rounded-lg text-gray-500 hover:bg-gray-50 hover:text-green-600 transition-all active:scale-95 group">
              <Repeat size={18} strokeWidth={2} className="group-hover:scale-110 transition-transform group-hover:text-green-600" />
              <span className="text-[10px] font-semibold group-hover:text-green-600">Repost</span>
            </button>
            <button onClick={(e) => { e.stopPropagation(); setIsShareSheetOpen(true); }} className="flex flex-col items-center justify-center gap-1 py-1.5 min-w-[50px] rounded-lg text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-all active:scale-95 group">
              <Share2 size={18} strokeWidth={2} className="group-hover:scale-110 transition-transform" />
              <span className="text-[10px] font-semibold">Share</span>
            </button>
            <button onClick={(e) => { e.stopPropagation(); onAnalysisClick && onAnalysisClick(); }} className="flex flex-col items-center justify-center gap-1 py-1.5 min-w-[50px] rounded-lg text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-all active:scale-95 group">
              <BarChart3 size={18} strokeWidth={2} className="group-hover:scale-110 transition-transform" />
              <span className="text-[10px] font-semibold">Analysis</span>
            </button>
          </div>
        </div>
        {showShareToast && <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-4 py-2 rounded-full text-xs font-medium shadow-lg animate-in fade-in zoom-in duration-200 z-10">Link copied!</div>}
      </div >

      {/* Lightbox for option images - only for portrait images */}
      {
        expandedImageUrl && (
          <div className="fixed inset-0 z-[200] bg-black/95 backdrop-blur-sm flex flex-col items-center justify-center p-4 animate-in fade-in duration-300">
            <button
              onClick={() => setExpandedImageUrl(null)}
              className="absolute top-6 right-6 p-3 bg-white/10 hover:bg-white/20 text-white rounded-full transition-all active:scale-90"
            >
              <X size={28} strokeWidth={3} />
            </button>
            <div className="w-full max-w-sm aspect-square relative animate-in zoom-in-95 duration-500">
              <img
                src={expandedImageUrl}
                crossOrigin="anonymous"
                className="w-full h-full object-contain rounded-2xl shadow-2xl"
                alt="Expanded Preview"
              />
            </div>
            <p className="mt-8 text-white/40 text-[10px] font-black uppercase tracking-[0.3em]">Image Preview</p>
          </div>
        )
      }

      <BottomSheet isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)}>
        <div className="space-y-1">
          <button onClick={handleSave} className="w-full flex items-center gap-4 p-3.5 hover:bg-gray-50 rounded-xl transition-colors text-left group">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isSaved ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-700'} group-hover:bg-gray-200`}>
              <Bookmark size={22} strokeWidth={1.5} fill={isSaved ? "currentColor" : "none"} />
            </div>
            <div>
              <div className="font-semibold text-gray-900 text-sm">{isSaved ? 'Unsave' : 'Save'}</div>
              <div className="text-xs text-gray-500">{isSaved ? 'Remove from saved' : 'Save for later'}</div>
            </div>
          </button>

          <button onClick={handleCopyLink} className="w-full flex items-center gap-4 p-3.5 hover:bg-gray-50 rounded-xl transition-colors text-left group">
            <div className="w-10 h-10 rounded-full bg-gray-100 text-gray-700 flex items-center justify-center group-hover:bg-gray-200">
              <LinkIcon size={22} strokeWidth={1.5} />
            </div>
            <div>
              <div className="font-semibold text-gray-900 text-sm">Copy link</div>
              <div className="text-xs text-gray-500">Copy link to clipboard</div>
            </div>
          </button>

          <hr className="my-2 border-gray-100" />

          {isMyPost && (
            <button onClick={handleDeletePost} className="w-full flex items-center gap-4 p-3.5 hover:bg-red-50 rounded-xl transition-colors text-left group">
              <div className="w-10 h-10 rounded-full bg-red-100 text-red-600 flex items-center justify-center group-hover:bg-red-200">
                <Trash2 size={22} strokeWidth={1.5} />
              </div>
              <div>
                <div className="font-semibold text-red-600 text-sm">Delete Post</div>
                <div className="text-xs text-red-400">Permanently remove this post</div>
              </div>
            </button>
          )}

          {!isMySource && (
            <button onClick={handleFollowInteraction} className="w-full flex items-center gap-4 p-3.5 hover:bg-gray-50 rounded-xl transition-colors text-left group">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isInteracted ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'} group-hover:bg-gray-200`}>
                {isInteracted ? <UserMinus size={22} strokeWidth={1.5} /> : <UserPlus size={22} strokeWidth={1.5} />}
              </div>
              <div>
                <div className="font-semibold text-gray-900 text-sm">{isInteracted ? `Unfollow ${authorName}` : `Follow ${authorName}`}</div>
                <div className="text-xs text-gray-500">{isInteracted ? 'Stop seeing posts from this author' : 'Stay updated with this author'}</div>
              </div>
            </button>
          )}

          <button onClick={handleHide} className="w-full flex items-center gap-4 p-3.5 hover:bg-gray-50 rounded-xl transition-colors text-left group">
            <div className="w-10 h-10 rounded-full bg-gray-100 text-gray-700 flex items-center justify-center group-hover:bg-gray-200">
              <EyeOff size={22} strokeWidth={1.5} />
            </div>
            <div>
              <div className="font-semibold text-gray-900 text-sm">Hide</div>
              <div className="text-xs text-gray-500">I don't want to see this</div>
            </div>
          </button>

          <button onClick={() => { setIsMenuOpen(false); setIsReportSheetOpen(true); }} className="w-full flex items-center gap-4 p-3.5 hover:bg-gray-50 rounded-xl transition-colors text-left group">
            <div className="w-10 h-10 rounded-full bg-gray-100 text-gray-700 flex items-center justify-center group-hover:bg-gray-200">
              <Flag size={22} strokeWidth={1.5} />
            </div>
            <div>
              <div className="font-semibold text-gray-900 text-sm">Report</div>
              <div className="text-xs text-gray-500">I'm concerned about this post</div>
            </div>
          </button>
        </div>
      </BottomSheet>

      <BottomSheet isOpen={isReportSheetOpen} onClose={() => setIsReportSheetOpen(false)} title="Report Post">
        <div className="p-4 space-y-4">
          <p className="text-sm text-gray-500 mb-4">Why are you reporting this post?</p>
          <div className="space-y-2">
            {['Inappropriate content', 'Spam', 'Harassment', 'False information', 'Copyright violation', 'Other'].map(r => (
              <button
                key={r}
                onClick={() => setReportReason(r)}
                className={`w-full p-4 rounded-xl border text-left text-sm font-bold transition-all ${reportReason === r ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-100 hover:bg-gray-50'}`}
              >
                {r}
              </button>
            ))}
          </div>
          {reportReason === 'Other' && (
            <textarea
              value={reportDescription}
              onChange={(e) => setReportDescription(e.target.value)}
              placeholder="Tell us more..."
              className="w-full p-4 bg-gray-50 border border-gray-100 rounded-xl text-sm min-h-[100px] focus:outline-none focus:border-blue-500"
            />
          )}
          <button
            disabled={!reportReason || isReporting}
            onClick={handleReport}
            className={`w-full py-4 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-lg transition-all active:scale-95 ${!reportReason || isReporting ? 'bg-gray-200 text-gray-400' : 'bg-red-600 text-white shadow-red-100'}`}
          >
            {isReporting ? 'Reporting...' : 'Submit Report'}
          </button>
        </div>
      </BottomSheet>
      <BottomSheet isOpen={isCommentsOpen} onClose={() => setIsCommentsOpen(false)} customLayout={true} title={`Comments (${commentsCount})`}>
        <CommentsSheet
          surveyId={sourceSurvey.id}
          userProfile={userProfile}
          onAuthorClick={onAuthorClick}
          sourceSurface={sourceSurface}
          onCommentAdded={() => setCommentsCount(prev => prev + 1)}
        />
      </BottomSheet>
      <BottomSheet isOpen={isShareSheetOpen} onClose={() => { setIsShareSheetOpen(false); setShareSheetInitialStep('menu'); }}>
        <ShareSheet
          survey={survey}
          onClose={() => { setIsShareSheetOpen(false); setShareSheetInitialStep('menu'); }}
          onShareToFeed={onShareToFeed}
          userProfile={userProfile}
          sourceSurface={sourceSurface}
          initialStep={shareSheetInitialStep}
        />
      </BottomSheet>
      <BottomSheet isOpen={isRepostMenuOpen} onClose={() => setIsRepostMenuOpen(false)} customLayout={false}>
        <div className="p-2 space-y-1">
          <button onClick={() => {
             setIsRepostMenuOpen(false);
             if (onShareToFeed) onShareToFeed(survey, '');
          }} className="w-full flex items-center gap-4 p-4 hover:bg-gray-50 rounded-xl transition-colors text-left group">
            <div className="w-10 h-10 rounded-full bg-green-50 text-green-600 flex items-center justify-center group-hover:bg-green-100 transition-colors">
               <Repeat size={22} strokeWidth={1.5} />
            </div>
            <div>
              <div className="font-bold text-gray-900 text-[15px]">Repost</div>
              <div className="text-xs text-gray-500 font-normal mt-0.5">Instantly share to your feed</div>
            </div>
          </button>

          <button onClick={() => {
             setIsRepostMenuOpen(false);
             setShareSheetInitialStep('repost-editor');
             setIsShareSheetOpen(true);
          }} className="w-full flex items-center gap-4 p-4 hover:bg-gray-50 rounded-xl transition-colors text-left group">
            <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center group-hover:bg-blue-100 transition-colors">
               <Edit3 size={22} strokeWidth={1.5} />
            </div>
            <div>
              <div className="font-bold text-gray-900 text-[15px]">Quote</div>
              <div className="text-xs text-gray-500 font-normal mt-0.5">Add a comment before sharing</div>
            </div>
          </button>
        </div>
      </BottomSheet>
      <BottomSheet isOpen={isParticipantsOpen} onClose={() => setIsParticipantsOpen(false)} customLayout={true} title="Participants" height="90dvh"><ParticipantsSheet survey={sourceSurvey} onAuthorClick={onAuthorClick} /></BottomSheet>
      <BottomSheet isOpen={isAnonInfoOpen} onClose={() => setIsAnonInfoOpen(false)} title="Anonymous Responses">
        <div className="p-4 space-y-6 text-center">
          <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto shadow-sm">
            <Shield size={32} />
          </div>
          <div className="space-y-2">
            <h4 className="text-lg font-black text-gray-900 leading-tight">Your privacy is protected</h4>
            <p className="text-sm text-gray-600 leading-relaxed">
              Your identity will not be visible to the post creator or other users.
            </p>
          </div>
          <div className="bg-gray-50 p-4 rounded-xl text-left border border-gray-100">
            <p className="text-xs text-gray-500 leading-relaxed font-medium">
              We may still use anonymized data to ensure fair participation and prevent abuse, but your personal profile details are never linked to your response publicly.
            </p>
          </div>
          <button
            onClick={() => setIsAnonInfoOpen(false)}
            className="w-full py-4 bg-gray-900 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] active:scale-95 transition-all shadow-lg shadow-gray-200"
          >
            Got it
          </button>
        </div>
      </BottomSheet>

      {/* Unified Demographic Collection Flow */}
      <BottomSheet
        isOpen={isDemographicSheetOpen}
        onClose={() => !isDemoSuccess && setIsDemographicSheetOpen(false)}
        title="Help Us Improve"
      >
        {renderDemographicStep()}
      </BottomSheet>

      <LikersSheet
        isOpen={isLikersSheetOpen}
        onClose={() => setIsLikersSheetOpen(false)}
        targetId={sourceSurvey.id}
        type="post"
        onAuthorClick={onAuthorClick}
      />
    </>
  );
};
