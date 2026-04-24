
import React from 'react';

export enum SurveyType {
  POLL = 'Poll',
  SURVEY = 'Survey',
  TRENDING = 'Trending',
  QUIZ = 'Quiz',
  CHALLENGE = 'Challenge',
}

export type AccountType = 'Personal' | 'Business' | 'Group';

export interface UserProfile {
  id?: string; // Added id
  name: string;
  handle: string;
  avatar: string;
  bio: string;
  location: string;
  website: string;
  email: string;
  phone: string;
  language: string;
  birthday?: string;
  country?: string;
  isPrivate?: boolean;
  groupPrivacy?: 'Public' | 'Followers' | 'Off';
  demographics?: {
    gender?: string;
    ageGroup?: string;
    maritalStatus?: string;
    education?: string;
    employment?: string;
    industry?: string;
    sector?: string;
    nationality?: string;
  };
  stats: {
    followers: number;
    following: number;
    posts?: number;
    responses?: number; // Total interactions received on user's posts
  };
}

export interface GroupPermissions {
  canViewMembers: boolean;
  canManageSettings: boolean;
  canPost: boolean;
}

export type MembershipStatus = 'JOINED' | 'NOT_JOINED' | 'PENDING' | 'INVITED';

export interface Group {
  id: string;
  name: string;
  description: string;
  category: string;
  isPublic: boolean;
  members: number; // legacy
  role: 'Owner' | 'Admin' | 'Moderator' | 'Member';
  permissions?: GroupPermissions; // Added for new permission checks
  image?: string;
  createdAt: string;
  // Settings
  joinPolicy?: 'OPEN' | 'REQUEST' | 'INVITE_ONLY';
  postingPermissions?: 'AdminsOnly' | 'AllMembers' | 'ApprovalNeeded';
}

export interface LogicRule {
  triggerQuestionId: string;
  operator: 'equals' | 'not_equals' | 'contains';
  value: string;
}

export interface Option {
  id: string; // Server persisted UUID
  text: string;
  votes: number;
  image?: string; // URL for the option image

  // Logic
  jumpToQuestionId?: string; // Skip Logic
  isTerminal?: boolean; // Early Termination
  withFollowUp?: boolean; // Conditional Follow-up Input
  followUpLabel?: string; // Label for the input

  // Rating Specific
  isRating?: boolean;
  ratingValue?: number;
}

export interface DraftOption extends Omit<Option, 'votes'> {
  id: string; // Temporary client string or UUID
  votes?: number;
}

export interface Comment {
  id: string;
  userId?: string; // Expected by backend
  authorId?: string; // Used occasionally by UI requests
  author: {
    id?: string;
    name: string;
    avatar: string;
  };
  text: string;
  timestamp: string;
  likes: number;
  isLiked?: boolean;
  replies?: Comment[];
}

export interface SurveyQuestion {
  id: string;
  text: string;
  type: 'text' | 'multiple_choice' | 'true_false';
  options?: Option[];
  image?: string; // Question-level image
  imageLayout?: 'vertical' | 'horizontal';

  // Constraints
  minSelection?: number;
  maxSelection?: number;
  allowUserOptions?: boolean;

  // Logic
  isRequired?: boolean;
  requiredRule?: LogicRule;

  // Quiz Specific
  weight?: number; // 0 to 100
  correctOptionId?: string;
}

export interface SurveySection {
  id: string;
  title: string;
  questions: SurveyQuestion[];
  displayCondition?: LogicRule;
}

export interface UserProgress {
  currentQuestionIndex: number;
  answers: Record<string, any>;
  followUpAnswers?: Record<string, string>;
  historyStack?: number[];
  isAnonymous?: boolean;
}

export interface Survey {
  id: string;
  title: string;
  description: string;
  type: SurveyType;
  pollChoiceType?: 'multiple' | 'rating';
  question?: string;
  options?: Option[];
  participants: number;
  timeLeft?: string;
  expiresAt?: string;
  isTrending: boolean;
  status: 'PUBLISHED' | 'DRAFT';
  createdAt?: string;
  author: {
    id: string; // Added id
    name: string;
    avatar: string;
    type?: AccountType;
    isFollowing?: boolean; // Added isFollowing
  };
  hasParticipated?: boolean;
  userSelectedOptions?: string[];

  // Interaction stats
  likes: number;
  commentsCount: number;
  repostCount?: number;
  hasReposted?: boolean;
  isLiked?: boolean;
  isSaved?: boolean;
  coverImage?: string; // Normalized UI field
  image?: string; // Legacy API field mapping
  targetAudience?: 'Public' | 'Followers' | 'Groups' | 'Custom Audience' | 'Custom Domain';
  targetGroups?: string[]; // IDs of groups if 'Groups' is selected

  // New granular visibility
  resultsWho?: 'Public' | 'Followers' | 'Participants' | 'OnlyMe';
  resultsDetail?: 'Overall' | 'Detailed';
  resultsTiming?: 'AnyTime' | 'Immediately' | 'AfterEnd';

  resultsVisibility?: 'Public' | 'Private'; // Legacy fallback
  allowUserOptions?: boolean;
  allowMultipleSelection?: boolean;
  allowComments?: boolean;
  allowAnonymous?: boolean;
  forceAnonymous?: boolean; // New field: Mandatory anonymity
  category?: string;
  isDraft?: boolean;
  currentStep?: number;

  // Group Association
  groupId?: string;

  // Reposting Fields
  sharedFrom?: Survey; // Reference to original survey
  sharedCaption?: string; // User's custom text when sharing

  // Layout Config
  imageLayout?: 'vertical' | 'horizontal';

  // Survey Specific Fields
  demographics?: string[];
  sections?: SurveySection[];
  userProgress?: UserProgress;

  // Quiz Specific Fields
  quizTimeLimit?: number; // in minutes

  // Challenge Specific
  randomPairing?: boolean;
}

export interface Notification {
  id: string;
  type: 'vote' | 'response' | 'result' | 'following_post' | 'group_invite' | 'expiry' | 'milestone';
  actor: {
    id?: string;
    name: string;
    avatar?: string;
  };
  message: string;
  timestamp: string;
  isRead: boolean;
  targetId?: string;
  targetType?: 'survey' | 'profile' | 'group';
}

export interface TabItem {
  id: 'home' | 'search' | 'add' | 'trends' | 'profile' | 'notifications';
  icon: React.FC<any>;
}

export const normalizeSurvey = (raw: any): Survey => {
  if (!raw) return raw as Survey;

  // 1) Cover image mapping
  const coverImage = raw.coverImage ?? raw.image ?? undefined;

  // 2) Author identity mapping safely
  const author = raw.author ? {
    id: raw.author.id ?? raw.authorId ?? '',
    name: raw.author.name ?? 'Unknown',
    avatar: raw.author.avatar ?? '',
    type: raw.author.type,
    isFollowing: raw.author.isFollowing
  } : {
    id: raw.authorId ?? '',
    name: 'Unknown',
    avatar: ''
  };

  // 3) Poll options mapping preserving DB UUIDs
  let options = raw.options ?? [];
  if (Array.isArray(options)) {
    options = options.map((opt: any, idx: number) => ({
      ...opt,
      id: String(opt.id ?? `${raw.id || 'poll'}-opt-${idx}`),
    }));
  }

  // 4) Arrays parsing safely mapping stringified DB states
  const parseArray = (val: any) => {
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') {
      try { return JSON.parse(val); } catch { return []; }
    }
    return undefined;
  };

  // 5) Map Quiz evaluation keys safely since the backend drops correctOptionId
  const sections = raw.sections?.map((sec: any) => ({
    ...sec,
    questions: sec.questions?.map((q: any) => {
      const correctOpt = q.options?.find((o: any) => o.isCorrect === true);
      return {
        ...q,
        correctOptionId: correctOpt ? correctOpt.id : q.correctOptionId
      };
    })
  }));

  const sharedFrom = raw.sharedFrom ? normalizeSurvey(raw.sharedFrom) : undefined;

  return {
    ...raw,
    sections: sections ?? raw.sections,
    coverImage,
    image: coverImage,
    author,
    options,
    sharedFrom,
    sharedCaption: raw.sharedCaption,
    participants: raw.participants ?? raw.responseCount ?? 0,
    likes: raw.likes ?? raw.likesCount ?? 0,
    commentsCount: raw.commentsCount ?? 0,
    repostCount: raw.repostCount ?? raw.sharesCount ?? 0,
    hasReposted: raw.hasReposted ?? false,
    targetGroups: parseArray(raw.targetGroups),
    demographics: parseArray(raw.demographics),
    allowAnonymous: raw.allowAnonymous === true || raw.allowAnonymous === 'true' || raw.allowAnonymous === '1',
    allowComments: raw.allowComments !== false && raw.allowComments !== 'false' && raw.allowComments !== '0',
    allowMultipleSelection: raw.allowMultipleSelection === true || raw.allowMultipleSelection === 'true' || raw.allowMultipleSelection === '1',
    allowUserOptions: raw.allowUserOptions === true || raw.allowUserOptions === 'true' || raw.allowUserOptions === '1',
  } as Survey;
};
