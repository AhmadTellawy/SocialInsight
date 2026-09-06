
import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  X, Image as ImageIcon, Plus, Trash2, Globe, Users,
  AlertCircle, Clock, Calendar, ChevronDown, List, Info,
  Lock, Camera, Save, BarChart3, Check, ChevronRight,
  UserCircle, Target, Link2, Shuffle, Zap, MoreHorizontal,
  ArrowUp, ArrowDown, MessageSquare, Settings2, ArrowLeft, Tag
} from 'lucide-react';
import { Survey, SurveyType, UserProfile, Group, MediaDraft } from '../types';
import { useTranslation } from 'react-i18next';
import { BottomSheet } from './BottomSheet';
import { PostVisibilitySection } from './PostVisibilitySection';
import { RichMentionInput } from './RichMentionInput';
import { api } from '../services/api';
import { MediaPicker, MediaPickerHandle } from './media/MediaPicker';
import { MediaImage } from './media/MediaImage';
import { cancelTemporaryMediaDrafts, createPersistedMediaDraft, createPersistedMediaDraftFromId, mediaDraftsAreReady, mediaDraftsHaveErrors, readyMediaAssetIds } from '../utils/mediaDrafts';
import { AnswerTypeSelector } from './options/AnswerTypeSelector';
import { OptionImagePicker } from './options/OptionImagePicker';
import { draftOptionHasImage, resolveOptionPresentation } from '../utils/optionPresentation';
import { PeopleTagPicker, PeopleTagPerson } from './PeopleTagPicker';

interface CreateChallengeScreenProps {
  onClose: () => void;
  onSubmit: (surveyData: Partial<Survey>) => void | Promise<void>;
  onSaveDraft?: (surveyData: Partial<Survey>) => void | Promise<void>;
  userProfile: UserProfile;
  draft?: Survey;
  userGroups?: Group[];
  initialGroupId?: string | null;
}

const CHALLENGE_CATEGORIES = [
  "Entertainment", "Sports", "Gaming", "Tech & Gadgets", "Food & Drink",
  "Fashion", "Travel", "Movies & TV", "Music", "Automotive", "Other"
];

const DEMOGRAPHIC_OPTIONS = [
  { id: 'gender', label: 'Gender', desc: 'Understand response patterns by gender' },
  { id: 'maritalStatus', label: 'Marital Status', desc: 'Identify trends based on marital status' },
  { id: 'residence', label: 'Country of Residence', desc: 'Analyze responses by participants country of residence' },
  { id: 'nationality', label: 'Nationality', desc: 'Analyze by responses by Nationality' },
  { id: 'ageGroup', label: 'Age Group', desc: 'Compare responses across age groups' },
  { id: 'education', label: 'Education Level', desc: 'Analyze responses by education level' },
  { id: 'household', label: 'Household Size', desc: 'Understand patterns based on household size' },
  { id: 'familyRole', label: 'Family Role', desc: 'Explore insights based on family role' },
  { id: 'employment', label: 'Employment Type', desc: 'Analyze responses by employment type' },
  { id: 'sector', label: 'Employment Sector', desc: 'Analyze responses by employment sector' },
  { id: 'industry', label: 'Industry / Field of Work', desc: 'Identify trends across different industries' },
  { id: 'occupation', label: 'Occupation', desc: 'Analyze response differences by occupation' },
];

const DURATION_OPTIONS = [
  { label: 'None', value: 'none' },
  { label: '1 Hour', value: '1h' },
  { label: '24 Hours', value: '24h' },
  { label: '3 Days', value: '3d' },
  { label: '1 Week', value: '1w' },
  { label: '1 Month', value: '1m' },
];

type VisibilityType = '' | 'Public' | 'Groups' | 'Custom Audience' | 'Custom Domain' | 'ProfileAndGroups';
type ChallengeDraftOption = {
  id: string;
  text: string;
  image: string | null;
  imageMediaId?: string;
  mediaDrafts: MediaDraft[];
  withFollowUp?: boolean;
  followUpLabel?: string;
};

const createChallengeOption = (): ChallengeDraftOption => ({
  id: `challenge-option-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  text: '',
  image: null,
  mediaDrafts: []
});

export const CreateChallengeScreen: React.FC<CreateChallengeScreenProps> = ({ onClose, onSubmit, onSaveDraft, userProfile, draft, userGroups = [], initialGroupId }) => {
  const { t } = useTranslation();
  const [visibility, setVisibility] = useState<VisibilityType>(initialGroupId ? 'Groups' : 'Public');
  const [isAdvancedSheetOpen, setIsAdvancedSheetOpen] = useState(false);
  const [advancedSheetView, setAdvancedSheetView] = useState<'main' | 'results'>('main');
  const [isCategorySheetOpen, setIsCategorySheetOpen] = useState(false);

  // Detailed Visibility
  const [resultsWho, setResultsWho] = useState<'Public' | 'Followers' | 'Participants' | 'OnlyMe'>('Public');
  const [resultsTiming, setResultsTiming] = useState<'AnyTime' | 'Immediately' | 'AfterEnd'>('AnyTime');

  const [category, setCategory] = useState<string>('');
  const [legacyCoverImage, setLegacyCoverImage] = useState<string | null>(null);
  const [postMedia, setPostMedia] = useState<MediaDraft[]>([]);
  const [mediaAspectRatio, setMediaAspectRatio] = useState<number | undefined>(undefined);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [composerStep, setComposerStep] = useState<1 | 2>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleExit = () => {
    if (title.trim() || options.some(o => o.text.trim()) || postMedia.length > 0 || legacyCoverImage) {
      setShowExitConfirm(true);
    } else {
      onClose();
    }
  };

  const handleDiscard = async () => {
    await Promise.all([
      cancelTemporaryMediaDrafts(postMedia),
      ...options.map((option) => cancelTemporaryMediaDrafts(option.mediaDrafts))
    ]);
    if (!userProfile?.id) {
      onClose();
      return;
    }
    if (draft && draft.id && draft.isDraft) {
      try {
        await api.deletePost(draft.id, userProfile.id);
      } catch (e) {
        console.error("Failed to delete draft", e);
      }
    }
    onClose();
  };

  const handleSaveDraft = async () => {
    if (!userProfile?.id) {
      onClose();
      return;
    }
    const allMedia = [...postMedia, ...activeOptionMediaDrafts];
    if (!mediaDraftsAreReady(allMedia) || mediaDraftsHaveErrors(allMedia)) {
      alert('Please finish or remove image uploads before saving.');
      return;
    }
    if (onSaveDraft) {
      const draftData: Partial<Survey> = {
        id: draft?.id,
        title,
        description: '',
        type: SurveyType.CHALLENGE,
        optionPresentation,
        showOptionNames,
        author: { id: userProfile.id, name: userProfile.name, avatar: userProfile.avatar },
        options: options.map(o => ({
          id: o.id,
          text: o.text,
          votes: 0,
          image: optionPresentation === 'image' && o.mediaDrafts.length === 0 ? (o.image || undefined) : undefined,
          imageMediaId: optionPresentation === 'image' ? readyMediaAssetIds(o.mediaDrafts)[0] : undefined,
          withFollowUp: o.withFollowUp,
          followUpLabel: o.followUpLabel
        })),
        coverImage: postMedia.length > 0 ? undefined : (legacyCoverImage || undefined),
        mediaAssetIds: readyMediaAssetIds(postMedia),
        mediaAspectRatio: postMedia.length > 0 ? mediaAspectRatio : undefined,
        targetAudience: visibility as any,
        targetGroups: (visibility === 'Groups' || visibility === 'ProfileAndGroups') ? selectedGroups : [],
        taggedUserIds: taggedPeople.map((person) => person.id),
        resultsWho,
        resultsTiming,
        category,
        allowComments,
        allowAnonymous: true,
        forceAnonymous: forceAnonymous,
        randomPairing,
        demographics: selectedDemographics,
        expiresAt: getExpiresAt(),
        createdAt: new Date().toISOString(),
        status: 'DRAFT',
        isDraft: true,
        currentStep: 1
      };
      await onSaveDraft(draftData);
      if (optionPresentation === 'text') {
        await cancelTemporaryMediaDrafts(options.flatMap((option) => option.mediaDrafts));
      }
    }
    onClose();
  };

  const [title, setTitle] = useState('');
  const [taggedPeople, setTaggedPeople] = useState<PeopleTagPerson[]>([]);
  const [optionPresentation, setOptionPresentation] = useState<'text' | 'image'>('text');
  const [showOptionNames, setShowOptionNames] = useState(true);
  const [options, setOptions] = useState<ChallengeDraftOption[]>([
    { id: '1', text: '', image: null, mediaDrafts: [] },
    { id: '2', text: '', image: null, mediaDrafts: [] }
  ]);

  const [settingsOptionId, setSettingsOptionId] = useState<string | null>(null);
  const [allowComments, setAllowComments] = useState(true);
  const [forceAnonymous, setForceAnonymous] = useState(false);
  const [randomPairing, setRandomPairing] = useState(true);

  const [duration, setDuration] = useState<string>('none');
  const [customEndDate, setCustomEndDate] = useState<string>('');

  const [selectedDemographics, setSelectedDemographics] = useState<string[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<string[]>(initialGroupId ? [initialGroupId] : []);
  const [errors, setErrors] = useState<{ [key: string]: boolean | string }>({});
  const [focusedOptionId, setFocusedOptionId] = useState<string | null>(null);
  const [selectedInsightPreset, setSelectedInsightPreset] = useState<'basic' | 'professional' | 'social' | 'custom' | null>(null);
  const [showInsightInfo, setShowInsightInfo] = useState(false);

  useEffect(() => {
    if (selectedDemographics.length === 0) {
      setSelectedInsightPreset(prev => prev === 'custom' ? 'custom' : null);
      return;
    }
    const isBasic = selectedDemographics.length === 3 && selectedDemographics.includes('gender') && selectedDemographics.includes('ageGroup') && selectedDemographics.includes('residence');
    const isProfessional = selectedDemographics.length === 4 && selectedDemographics.includes('education') && selectedDemographics.includes('employment') && selectedDemographics.includes('industry') && selectedDemographics.includes('sector');
    const isSocial = selectedDemographics.length === 1 && selectedDemographics.includes('maritalStatus');
    
    if (isBasic) setSelectedInsightPreset('basic');
    else if (isProfessional) setSelectedInsightPreset('professional');
    else if (isSocial) setSelectedInsightPreset('social');
    else setSelectedInsightPreset('custom');
  }, [selectedDemographics]);

  const handlePresetChange = (preset: 'basic' | 'professional' | 'social' | 'custom') => {
    if (selectedInsightPreset === preset) {
      setSelectedInsightPreset(null);
      setSelectedDemographics([]);
      return;
    }
    setSelectedInsightPreset(preset);
    if (preset === 'basic') {
      setSelectedDemographics(['gender', 'ageGroup', 'residence']);
    } else if (preset === 'professional') {
      setSelectedDemographics(['education', 'employment', 'industry', 'sector']);
    } else if (preset === 'social') {
      setSelectedDemographics(['maritalStatus']);
    } else if (preset === 'custom') {
      setSelectedDemographics([]);
    }
  };

  const postMediaPickerRef = useRef<MediaPickerHandle>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (draft) {
      setTitle(draft.title || '');
      setCategory(draft.category || '');
      setOptionPresentation(resolveOptionPresentation(draft.optionPresentation, draft.options));
      setShowOptionNames(draft.showOptionNames !== false);
      const draftVisibility = draft.targetAudience as VisibilityType;
      setVisibility(['Public', 'ProfileAndGroups', 'Groups', 'Custom Audience', 'Custom Domain'].includes(draftVisibility) ? draftVisibility : 'Public');
      setResultsWho(draft.resultsWho || 'Public');
      setResultsTiming(draft.resultsTiming || 'AnyTime');
      setAllowComments(draft.allowComments !== undefined ? draft.allowComments : true);
      setForceAnonymous(draft.forceAnonymous || false);
      setTaggedPeople((draft.taggedUsers || []).map((tag) => tag.taggedUser).filter((person): person is PeopleTagPerson => Boolean(person?.id && person?.handle)));
      setRandomPairing(draft.randomPairing !== undefined ? draft.randomPairing : true);
      const persistedPostMedia = (draft.media || []).map((media) => createPersistedMediaDraft(media, 'POST', draft.coverImage));
      setPostMedia(persistedPostMedia);
      setMediaAspectRatio(draft.mediaAspectRatio || persistedPostMedia[0]?.aspectRatio);
      setLegacyCoverImage(persistedPostMedia.length > 0 ? null : (draft.coverImage || null));
      if (draft.options) setOptions(draft.options.map(o => ({
        id: o.id,
        text: o.text,
        image: o.image || null,
        imageMediaId: o.imageMediaId,
        mediaDrafts: o.imageMediaId ? [createPersistedMediaDraftFromId(o.imageMediaId, 'OPTION_IMAGE', o.image, 1)] : [],
        withFollowUp: o.withFollowUp,
        followUpLabel: o.followUpLabel
      })));
      if (draft.demographics) setSelectedDemographics(draft.demographics);
      if (draft.targetGroups) setSelectedGroups(draft.targetGroups);
    }
  }, [draft]);

  const canShowResultsAfterEnd = duration !== 'none';
  useEffect(() => { if (duration === 'none' && resultsTiming === 'AfterEnd') setResultsTiming('Immediately'); }, [duration]);

  const isVerified = (userProfile?.stats?.followers || 0) > 1000;
  const isOrganization = false;



  const resultsLabel = resultsWho === 'OnlyMe' ? 'Only Me' : resultsWho;
  const durationLabel = DURATION_OPTIONS.find(opt => opt.value === duration)?.label || (duration === 'custom' ? 'Custom' : 'None');
  const advancedItems = [
    duration !== 'none' ? durationLabel : null,
    !allowComments ? 'Comments off' : null,
    forceAnonymous ? 'Anon' : null,
    randomPairing ? 'Random' : null,
  ].filter(Boolean) as string[];
  const advancedSummary = advancedItems.length === 0
    ? 'Default'
    : advancedItems.length === 1
      ? advancedItems[0]
      : `${advancedItems.length} on`;

  const handleAddOption = () => {
    const option = createChallengeOption();
    setOptions([...options, option]);
    setFocusedOptionId(option.id);
  };

  const handleRemoveOption = (id: string) => {
    if (options.length <= 2) return;
    const removed = options.find((option) => option.id === id);
    if (removed) void cancelTemporaryMediaDrafts(removed.mediaDrafts);
    setOptions(options.filter(o => o.id !== id));
  };

  const handleOptionChange = (id: string, text: string) => {
    setOptions(options.map(o => id === o.id ? { ...o, text } : o));
  };

  const activeOptionMediaDrafts = optionPresentation === 'image'
    ? options.flatMap((option) => option.mediaDrafts)
    : [];
  const imageOptionsAreValid = options.length >= 2 && options.every((option) =>
    option.text.trim().length > 0 && draftOptionHasImage(option)
  );

  const handleDemographicToggle = (id: string) => {
    setSelectedDemographics(prev =>
      prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]
    );
  };


  const validate = (includeAudience = true) => {
    const newErrors: { [key: string]: boolean | string } = {};
    let isValid = true;
    if (!userProfile?.id) {
      newErrors.userProfile = "User profile not found. Please log in.";
      isValid = false;
    }
    if (!title.trim()) {
      newErrors.title = "Challenge text is required";
      isValid = false;
    }
    if (optionPresentation === 'image') {
      if (!imageOptionsAreValid) {
        newErrors.options = options.length < 2
          ? t('answerType.minimumImageOptions')
          : t('answerType.imageAndNameRequired');
        isValid = false;
      }
    } else {
      const filledOptions = options.filter(o => o.text.trim() !== '');
      if (filledOptions.length < 2) {
        newErrors.options = "You need at least 2 items to compare.";
        isValid = false;
      }
    }
    const requiredMedia = [...postMedia, ...activeOptionMediaDrafts];
    if (!mediaDraftsAreReady(requiredMedia) || mediaDraftsHaveErrors(requiredMedia)) {
      newErrors.media = "Please finish or remove image uploads.";
      isValid = false;
    }
    if (!category) {
      newErrors.category = "Please select a category";
      isValid = false;
      setIsCategorySheetOpen(true);
    }
    if (includeAudience && !visibility) {
      newErrors.visibility = 'Select at least one destination.';
      isValid = false;
    }
    if (includeAudience && (visibility === 'Groups' || visibility === 'ProfileAndGroups') && selectedGroups.length === 0) {
      newErrors.visibility = "Please select at least one group.";
      isValid = false;

    }
    setErrors(newErrors);
    return isValid && Object.keys(newErrors).length === 0;
  };

  const getExpiresAt = () => {
    const now = new Date();
    if (duration === 'custom' && customEndDate) return new Date(customEndDate).toISOString();
    if (duration === 'none') return new Date(now.getFullYear() + 10, now.getMonth(), now.getDate()).toISOString();
    const map: Record<string, number> = { '1h': 60, '24h': 1440, '3d': 4320, '1w': 10080, '1m': 43200 };
    const mins = map[duration] || 10080;
    return new Date(now.getTime() + mins * 60000).toISOString();
  };

  const handleFinalPost = async () => {
    if (isSubmitting) return;
    if (!userProfile?.id) {
      alert('Please log in to create a post');
      onClose();
      return;
    }
    setHasAttemptedSubmit(true);
    if (!validate()) return;
    try {
      setIsSubmitting(true);
      await onSubmit({
        title,
        description: '',
        type: SurveyType.CHALLENGE,
        optionPresentation,
        showOptionNames,
        author: { id: userProfile.id, name: userProfile.name, avatar: userProfile.avatar },
        options: options.map(o => ({
          id: o.id,
          text: o.text,
          votes: 0,
          image: optionPresentation === 'image' && o.mediaDrafts.length === 0 ? (o.image || undefined) : undefined,
          imageMediaId: optionPresentation === 'image' ? readyMediaAssetIds(o.mediaDrafts)[0] : undefined,
          withFollowUp: o.withFollowUp,
          followUpLabel: o.followUpLabel
        })),
        coverImage: postMedia.length > 0 ? undefined : (legacyCoverImage || undefined),
        mediaAssetIds: readyMediaAssetIds(postMedia),
        mediaAspectRatio: postMedia.length > 0 ? mediaAspectRatio : undefined,
        targetAudience: visibility as any,
        targetGroups: (visibility === 'Groups' || visibility === 'ProfileAndGroups') ? selectedGroups : [],
        taggedUserIds: taggedPeople.map((person) => person.id),
        resultsWho,
        resultsTiming,
        category,
        allowComments,
        allowAnonymous: true,
        forceAnonymous: forceAnonymous,
        randomPairing,
        demographics: selectedDemographics,
        expiresAt: getExpiresAt(),
        createdAt: new Date().toISOString()
      });
      if (optionPresentation === 'text') {
        await cancelTemporaryMediaDrafts(options.flatMap((option) => option.mediaDrafts));
      }
      onClose();
    } catch (error) {
      console.error('Failed to create challenge:', error);
      alert('Failed to create challenge. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedOptionForSettings = options.find(o => o.id === settingsOptionId);
  const allMediaDrafts = [...postMedia, ...activeOptionMediaDrafts];

  const handleNext = () => {
    setHasAttemptedSubmit(true);
    if (isSubmitting || !validate(false)) return;
    setComposerStep(2);
    setHasAttemptedSubmit(false);
    scrollContainerRef.current?.scrollTo({ top: 0 });
  };

  return (
    <div className="absolute inset-0 z-[60] bg-white flex flex-col animate-in slide-in-from-right duration-350">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-white/95 backdrop-blur-md sticky top-0 z-40 safe-top shrink-0">
        <button aria-label={composerStep === 2 ? 'Back' : 'Close'} onClick={() => { if (composerStep === 2) { setComposerStep(1); setHasAttemptedSubmit(false); scrollContainerRef.current?.scrollTo({ top: 0 }); } else handleExit(); }} className="p-2 -ml-2 hover:bg-gray-50 rounded-full text-gray-500">
          <ArrowLeft size={24} />
        </button>
        <div className="text-center"><h1 className="text-[12px] font-bold text-gray-800">New Challenge</h1><p className="text-xs text-gray-500">Step {composerStep} of 2</p></div>
        <button
          onClick={() => composerStep === 1 ? handleNext() : handleFinalPost()}
          disabled={isSubmitting}
          aria-disabled={isSubmitting}
          className={`text-white font-bold text-[12px] px-5 py-2.5 rounded-full transition-all uppercase tracking-widest ${
            !isSubmitting
              ? 'bg-amber-600 hover:bg-amber-700 shadow-md active:scale-95 shadow-amber-200/50'
              : 'bg-gray-300 shadow-none cursor-not-allowed'
          }`}
        >
          {composerStep === 1 ? 'Next' : 'Post'}
        </button>
      </div>

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto no-scrollbar bg-white">
        <div className="max-w-md mx-auto px-4 py-6 pb-32 space-y-6">
          {errors.userProfile && (
            <div className="p-3 bg-red-50 text-red-600 border border-red-100 rounded-xl text-xs font-bold flex items-center gap-2">
              <AlertCircle size={16} />
              <span>{errors.userProfile}</span>
            </div>
          )}

          <div hidden={composerStep !== 1} className="space-y-6">
          <div className="flex flex-wrap items-center gap-2" aria-label="Post details">
            <button
              type="button"
              onClick={() => setIsCategorySheetOpen(true)}
              className={`min-h-10 inline-flex items-center gap-2 rounded-full border bg-white px-3 text-[12px] font-bold text-gray-700 ${errors.category ? 'border-red-300' : 'border-gray-200'}`}
            >
              <Tag size={14} />
              <span>{category || 'Category'}</span>
              <ChevronDown size={14} />
            </button>
            <PeopleTagPicker variant="chip" selectedPeople={taggedPeople} onChange={setTaggedPeople} accent="amber" />
          </div>
          {/* 1. Challenge Section */}
          <section className="space-y-4 pb-4 border-b border-gray-100">
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <RichMentionInput
                  value={title}
                  onChange={(val) => { setTitle(val); if (errors.title) setErrors(prev => ({ ...prev, title: false })) }}
                  placeholder="Create a challenge..."
                  className={`text-[12px] leading-relaxed text-start font-normal bg-transparent border-b border-gray-100 focus:outline-none focus:border-amber-500 transition-all pt-0.5 pb-1.5 placeholder-gray-400 min-h-[44px] ${errors.title ? 'border-red-300 text-red-500' : 'text-gray-900'}`}
                  minRows={1}
                  autoFocus
                />
                {errors.title && <p className="text-[10px] font-bold text-red-500 px-1 mt-1">{errors.title}</p>}
              </div>
              <button
                type="button"
                onClick={() => postMediaPickerRef.current?.open()}
                disabled={postMedia.length >= 8}
                className={`p-1.5 rounded-full transition-colors shrink-0 mt-1 disabled:opacity-40 ${postMedia.length > 0 || legacyCoverImage ? 'text-amber-600 bg-amber-50' : 'text-gray-400 hover:text-amber-500 hover:bg-gray-50'}`}
                aria-label="Add challenge images"
                title="Add images"
              >
                <Camera size={20} />
              </button>
            </div>

            <MediaPicker
              ref={postMediaPickerRef}
              purpose="POST"
              value={postMedia}
              onChange={(next) => {
                setPostMedia(next);
                if (next.some((media) => media.status === 'ready')) setLegacyCoverImage(null);
              }}
              maxFiles={8}
              multiple
              aspectRatio={mediaAspectRatio}
              onAspectRatioChange={setMediaAspectRatio}
              showAddButton={false}
            />

            {legacyCoverImage && postMedia.length === 0 && (
              <div className="relative w-24 h-24 rounded-xl overflow-hidden border border-gray-100 shadow-sm group animate-in zoom-in-95 mt-2">
                <img src={legacyCoverImage} className="w-full h-full object-cover" alt="Cover" />
                <button type="button" onClick={() => setLegacyCoverImage(null)} className="absolute top-1 right-1 p-1 bg-black/50 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity" aria-label="Remove image" title="Remove image"><X size={10} /></button>
              </div>
            )}

            <div className="space-y-2 pt-3"><label className="text-xs font-bold text-gray-800">{t('answerType.label')}</label><AnswerTypeSelector value={optionPresentation} onChange={(value) => value !== 'rating' && setOptionPresentation(value)} modes={['text', 'image']} accent="amber"/></div>
          </section>
          {/* 3. Options Section */}
          <section className="space-y-4 pb-2.5 border-b border-gray-100">
            <div className="flex items-center justify-between px-1 border-b border-gray-55/40 pb-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="p-1.5 bg-gray-55/30 rounded-lg text-gray-500 border border-gray-100 shrink-0">
                  <List size={12} />
                </div>
                <span className="text-xs font-bold text-gray-800">Challenge Items <span className="text-red-500">*</span></span>
                {errors.options && <span className="text-[10px] font-bold text-red-600 truncate">{errors.options}</span>}
              </div>
            </div>

            {optionPresentation === 'image' && (
              <OptionImagePicker options={options} onChange={setOptions} createOption={createChallengeOption}>
                {(controls) => (
                  <div className="space-y-3">
                    <button type="button" onClick={controls.openBulk} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-amber-300 bg-amber-50/50 px-3 text-xs font-bold text-amber-700">
                      <ImageIcon size={16} aria-hidden="true" />
                      {options.some(draftOptionHasImage) ? t('answerType.addMoreImages') : t('answerType.addImages')}
                    </button>

                  </div>
                )}
              </OptionImagePicker>
            )}

            <div className="space-y-3">
              {options.map((option, idx) => (
                <div key={option.id} className="flex items-center gap-2 animate-in fade-in slide-in-from-bottom-1 duration-200">
                  <span className="text-xs font-black text-gray-300 w-4 text-center shrink-0">{idx + 1}</span>
                  <div className="min-w-0 flex-1 flex flex-col gap-1.5">
                    <div className="flex items-center w-full bg-gray-55/5 border border-gray-200 rounded-xl px-2 py-0.5 focus-within:border-amber-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-amber-100 transition-all shadow-xs">
                        {optionPresentation === 'image' && <MediaPicker
                          purpose="OPTION_IMAGE"
                          value={option.mediaDrafts}
                          onChange={(mediaDrafts) => setOptions((current) => current.map((item) => item.id === option.id ? {
                            ...item,
                            mediaDrafts,
                            image: mediaDrafts.some((media) => media.status === 'ready') ? null : item.image,
                            imageMediaId: readyMediaAssetIds(mediaDrafts)[0]
                          } : item))}
                          className="shrink-0"
                          renderContent={({ open, replace, retry, busy }) => {
                            const current = option.mediaDrafts[0];
                            const hasImage = Boolean(current || option.image);
                            return (
                              <button
                                type="button"
                                onClick={() => current?.status === 'error' ? retry(current.clientId) : current ? replace(current.clientId) : open()}
                                disabled={busy}
                                className={`relative w-12 h-12 rounded-lg flex items-center justify-center shrink-0 overflow-hidden border border-dashed transition-all disabled:cursor-wait ${hasImage ? 'border-amber-500' : 'border-gray-200 text-gray-400 hover:text-amber-500'}`}
                                aria-label={current?.status === 'error' ? 'Retry option image upload' : `Add image to challenge item ${idx + 1}`}
                                title={current?.status === 'error' ? 'Retry' : 'Add item image'}
                              >
                                {current?.previewUrl ? (
                                  <img src={current.previewUrl} className="w-full h-full object-cover" alt="" />
                                ) : current?.presentation ? (
                                  <MediaImage media={current.presentation} className="w-full h-full object-cover" />
                                ) : option.image ? (
                                  <img src={option.image} className="w-full h-full object-cover" alt="" />
                                ) : (
                                  <Camera size={14} />
                                )}
                                {busy && <span className="absolute inset-x-0 bottom-0 h-1 bg-amber-500" />}
                              </button>
                            );
                          }}
                        />}

                        <input dir="auto"
                          type="text"
                          value={option.text}
                          maxLength={80}
                          autoFocus={focusedOptionId === option.id}
                          onChange={(e) => handleOptionChange(option.id, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddOption();
                            }
                          }}
                          onBlur={() => {
                            if (focusedOptionId === option.id) setFocusedOptionId(null);
                          }}
                          placeholder={`Item ${idx + 1} Name`}
                          className="min-w-0 flex-1 px-2.5 py-1.5 bg-transparent text-[12px] leading-relaxed text-start font-normal focus:outline-none text-gray-900 placeholder-gray-400"
                        />

                        <span className="text-[9px] text-gray-450 mr-1.5 whitespace-nowrap">{option.text.length}/80</span>

                      {optionPresentation === 'image' && (option.image || option.mediaDrafts.length > 0) && (
                        <button
                          type="button"
                          onClick={() => {
                            void cancelTemporaryMediaDrafts(option.mediaDrafts);
                            setOptions((current) => current.map((item) => item.id === option.id ? { ...item, image: null, imageMediaId: undefined, mediaDrafts: [] } : item));
                          }}
                          className="p-1.5 text-gray-300 hover:text-red-500 rounded-full flex items-center justify-center transition-colors mr-1"
                          aria-label={`Remove image from challenge item ${idx + 1}`}
                          title="Remove item image"
                        >
                          <X size={14} strokeWidth={3} />
                        </button>
                      )}
                    </div>

                    {option.withFollowUp && (
                      <div className="px-2 py-1.5 bg-amber-50 border border-amber-100 rounded-lg text-[10px] flex items-center gap-2">
                        <MessageSquare size={10} className="text-amber-500" />
                        <span className="font-bold text-amber-700 truncate">Feedback: {option.followUpLabel || "Why?"}</span>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setSettingsOptionId(option.id)}
                    className="p-2 text-gray-400 hover:text-gray-650 rounded-full flex items-center justify-center shrink-0 transition-colors"
                  >
                    <MoreHorizontal size={18} />
                  </button>
                </div>
              ))}

              {/* Interactive Placeholder / Auto-Add Option */}
                <div className="flex items-center gap-2 opacity-50 hover:opacity-80 focus-within:opacity-100 transition-opacity duration-200">
                  <span className="text-xs font-black text-gray-300 w-4 text-center shrink-0">{options.length + 1}</span>
                  <div className="min-w-0 flex-1 flex flex-col gap-2">
                    <div className="flex items-center w-full bg-gray-50/30 border border-dashed border-gray-200 rounded-xl px-2 py-0.5">
                      {optionPresentation === 'image' && <button disabled className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0 border border-dashed border-gray-200 text-gray-300">
                        <Camera size={14} />
                      </button>}
                      <input dir="auto"
                        type="text"
                        placeholder="Add item to compare..."
                        className="min-w-0 flex-1 px-2.5 py-1.5 bg-transparent text-[12px] leading-relaxed text-start font-normal focus:outline-none text-gray-500 placeholder-gray-500 cursor-pointer"
                        onFocus={handleAddOption}
                      />
                    </div>
                  </div>
                  <button disabled className="p-2 text-gray-200 rounded-full flex items-center justify-center shrink-0">
                    <MoreHorizontal size={18} />
                  </button>
                </div>
            </div>
          </section>

          </div>
          <div hidden={composerStep !== 2} className="space-y-6">
          <PostVisibilitySection
            value={visibility}
            onChange={value => { setVisibility(value); setErrors(previous => ({ ...previous, visibility: false })); }}
            selectedGroupIds={selectedGroups}
            onGroupsChange={ids => { setSelectedGroups(ids); setErrors(previous => ({ ...previous, visibility: false })); }}
            groups={userGroups}
            allowCustomAudience={isVerified}
            allowCustomDomain={false}
            error={typeof errors.visibility === 'string' ? errors.visibility : false}
            accent="amber"
          />
          {/* 5. Advanced Settings Row */}
          <button
            type="button"
            onClick={() => {
              setAdvancedSheetView('main');
              setIsAdvancedSheetOpen(true);
            }}
            className="w-full flex items-center justify-between py-2.5 px-1 text-left transition-all active:opacity-75"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gray-50 rounded-xl text-gray-500 border border-gray-100">
                <Settings2 size={16} />
              </div>
              <div>
                <h4 className="text-xs font-bold text-gray-805">Advanced Settings</h4>
                <p className="text-[9px] text-gray-500 mt-0.5 leading-tight">Results, duration & challenge behavior</p>
              </div>
            </div>
            <ChevronRight size={14} className="text-gray-400" />
          </button>

            <section className="space-y-3 pt-3 border-t border-gray-100">
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-gray-55/30 rounded-lg text-gray-500 border border-gray-100 shrink-0">
                    <Users size={12} />
                  </div>
                  <span className="text-xs font-bold text-gray-800">Unlock Deeper Analytics</span>
                  <button
                    type="button"
                    onClick={() => setShowInsightInfo(!showInsightInfo)}
                    className="text-gray-400 hover:text-amber-500 transition-colors ml-0.5"
                  >
                    <Info size={14} />
                  </button>
                </div>
              </div>

              {showInsightInfo && (
                <div className="p-3 bg-amber-50 border border-amber-100 text-amber-800 text-[10px] font-semibold rounded-xl leading-relaxed animate-in fade-in slide-in-from-top-1 duration-200">
                  Choose optional demographic questions for participants to unlock deeper insights, audience trends, and response analysis.
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {(['basic', 'professional', 'social', 'custom'] as const).map((preset) => {
                  const isActive = selectedInsightPreset === preset;
                  const labels: Record<string, string> = {
                    basic: 'Basic',
                    professional: 'Professional',
                    social: 'Social',
                    custom: 'Custom'
                  };
                  return (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => handlePresetChange(preset)}
                      className={`px-3 py-1.5 rounded-xl text-[10px] font-bold border uppercase tracking-wider transition-all duration-200 active:scale-95 ${
                        isActive
                          ? 'bg-amber-600 text-white border-amber-600 shadow-sm'
                          : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      {labels[preset]}
                    </button>
                  );
                })}
              </div>

              {selectedInsightPreset && selectedInsightPreset !== 'custom' && (
                <div className="p-3 bg-white rounded-xl border border-gray-100 space-y-1 mx-0.5 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold text-gray-700">
                      Provides {selectedDemographics.length} analytical comparisons
                    </span>
                    <span className="text-[10px] font-extrabold text-amber-600 whitespace-nowrap">
                      +{selectedDemographics.length} questions for participant
                    </span>
                  </div>
                  <div className="text-[9px] text-gray-550 font-medium mt-1 pb-1">
                    Demographics requested: <span className="text-gray-800 font-bold">{selectedDemographics.map(id => DEMOGRAPHIC_OPTIONS.find(opt => opt.id === id)?.label).filter(Boolean).join(', ')}</span>
                  </div>
                  <p className="text-[8px] text-gray-400 font-medium leading-normal">
                    * Selected questions will be prompted as optional questions during participation.
                  </p>
                </div>
              )}

              {selectedInsightPreset === 'custom' && (
                <div className="space-y-2 p-3 bg-gray-50/30 border border-gray-100 rounded-2xl animate-in fade-in duration-200">
                  <span className="text-[9px] font-black text-gray-400 uppercase tracking-wider block">
                    Select Custom Attributes
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {DEMOGRAPHIC_OPTIONS.filter(opt => opt.id !== 'ageGroup').map((opt) => {
                      const isSelected = selectedDemographics.includes(opt.id);
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => handleDemographicToggle(opt.id)}
                          className={`px-2.5 py-1 rounded-lg text-[9px] font-bold border transition-all flex items-center gap-1 active:scale-95 ${
                            isSelected
                              ? 'bg-amber-50 border-amber-200 text-amber-700 shadow-xs'
                              : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                          }`}
                        >
                          {isSelected && <Check size={10} strokeWidth={3} className="text-amber-500" />}
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
          </div>
          {errors.media && <p role="alert" className="text-xs text-red-600">{errors.media}</p>}
        </div>
      </div>

      <BottomSheet
        isOpen={isAdvancedSheetOpen}
        onClose={() => {
          setAdvancedSheetView('main');
          setIsAdvancedSheetOpen(false);
        }}
        title={
          advancedSheetView === 'results'
            ? 'Result Visibility'
            : 'Advanced Settings'
        }
      >
        <div className="space-y-5 py-2 px-2 animate-in fade-in duration-200">
          {advancedSheetView === 'main' && (
            <div className="space-y-5">
              <p className="text-[11px] text-gray-550 leading-relaxed px-1">
                Control who can see, participate, and view challenge results.
              </p>

              <div className="space-y-1.5">


                <button
                  type="button"
                  onClick={() => setAdvancedSheetView('results')}
                  className="w-full flex items-center justify-between p-3.5 bg-gray-50 hover:bg-gray-100/70 rounded-xl transition-all border border-gray-100"
                >
                  <span className="text-xs font-bold text-gray-800">Result Visibility</span>
                  <div className="flex items-center gap-1 text-xs text-amber-600 font-black">
                    <span>{resultsLabel}</span>
                    <ChevronRight size={14} />
                  </div>
                </button>
              </div>

              <div className="space-y-3 pb-4 border-b border-gray-100 pt-1">
                <label className="flex items-center gap-2 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                  <Calendar size={12} /> Challenge Duration
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {DURATION_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setDuration(opt.value)}
                      className={`py-2 rounded-xl text-xs font-bold border transition-all ${
                        duration === opt.value
                          ? 'bg-amber-600 text-white border-amber-600 shadow-sm shadow-amber-100'
                          : 'bg-gray-50 text-gray-500 border-transparent hover:bg-gray-100'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setDuration('custom')}
                    className={`py-2 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-1 ${
                      duration === 'custom'
                        ? 'bg-amber-600 text-white border-amber-600 shadow-sm shadow-amber-100'
                        : 'bg-gray-50 text-gray-500 border-transparent hover:bg-gray-100'
                    }`}
                  >
                    <Plus size={12} /> Custom
                  </button>
                </div>
                {duration === 'custom' && (
                  <div className="mt-2 animate-in fade-in slide-in-from-top-1">
                    <input
                      type="datetime-local"
                      value={customEndDate}
                      onChange={(e) => setCustomEndDate(e.target.value)}
                      className="w-full bg-amber-50/50 border border-amber-100 rounded-xl px-4 py-2.5 text-xs font-bold focus:outline-none focus:bg-white focus:border-amber-500 transition-all text-amber-900"
                    />
                  </div>
                )}
              </div>

              <div className="space-y-4 pt-1">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col text-left">
                    <span className="text-xs font-bold text-gray-800">Allow comments</span>
                    <span className="text-[10px] text-gray-500">Enable user comments on the challenge</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAllowComments(!allowComments)}
                    className={`w-10 h-5 rounded-full relative transition-colors ${allowComments ? 'bg-amber-600' : 'bg-gray-200'}`}
                  >
                    <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${allowComments ? 'left-6' : 'left-1'}`} />
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex flex-col text-left">
                    <span className="text-xs font-bold text-gray-800">Random matchups</span>
                    <span className="text-[10px] text-gray-500">Randomize how challenge items are paired</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRandomPairing(!randomPairing)}
                    className={`w-10 h-5 rounded-full relative transition-colors ${randomPairing ? 'bg-amber-600' : 'bg-gray-200'}`}
                  >
                    <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${randomPairing ? 'left-6' : 'left-1'}`} />
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex flex-col text-left">
                    <span className="text-xs font-bold text-gray-800">Force anonymous</span>
                    <span className="text-[10px] text-gray-500">Keep all participants identity completely anonymous</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setForceAnonymous(!forceAnonymous)}
                    className={`w-10 h-5 rounded-full relative transition-colors ${forceAnonymous ? 'bg-amber-600' : 'bg-gray-200'}`}
                  >
                    <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${forceAnonymous ? 'left-6' : 'left-1'}`} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {advancedSheetView === 'results' && (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => setAdvancedSheetView('main')}
                className="flex items-center gap-1.5 text-xs text-amber-600 font-bold hover:opacity-80 transition-opacity pb-2"
              >
                <span>&larr; Back to Advanced Settings</span>
              </button>

              <div className="space-y-2">
                {[
                  { id: 'Public', label: 'Public', desc: 'Results are visible to everyone.' },
                  { id: 'Participants', label: 'Participants Only', desc: 'Only participants can see results after participating.' },
                  { id: 'OnlyMe', label: 'Private (Only Me)', desc: 'Only you can see the results.' }
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setResultsWho(opt.id as any)}
                    className="w-full flex items-center justify-between p-4 rounded-2xl border transition-all text-left"
                    style={{ borderColor: resultsWho === opt.id ? '#d97706' : '#f3f4f6', backgroundColor: resultsWho === opt.id ? '#fffbeb' : 'white' }}
                  >
                    <div>
                      <span className={`text-sm font-bold block ${resultsWho === opt.id ? 'text-amber-700' : 'text-gray-700'}`}>{opt.label}</span>
                      <span className="text-[10px] text-gray-505 leading-tight mt-0.5 block">{opt.desc}</span>
                    </div>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${resultsWho === opt.id ? 'border-amber-600 bg-amber-600' : 'border-gray-200'}`}>
                      {resultsWho === opt.id && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                    </div>
                  </button>
                ))}
              </div>

              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">When Results Are Visible</span>
                  {!canShowResultsAfterEnd && <span className="text-[9px] font-bold text-gray-450 flex items-center gap-1"><Info size={10} /> Set duration to enable timing</span>}
                </div>
                <div className="space-y-2">
                  {[
                    { id: 'AnyTime', label: 'Any time', enabled: true },
                    { id: 'Immediately', label: 'Immediately after participation', enabled: true },
                    { id: 'AfterEnd', label: 'After post ends', enabled: canShowResultsAfterEnd }
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={!opt.enabled}
                      onClick={() => setResultsTiming(opt.id as any)}
                      className={`w-full flex items-center justify-between p-4 rounded-2xl border transition-all text-left ${!opt.enabled ? 'opacity-40 cursor-not-allowed bg-gray-50 grayscale' : ''}`}
                      style={{ borderColor: resultsTiming === opt.id ? '#d97706' : '#f3f4f6', backgroundColor: resultsTiming === opt.id ? '#fffbeb' : 'white' }}
                    >
                      <span className={`text-sm font-bold ${resultsTiming === opt.id ? 'text-amber-700' : 'text-gray-700'}`}>{opt.label}</span>
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${resultsTiming === opt.id ? 'border-amber-600 bg-amber-600' : 'border-gray-200'}`}>
                        {resultsTiming === opt.id && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </BottomSheet>

      <BottomSheet isOpen={isCategorySheetOpen} onClose={() => setIsCategorySheetOpen(false)} title="Select Category">
        <div className="flex flex-wrap gap-2 py-2">
          {CHALLENGE_CATEGORIES.map(cat => (
            <button key={cat} onClick={() => { setCategory(cat); setErrors(previous => ({ ...previous, category: false })); setIsCategorySheetOpen(false); }} className={`px-4 py-2 rounded-full text-xs font-bold border transition-all ${category === cat ? 'bg-amber-600 text-white border-amber-600 shadow-md' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>{cat}</button>
          ))}
        </div>
      </BottomSheet>

      {/* Option Settings Bottom Sheet */}
      <BottomSheet isOpen={!!settingsOptionId} onClose={() => setSettingsOptionId(null)} title="Item Settings">
        {selectedOptionForSettings && (
          <div className="space-y-6 py-4 px-2">
            <div className="flex flex-col gap-2">
              <button disabled={options.indexOf(selectedOptionForSettings) === 0} onClick={() => { const idx = options.indexOf(selectedOptionForSettings); const newOpts = [...options];[newOpts[idx], newOpts[idx - 1]] = [newOpts[idx - 1], newOpts[idx]]; setOptions(newOpts); setSettingsOptionId(null); }} className="w-full flex items-center gap-4 p-4 rounded-2xl border transition-all hover:bg-gray-50 disabled:opacity-30">
                <div className="p-2.5 rounded-xl bg-gray-100 text-gray-500"><ArrowUp size={20} /></div><span className="font-bold text-sm text-gray-900">Move Up</span>
              </button>
              <button disabled={options.indexOf(selectedOptionForSettings) === options.length - 1} onClick={() => { const idx = options.indexOf(selectedOptionForSettings); const newOpts = [...options];[newOpts[idx], newOpts[idx + 1]] = [newOpts[idx + 1], newOpts[idx]]; setOptions(newOpts); setSettingsOptionId(null); }} className="w-full flex items-center gap-4 p-4 rounded-2xl border transition-all hover:bg-gray-50 disabled:opacity-30">
                <div className="p-2.5 rounded-xl bg-gray-100 text-gray-500"><ArrowDown size={20} /></div><span className="font-bold text-sm text-gray-900">Move Down</span>
              </button>
              
              <button
                disabled={options.length <= 2}
                onClick={() => { handleRemoveOption(selectedOptionForSettings.id); setSettingsOptionId(null); }}
                className={`w-full flex items-center gap-4 p-4 rounded-2xl border transition-all text-left ${options.length <= 2 ? 'opacity-30 grayscale cursor-not-allowed border-gray-100' : 'hover:bg-red-50 hover:border-red-200 hover:text-red-600 border-gray-100 text-red-600 active:scale-[0.98]'
                  }`}
              >
                <div className={`p-2.5 rounded-xl ${options.length <= 2 ? 'bg-gray-100 text-gray-400' : 'bg-red-50 text-red-500'}`}><Trash2 size={20} /></div>
                <span className="font-bold text-sm">Delete Option</span>
              </button>
            </div>

            <div className="h-px bg-gray-100 my-2" />

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex flex-col text-left">
                  <span className="text-sm font-bold text-gray-800">Feedback Question</span>
                  <span className="text-[10px] text-gray-400 font-medium">Ask for reasoning when chosen</span>
                </div>
                <button
                  onClick={() => setOptions(options.map(o => o.id === selectedOptionForSettings.id ? { ...o, withFollowUp: !o.withFollowUp } : o))}
                  className={`w-10 h-5 rounded-full relative transition-colors ${selectedOptionForSettings.withFollowUp ? 'bg-amber-600' : 'bg-gray-200'}`}
                >
                  <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${selectedOptionForSettings.withFollowUp ? 'left-6' : 'left-1'}`} />
                </button>
              </div>

              {selectedOptionForSettings.withFollowUp && (
                <div className="animate-in zoom-in-95">
                  <label className="block text-[10px] font-black text-amber-600 uppercase tracking-widest mb-1.5 px-1">Label Text</label>
                  <input dir="auto"
                    type="text"
                    value={selectedOptionForSettings.followUpLabel}
                    onChange={(e) => setOptions(options.map(o => o.id === selectedOptionForSettings.id ? { ...o, followUpLabel: e.target.value } : o))}
                    placeholder="e.g. Why did you pick this?"
                    className="w-full bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-[12px] leading-relaxed text-start focus:outline-none focus:bg-white focus:border-amber-500 transition-all font-normal shadow-inner"
                    autoFocus
                  />
                </div>
              )}
            </div>

            <button onClick={() => setSettingsOptionId(null)} className="w-full py-4 bg-gray-900 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-lg active:scale-95">Done</button>
          </div>
        )}
      </BottomSheet>

      {showExitConfirm && (
        <div className="fixed inset-0 z-[110] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl p-6 w-full max-w-xs shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="w-12 h-12 bg-orange-100 text-orange-600 rounded-2xl flex items-center justify-center mb-4"><AlertCircle size={24} /></div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">Discard changes?</h3>
            <p className="text-sm text-gray-500 mb-6 leading-relaxed">You have unsaved work. If you exit now, your changes will be lost.</p>
            <div className="flex flex-col gap-2">
              <button onClick={handleDiscard} className="w-full py-3 bg-red-600 text-white rounded-xl font-bold text-sm hover:bg-red-700 transition-colors">Discard and Exit</button>
              <button onClick={handleSaveDraft} className="w-full py-3 bg-amber-50 text-amber-600 rounded-xl font-bold text-sm hover:bg-amber-100 transition-colors">Save as Draft</button>
              <button onClick={() => setShowExitConfirm(false)} className="w-full py-3 bg-gray-100 text-gray-700 rounded-xl font-bold text-sm hover:bg-gray-200 transition-colors">Keep Editing</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
