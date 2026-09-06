
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { X, Plus, Trash2, Globe, Users, ChevronDown, Clock, Calendar, Type, ListChecks, ImageIcon, Settings, Info, ArrowRight, Camera, Lock, AlertCircle, ChevronRight, ChevronLeft, MoreHorizontal, Layout, Terminal, Navigation, Sparkles, GripVertical, Save, FileText, BarChart3, UserCircle, Heart, Fingerprint, MapPin, Briefcase, Check, GraduationCap, Home, Smile, Building2, User, MessageSquare, ShieldCheck, Link2, Target, MoreHorizontal as MoreHorizontalIcon, ArrowUp, ArrowDown, Star, List, LayoutGrid, CornerDownRight, PowerOff, CheckCircle2, ArrowLeft, Tag } from 'lucide-react';
import { Survey, SurveyType, UserProfile, Group, MediaDraft } from '../types';
import { useTranslation } from 'react-i18next';
import { BottomSheet } from './BottomSheet';
import { PostVisibilitySection } from './PostVisibilitySection';
import { RichMentionInput } from './RichMentionInput';
import { api } from '../services/api';
import { MediaPicker, MediaPickerHandle } from './media/MediaPicker';
import { MediaImage } from './media/MediaImage';
import { cancelTemporaryMediaDrafts, createPersistedMediaDraft, mediaDraftsAreReady, mediaDraftsHaveErrors, readyMediaAssetIds } from '../utils/mediaDrafts';
import { collectInactiveSectionMedia, collectSectionMedia, hydrateSections, serializeSections, SurveyOptionDraft, SurveyQuestionDraft, SurveySectionDraft } from '../utils/sectionMediaDrafts';
import { AnswerTypeSelector } from './options/AnswerTypeSelector';
import { OptionImagePicker } from './options/OptionImagePicker';
import { draftOptionHasImage, resolveOptionPresentation } from '../utils/optionPresentation';
import { PeopleTagPicker, PeopleTagPerson } from './PeopleTagPicker';

interface CreateQuizModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (surveyData: Partial<Survey>) => void | Promise<void>;
  onSaveDraft?: (surveyData: Partial<Survey>) => void | Promise<void>;
  userProfile: UserProfile;
  draft?: Survey;
  userGroups?: Group[];
  initialGroupId?: string | null;
}

const QUIZ_CATEGORIES = [
  "General Knowledge", "Science", "History", "Pop Culture", "Sports", "Technology",
  "Movies", "Music", "Business", "Literature", "Geography", "Art", "Other"
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

const INITIAL_SECTIONS: SurveySectionDraft[] = [
  {
    id: `sec-quiz-init`,
    title: '',
    questions: [
      {
        id: `q-quiz-init-1`,
        text: '',
        type: 'multiple_choice',
        isRequired: true,
        weight: 10,
        imageLayout: 'vertical',
        optionPresentation: 'text',
        showOptionNames: true,
        mediaDrafts: [],
        options: [
          { id: `opt-quiz-init-1`, text: '', votes: 0, mediaDrafts: [] },
          { id: `opt-quiz-init-2`, text: '', votes: 0, mediaDrafts: [] }
        ]
      }
    ]
  }
];

type VisibilityType = '' | 'Public' | 'Followers' | 'Groups' | 'Custom Audience' | 'Custom Domain' | 'ProfileAndGroups';

const createQuizOption = (): SurveyOptionDraft => ({
  id: `o-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  text: '',
  votes: 0,
  mediaDrafts: []
});

export const CreateQuizModal: React.FC<CreateQuizModalProps> = ({ isOpen, onClose, onSubmit, onSaveDraft, userProfile, draft, userGroups = [], initialGroupId }) => {
  const { t } = useTranslation();
  const [visibility, setVisibility] = useState<VisibilityType>(initialGroupId ? 'Groups' : 'Public');
  const [isResultVisibilitySheetOpen, setIsResultVisibilitySheetOpen] = useState(false);
  const [isCategorySheetOpen, setIsCategorySheetOpen] = useState(false);
  const [isDurationSheetOpen, setIsDurationSheetOpen] = useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [composerStep, setComposerStep] = useState<1 | 2>(1);

  // Results Visibility State
  const [resultsWho, setResultsWho] = useState<'Public' | 'Followers' | 'Participants' | 'OnlyMe'>('Public');
  const [resultsTiming, setResultsTiming] = useState<'AnyTime' | 'Immediately' | 'AfterEnd'>('AnyTime');

  const [category, setCategory] = useState<string>('');
  const [duration, setDuration] = useState<string>('none');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [allowComments, setAllowComments] = useState(true);
  const [forceAnonymous, setForceAnonymous] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [taggedPeople, setTaggedPeople] = useState<PeopleTagPerson[]>([]);
  const [legacyCoverImage, setLegacyCoverImage] = useState<string | null>(null);
  const [postMedia, setPostMedia] = useState<MediaDraft[]>([]);
  const [mediaAspectRatio, setMediaAspectRatio] = useState<number | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);
  const [sections, setSections] = useState<SurveySectionDraft[]>(INITIAL_SECTIONS);

  const totalQuestions = useMemo(() => {
    return sections.reduce((sum, sec) => sum + (sec.questions?.length || 0), 0);
  }, [sections]);

  const shouldShowTitleField = useMemo(() => {
    return totalQuestions > 1 || (title.trim().length > 0 && draft);
  }, [totalQuestions, title, draft]);

  const [settingsOptionId, setSettingsOptionId] = useState<{ secId: string, qId: string, optId: string } | null>(null);
  const [isQuestionSettingsSheetOpen, setIsQuestionSettingsSheetOpen] = useState(false);
  const [isSectionSettingsSheetOpen, setIsSectionSettingsSheetOpen] = useState(false);

  const [selectedDemographics, setSelectedDemographics] = useState<string[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<string[]>(initialGroupId ? [initialGroupId] : []);
  const [selectedInsightPreset, setSelectedInsightPreset] = useState<'basic' | 'professional' | 'social' | 'custom' | null>(null);
  const [showInsightInfo, setShowInsightInfo] = useState(false);
  const [isAdvancedSheetOpen, setIsAdvancedSheetOpen] = useState(false);
  const [advancedSheetView, setAdvancedSheetView] = useState<'main' | 'results'>('main');

  useEffect(() => {
    if (selectedDemographics.length === 0) {
      setSelectedInsightPreset(current => current === 'custom' ? 'custom' : null);
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

  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [errors, setErrors] = useState<{ [key: string]: boolean | string }>({});
  const [focusedOptionId, setFocusedOptionId] = useState<string | null>(null);

  const postMediaPickerRef = useRef<MediaPickerHandle>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const activeSection = sections.find(s => s.id === activeSectionId);
  const activeSectionIndex = useMemo(() => sections.findIndex(s => s.id === activeSectionId), [sections, activeSectionId]);

  const getQuestionCountBeforeSection = (secIdx: number) => {
    return sections.slice(0, secIdx).reduce((acc, sec) => acc + sec.questions.length, 0);
  };

  useEffect(() => {
    if (draft) {
      setTitle(draft.title || '');
      setDescription(draft.description || '');
      setCategory(draft.category || '');
      setVisibility((draft.targetAudience as VisibilityType) || 'Public');
      setResultsWho(draft.resultsWho || 'Public');
      setResultsTiming(draft.resultsTiming || 'AnyTime');
      setAllowComments(draft.allowComments !== undefined ? draft.allowComments : true);
      setForceAnonymous(draft.forceAnonymous || false);
      setTaggedPeople((draft.taggedUsers || []).map((tag) => tag.taggedUser).filter((person): person is PeopleTagPerson => Boolean(person?.id && person?.handle)));
      const persistedPostMedia = (draft.media || []).map((media) => createPersistedMediaDraft(media, 'POST', draft.coverImage));
      setPostMedia(persistedPostMedia);
      setMediaAspectRatio(draft.mediaAspectRatio || persistedPostMedia[0]?.aspectRatio);
      setLegacyCoverImage(persistedPostMedia.length > 0 ? null : (draft.coverImage || null));
      if (draft.sections && draft.sections.length > 0) {
        setSections(hydrateSections(draft.sections));
      }
      if (draft.demographics) {
        setSelectedDemographics(draft.demographics);
      }
      if (draft.targetGroups) {
        setSelectedGroups(draft.targetGroups);
      }
    }
  }, [draft]);

  const canShowResultsAfterEnd = duration !== 'none';

  useEffect(() => {
    if (duration === 'none' && resultsTiming === 'AfterEnd') setResultsTiming('Immediately');
  }, [duration]);

  const isVerified = (userProfile?.stats?.followers || 0) > 1000;



  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, []);

  const hasChanges = useMemo(() => {
    if (draft) return false;
    if (title.trim() !== '') return true;
    if (description.trim() !== '') return true;
    if (category !== '') return true;
    if (postMedia.length > 0 || legacyCoverImage !== null) return true;
    if (sections.length > 1) return true;
    const firstQ = sections[0].questions[0];
    if (firstQ.text.trim() !== '') return true;
    if (sections[0].questions.length > 1) return true;
    return false;
  }, [title, description, category, postMedia, legacyCoverImage, sections, draft]);

  useEffect(() => {
    if (sections.length > 0 && !activeSectionId) {
      setActiveSectionId(sections[0].id);
    }
  }, [sections]);

  useEffect(() => {
    if (activeSection) {
      const exists = activeSection.questions.find(q => q.id === activeQuestionId);
      if (!exists && activeSection.questions.length > 0) {
        setActiveQuestionId(activeSection.questions[0].id);
      }
    }
  }, [activeSectionId, activeSection]);

  const durationOptions = [
    { label: 'None', value: 'none' },
    { label: '1 Hour', value: '1h' },
    { label: '24 Hours', value: '24h' },
    { label: '3 Days', value: '3d' },
    { label: '1 Week', value: '1w' },
    { label: '1 Month', value: '1m' },
  ];

  const handleClose = () => {
    if (hasChanges) {
      setShowExitConfirm(true);
    } else {
      onClose();
    }
  };

  const handleDiscard = async () => {
    await Promise.all([
      cancelTemporaryMediaDrafts(postMedia),
      cancelTemporaryMediaDrafts(collectSectionMedia(sections, true))
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

  const validateQuiz = (includeAudience = true) => {
    const newErrors: { [key: string]: boolean | string } = {};
    const errorList: string[] = [];

    if (!userProfile?.id) {
      errorList.push("User profile not found. Please log in.");
      newErrors.userProfile = "User profile not found. Please log in.";
    }

    if (!category) {
      errorList.push("Quiz Category is required.");
      newErrors.category = true;
    }

    if (includeAudience && !visibility) {
      newErrors.visibility = 'Select at least one destination.';
      errorList.push('Select at least one destination.');
    }
    if (includeAudience && (visibility === 'Groups' || visibility === 'ProfileAndGroups') && selectedGroups.length === 0) {
      errorList.push("Please select at least one group for Group visibility.");
      newErrors.visibility = "Please select at least one group.";
    }

    let hasQuestionError = false;
    sections.forEach((s, sIdx) => {
      s.questions.forEach((q, qIdx) => {
        const qNum = getQuestionCountBeforeSection(sIdx) + qIdx + 1;
        if (!q.text.trim()) {
          errorList.push(`Question ${qNum}: Question text is required.`);
          hasQuestionError = true;
        }
        if (q.type === 'multiple_choice') {
          const presentation = resolveOptionPresentation(q.optionPresentation, q.options);
          if (presentation === 'image') {
            const imageOptionsValid = (q.options?.length || 0) >= 2 && q.options?.every((option) =>
              option.text.trim().length > 0 && draftOptionHasImage(option)
            );
            if (!imageOptionsValid) {
              errorList.push(`Question ${qNum}: Every image option needs an image and a name.`);
              hasQuestionError = true;
            }
          } else {
            const filledOptions = q.options?.filter(o => o.text.trim() !== '');
            if ((filledOptions?.length || 0) < 2) {
              errorList.push(`Question ${qNum}: At least 2 options are required.`);
              hasQuestionError = true;
            }
          }
          if (!q.correctOptionId) {
            errorList.push(`Question ${qNum}: A correct answer must be selected.`);
            hasQuestionError = true;
          }
        }
      });
    });

    if (hasQuestionError) {
      newErrors.questions = "Question validation failed.";
    }

    return {
      isValid: errorList.length === 0,
      errors: errorList,
      newErrors
    };
  };

  const handleSaveDraft = async () => {
    if (isSubmitting) return;
    if (!userProfile?.id) {
      onClose();
      return;
    }
    const allMedia = [...postMedia, ...collectSectionMedia(sections)];
    if (!mediaDraftsAreReady(allMedia) || mediaDraftsHaveErrors(allMedia)) {
      setErrors((current) => ({ ...current, media: 'Please finish or remove image uploads.' }));
      return;
    }
    if (onSaveDraft) {
      const firstQuestion = sections[0]?.questions[0];
      const computedTitle = title.trim() || firstQuestion?.text.trim() || 'Untitled Quiz';

      const draftData: Partial<Survey> = {
        id: draft?.id,
        title: computedTitle,
        description,
        type: SurveyType.QUIZ,
        category,
        sections: serializeSections(sections),
        coverImage: postMedia.length > 0 ? undefined : (legacyCoverImage || undefined),
        mediaAssetIds: readyMediaAssetIds(postMedia),
        mediaAspectRatio: postMedia.length > 0 ? mediaAspectRatio : undefined,
        targetAudience: visibility as any,
        targetGroups: (visibility === 'Groups' || visibility === 'ProfileAndGroups') ? selectedGroups : [],
        taggedUserIds: taggedPeople.map((person) => person.id),
        resultsWho,
        resultsTiming,
        allowAnonymous: true,
        forceAnonymous: forceAnonymous,
        expiresAt: getExpiresAt(),
        author: { id: userProfile.id, name: userProfile.name, avatar: userProfile.avatar },
        createdAt: new Date().toISOString(),
        status: 'DRAFT',
        isDraft: true,
        currentStep: 1
      };
      try {
        setIsSubmitting(true);
        await onSaveDraft(draftData);
        await cancelTemporaryMediaDrafts(collectInactiveSectionMedia(sections));
        onClose();
      } catch (error) {
        console.error('Failed to save quiz draft:', error);
        alert('Failed to save quiz draft. Please try again.');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }
    onClose();
  };

  const getExpiresAt = () => {
    const now = new Date();
    if (duration === 'custom' && customEndDate) return new Date(customEndDate).toISOString();
    if (duration === 'none') return new Date(now.getFullYear() + 10, now.getMonth(), now.getDate()).toISOString();
    const map: Record<string, number> = { '1h': 60, '24h': 1440, '3d': 4320, '1w': 10080, '1m': 43200 };
    const mins = map[duration] || 10080;
    return new Date(now.getTime() + mins * 60000).toISOString();
  };

  const handlePost = async () => {
    if (isSubmitting) return;
    setHasAttemptedSubmit(true);
    const { isValid, newErrors } = validateQuiz();
    setErrors(newErrors);
    if (!isValid) return;
    const allMedia = [...postMedia, ...collectSectionMedia(sections)];
    if (!mediaDraftsAreReady(allMedia) || mediaDraftsHaveErrors(allMedia)) {
      setErrors((current) => ({ ...current, media: 'Please finish or remove image uploads.' }));
      return;
    }

    const firstQuestion = sections[0]?.questions[0];
    const computedTitle = title.trim() || firstQuestion?.text.trim() || 'Untitled Quiz';

    try {
      setIsSubmitting(true);
      await onSubmit({
        title: computedTitle,
        description,
        type: SurveyType.QUIZ,
        category,
        sections: serializeSections(sections),
        coverImage: postMedia.length > 0 ? undefined : (legacyCoverImage || undefined),
        mediaAssetIds: readyMediaAssetIds(postMedia),
        mediaAspectRatio: postMedia.length > 0 ? mediaAspectRatio : undefined,
        targetAudience: visibility as any,
        targetGroups: (visibility === 'Groups' || visibility === 'ProfileAndGroups') ? selectedGroups : [],
        taggedUserIds: taggedPeople.map((person) => person.id),
        resultsWho,
        resultsTiming,
        allowAnonymous: true,
        forceAnonymous: forceAnonymous,
        expiresAt: getExpiresAt(),
        demographics: selectedDemographics,
        author: { id: userProfile.id || "", name: userProfile.name, avatar: userProfile.avatar },
        createdAt: new Date().toISOString()
      });
      await cancelTemporaryMediaDrafts(collectInactiveSectionMedia(sections));
      onClose();
    } catch (error) {
      console.error('Failed to publish quiz:', error);
      alert('Failed to publish quiz. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const addSection = () => {
    const newId = `sec-quiz-${Date.now()}`;
    const newQId = `q-quiz-${Date.now()}`;
    setSections([...sections, {
      id: newId, title: '',
      questions: [{
        id: newQId, text: '', type: 'multiple_choice', isRequired: true, weight: 10, imageLayout: 'vertical', optionPresentation: 'text', showOptionNames: true,
        mediaDrafts: [],
        options: [{ id: `o1-${Date.now()}`, text: '', votes: 0, mediaDrafts: [] }, { id: `o2-${Date.now()}`, text: '', votes: 0, mediaDrafts: [] }]
      }]
    }]);
    setActiveSectionId(newId);
    setActiveQuestionId(newQId);
  };

  const handleAddQuizOption = (secId: string, qId: string) => {
    const newOpt = createQuizOption();
    const section = sections.find(s => s.id === secId);
    const question = section?.questions.find(qu => qu.id === qId);
    if (question) {
      updateQuestion(secId, qId, { options: [...(question.options || []), newOpt] });
      setFocusedOptionId(newOpt.id);
    }
  };

  const updateQuestion = (secId: string, qId: string, updates: Partial<SurveyQuestionDraft>) => {
    setSections((current) => current.map(s => s.id === secId ? { ...s, questions: s.questions.map(q => q.id === qId ? { ...q, ...updates } : q) } : s));
  };

  const updateOption = (secId: string, qId: string, optId: string, updates: Partial<SurveyOptionDraft>) => {
    setSections((current) => current.map((section) => section.id !== secId ? section : {
      ...section,
      questions: section.questions.map((question) => question.id !== qId || !question.options ? question : {
        ...question,
        options: question.options.map((option) => option.id === optId ? { ...option, ...updates } : option)
      })
    }));
  };



  const moveOption = (secId: string, qId: string, optId: string, direction: 'up' | 'down') => {
    setSections(sections.map(s => s.id === secId ? {
      ...s,
      questions: s.questions.map(q => {
        if (q.id !== qId || !q.options) return q;
        const index = q.options.findIndex(o => o.id === optId);
        if (index === -1 || (direction === 'up' && index === 0) || (direction === 'down' && index === q.options.length - 1)) return q;
        const newOptions = [...q.options];
        const swapIndex = direction === 'up' ? index - 1 : index + 1;
        [newOptions[index], newOptions[swapIndex]] = [newOptions[swapIndex], newOptions[index]];
        return { ...q, options: newOptions };
      })
    } : s));
  };

  const moveQuestion = (secId: string, qId: string, direction: 'up' | 'down') => {
    setSections(sections.map(s => {
      if (s.id !== secId) return s;
      const index = s.questions.findIndex(q => q.id === qId);
      if (index === -1 || (direction === 'up' && index === 0) || (direction === 'down' && index === s.questions.length - 1)) return s;
      const newQs = [...s.questions];
      const swapIndex = direction === 'up' ? index - 1 : index + 1;
      [newQs[index], newQs[swapIndex]] = [newQs[swapIndex], newQs[index]];
      return { ...s, questions: newQs };
    }));
  };

  const moveSection = (id: string, direction: 'up' | 'down') => {
    const index = sections.findIndex(s => s.id === id);
    if (index === -1 || (direction === 'up' && index === 0) || (direction === 'down' && index === sections.length - 1)) return;
    const newSections = [...sections];
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    [newSections[index], newSections[swapIndex]] = [newSections[swapIndex], newSections[index]];
    setSections(newSections);
  };

  const handleDemographicToggle = (id: string) => {
    setSelectedDemographics(prev => prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]);
  };


  const selectedOptionForSettings = useMemo(() => {
    if (!settingsOptionId) return null;
    return sections.find(s => s.id === settingsOptionId.secId)?.questions.find(q => q.id === settingsOptionId.qId)?.options?.find(o => o.id === settingsOptionId.optId);
  }, [settingsOptionId, sections]);

  const errorInfo = validateQuiz(composerStep === 2);
  const allMediaDrafts = [...postMedia, ...collectSectionMedia(sections)];
  const mediaReady = mediaDraftsAreReady(allMediaDrafts) && !mediaDraftsHaveErrors(allMediaDrafts);

  const handleNext = () => {
    const validation = validateQuiz(false);
    setHasAttemptedSubmit(true);
    setErrors(validation.newErrors);
    if (!validation.isValid || !mediaReady || isSubmitting) return;
    setComposerStep(2);
    setHasAttemptedSubmit(false);
    scrollContainerRef.current?.scrollTo({ top: 0 });
  };

  return (
    <div className="absolute inset-0 z-[60] bg-white flex flex-col animate-in slide-in-from-bottom duration-300">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-white/95 backdrop-blur-md sticky top-0 z-40 safe-top shrink-0">
        <button aria-label={composerStep === 2 ? 'Back' : 'Close'} onClick={() => { if (composerStep === 2) { setComposerStep(1); setHasAttemptedSubmit(false); scrollContainerRef.current?.scrollTo({ top: 0 }); } else handleClose(); }} className="p-2 -ml-2 hover:bg-gray-50 rounded-full text-gray-500">
          <ArrowLeft size={24} />
        </button>
        <div className="text-center"><h1 className="text-[12px] font-bold text-gray-800">New Quiz</h1><p className="text-xs text-gray-500">Step {composerStep} of 2</p></div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSaveDraft}
            disabled={!mediaReady || isSubmitting}
            className="text-purple-600 border border-purple-200 font-black text-[9px] px-3.5 py-2 rounded-full bg-purple-50 hover:bg-purple-100 transition-all uppercase tracking-widest active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Save Draft
          </button>
          <button
            onClick={() => composerStep === 1 ? handleNext() : handlePost()}
            disabled={!mediaReady || isSubmitting}
            aria-disabled={!mediaReady || isSubmitting}
            className={`text-white font-bold text-[12px] px-4 py-2 rounded-full transition-all uppercase tracking-widest ${
              mediaReady && !isSubmitting
                ? 'bg-purple-600 hover:bg-purple-700 shadow-md active:scale-95 shadow-purple-200/50'
                : 'bg-gray-300 shadow-none cursor-not-allowed'
            }`}
          >
            {composerStep === 1 ? 'Next' : 'Post'}
          </button>
        </div>
      </div>

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto no-scrollbar bg-white">
        <div className="max-w-md mx-auto p-5 pb-32">
          {errorInfo.newErrors.userProfile && (
            <div className="p-3 mb-4 bg-red-50 text-red-600 border border-red-100 rounded-xl text-xs font-bold flex items-center gap-2">
              <AlertCircle size={16} />
              <span>{errorInfo.newErrors.userProfile}</span>
            </div>
          )}

          <div hidden={composerStep !== 1} className="space-y-4">
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
            <PeopleTagPicker variant="chip" selectedPeople={taggedPeople} onChange={setTaggedPeople} accent="purple" />
          </div>
          {/* Details Section */}
          <section className="space-y-4 pb-4 border-b border-gray-100 relative transition-all">
            <div className="flex items-start gap-3">
              <div className="flex-1">
                {shouldShowTitleField && (
                  <RichMentionInput
                    value={title}
                    onChange={(val) => setTitle(val)}
                    placeholder="Quiz Title"
                    className="text-[12px] leading-relaxed text-start font-normal bg-transparent border-b border-gray-100 focus:outline-none focus:border-purple-500 transition-all pt-0.5 pb-1.5 placeholder-gray-400 min-h-[44px] text-gray-900"
                    minRows={1}
                  />
                )}
                <RichMentionInput
                  value={description}
                  onChange={(val) => setDescription(val)}
                  placeholder="Describe what this quiz is about (optional)..."
                  className="mt-1.5 text-[16px] leading-6 text-start text-gray-500 bg-transparent border-b border-gray-100 focus:outline-none focus:border-purple-500 transition-all pt-0.5 pb-1.5 placeholder-gray-400 min-h-[32px]"
                  minRows={1}
                />
              </div>
              <button
                type="button"
                onClick={() => postMediaPickerRef.current?.open()}
                disabled={postMedia.length >= 8}
                className={`p-1.5 rounded-full transition-colors shrink-0 mt-1 disabled:opacity-40 ${postMedia.length > 0 || legacyCoverImage ? 'text-purple-600 bg-purple-50' : 'text-gray-400 hover:text-purple-500 hover:bg-gray-50'}`}
                aria-label="Add quiz images"
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

          </section>

          {/* Question Builder Area */}
          <div className="space-y-6 mt-4">
            {activeSection && (
              <div className="space-y-4 animate-in fade-in duration-300">
                {/* Questions Tab/Progress Row */}
                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 px-1">
                  {activeSection.questions.map((q, qIdx) => {
                    const globalQNum = getQuestionCountBeforeSection(activeSectionIndex) + qIdx + 1;
                    return (
                      <button
                        key={q.id}
                        onClick={() => setActiveQuestionId(q.id)}
                        className={`shrink-0 h-10 w-10 rounded-full text-xs font-black border transition-all flex items-center justify-center ${
                          activeQuestionId === q.id
                            ? 'bg-green-600 text-white border-green-600 shadow-md shadow-green-100'
                            : 'bg-gray-50 text-gray-400 border-gray-100'
                        }`}
                      >
                        Q{globalQNum}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => {
                      const qId = `q-quiz-${Date.now()}`;
                      setSections(sections.map(s => s.id === activeSection.id ? {
                        ...s,
                        questions: [...s.questions, {
                          id: qId,
                          text: '',
                          type: 'multiple_choice',
                          isRequired: true,
                          weight: 10,
                          imageLayout: 'vertical',
                          optionPresentation: 'text',
                          showOptionNames: true,
                          mediaDrafts: [],
                          options: [
                            { id: `o1-${Date.now()}`, text: '', votes: 0, mediaDrafts: [] },
                            { id: `o2-${Date.now()}`, text: '', votes: 0, mediaDrafts: [] }
                          ]
                        }]
                      } : s));
                      setActiveQuestionId(qId);
                    }}
                    className="shrink-0 px-4 py-2 rounded-full bg-white text-green-600 border border-dashed border-green-200 flex items-center justify-center gap-1.5 text-xs font-bold h-10 active:scale-95 transition-transform"
                  >
                    <Plus size={14} /> Add Question
                  </button>
                </div>

                {/* Active Question Card */}
                {activeQuestionId && (() => {
                  const q = activeSection.questions.find(qu => qu.id === activeQuestionId);
                  if (!q) return null;
                  const optionPresentation = resolveOptionPresentation(q.optionPresentation, q.options);

                  return (
                    <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-4 shadow-sm">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1 flex flex-col gap-2">
                          {(q.image || q.mediaDrafts.length > 0) && (
                            <div className="relative w-24 h-24 rounded-xl overflow-hidden shadow-sm group animate-in zoom-in-95">
                              {q.mediaDrafts[0]?.previewUrl ? (
                                <img src={q.mediaDrafts[0].previewUrl} className="w-full h-full object-cover" alt="" />
                              ) : q.mediaDrafts[0]?.presentation ? (
                                <MediaImage media={q.mediaDrafts[0].presentation} className="w-full h-full object-cover" />
                              ) : q.image ? (
                                <img src={q.image} className="w-full h-full object-cover" alt="" />
                              ) : null}
                              <button
                                type="button"
                                onClick={() => {
                                  void cancelTemporaryMediaDrafts(q.mediaDrafts);
                                  updateQuestion(activeSection.id, q.id, { image: undefined, imageMediaId: undefined, mediaDrafts: [] });
                                }}
                                className="absolute top-1 right-1 p-1 bg-black/50 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                                aria-label="Remove question image"
                                title="Remove question image"
                              ><X size={10} /></button>
                            </div>
                          )}
                          <div className="flex items-center gap-2">
                            <MediaPicker
                              purpose="QUESTION_IMAGE"
                              value={q.mediaDrafts}
                              onChange={(mediaDrafts) => updateQuestion(activeSection.id, q.id, {
                                mediaDrafts,
                                image: mediaDrafts.some((media) => media.status === 'ready') ? undefined : q.image,
                                imageMediaId: readyMediaAssetIds(mediaDrafts)[0]
                              })}
                              className="shrink-0"
                              renderContent={({ open, retry, busy }) => {
                                const current = q.mediaDrafts[0];
                                return (
                                  <button
                                    type="button"
                                    onClick={() => current?.status === 'error' ? retry(current.clientId) : open()}
                                    disabled={busy}
                                    className={`relative p-1.5 rounded-full transition-colors disabled:cursor-wait ${q.image || current ? 'text-purple-600 bg-purple-50' : 'text-gray-400 hover:text-purple-500 hover:bg-gray-50'}`}
                                    aria-label={current?.status === 'error' ? 'Retry question image upload' : 'Add question image'}
                                    title={current?.status === 'error' ? 'Retry' : 'Add question image'}
                                  >
                                    <Camera size={20} />
                                    {busy && <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-purple-500" />}
                                  </button>
                                );
                              }}
                            />
                            <textarea dir="auto"
                              value={q.text}
                              onChange={(e) => updateQuestion(activeSection.id, q.id, { text: e.target.value })}
                              placeholder={totalQuestions <= 1 ? "Ask a question..." : "Question Text"}
                              className="min-w-0 flex-1 text-[12px] leading-relaxed text-start font-normal text-gray-900 border-b border-gray-100 focus:outline-none focus:border-purple-500 pt-0.5 pb-1.5 resize-none min-h-[44px] placeholder-gray-400 bg-transparent"
                            />
                          </div>
                        </div>
                        <button onClick={() => setIsQuestionSettingsSheetOpen(true)} className="p-3 text-gray-400 hover:text-gray-655 hover:bg-gray-50 rounded-full transition-all shrink-0 mt-1 flex items-center justify-center min-w-[44px] min-h-[44px]"><MoreHorizontalIcon size={20} /></button>
                      </div>


                      <div className="space-y-2 pt-2">
                        <label className="block px-1 text-[10px] font-black uppercase tracking-widest text-gray-600">{t('answerType.label')}</label>
                        <AnswerTypeSelector
                          value={optionPresentation}
                          modes={['text', 'image']}
                          accent="purple"
                          onChange={(value) => value !== 'rating' && updateQuestion(activeSection.id, q.id, { optionPresentation: value })}
                        />
                      </div>

                      {q.type === 'multiple_choice' && optionPresentation === 'image' && (<div className="flex items-center justify-between pt-2"><span className="text-xs font-bold text-gray-500">Options layout</span><div className="flex gap-2">{[{ id: 'vertical', label: 'List', icon: List }, { id: 'horizontal', label: 'Grid', icon: LayoutGrid }].map(layout => <button type="button" key={layout.id} aria-label={`${layout.label} options layout`} aria-pressed={q.imageLayout === layout.id} onClick={() => updateQuestion(activeSection.id, q.id, { imageLayout: layout.id as 'vertical' | 'horizontal' })} className={`p-2 rounded-lg border ${q.imageLayout === layout.id ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-500 border-gray-200'}`}><layout.icon size={16} /></button>)}</div></div>)}
                      {q.type === 'multiple_choice' && (
                        <div className="space-y-3 pt-2 border-t border-gray-50">
                          <div className="flex items-center justify-between px-1 mb-1">
                            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Options (Select Correct)</span>
                            {!q.correctOptionId && <span className="text-[9px] font-bold text-red-500 animate-pulse">Required: Select correct answer</span>}
                          </div>
                          {optionPresentation === 'image' && (
                            <OptionImagePicker
                              options={q.options || []}
                              onChange={(options) => updateQuestion(activeSection.id, q.id, { options })}
                              createOption={createQuizOption}
                            >
                              {(controls) => (
                                <div className="space-y-3">
                                  <button type="button" onClick={controls.openBulk} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-purple-300 bg-purple-50/50 px-3 text-xs font-bold text-purple-700">
                                    <ImageIcon size={16} aria-hidden="true" />
                                    {q.options?.some(draftOptionHasImage) ? t('answerType.addMoreImages') : t('answerType.addImages')}
                                  </button>

                                </div>
                              )}
                            </OptionImagePicker>
                          )}
                          {q.options?.map((opt, oIdx) => {
                            const isCorrect = q.correctOptionId === opt.id;
                            return (
                              <div key={opt.id} className="flex flex-col gap-1 animate-in fade-in slide-in-from-bottom-1 duration-200">
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => updateQuestion(activeSection.id, q.id, { correctOptionId: opt.id })}
                                    className={`shrink-0 w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all ${isCorrect ? 'bg-green-500 border-green-500 text-white shadow-md shadow-green-100' : 'bg-white border-gray-200 text-gray-300 hover:border-green-200 hover:text-green-400'}`}
                                  >
                                    <CheckCircle2 size={18} strokeWidth={3} />
                                  </button>
                                  <div className={`min-w-0 flex-1 flex items-center bg-gray-50 rounded-xl px-1 py-1 border transition-all shadow-sm ${isCorrect ? 'border-green-200 ring-2 ring-green-50 bg-green-50/20' : 'border-transparent focus-within:border-purple-200 focus-within:bg-white'}`}>
                                    {optionPresentation === 'image' && <MediaPicker
                                      purpose="OPTION_IMAGE"
                                      value={opt.mediaDrafts}
                                      onChange={(mediaDrafts) => updateOption(activeSection.id, q.id, opt.id, {
                                        mediaDrafts,
                                        image: mediaDrafts.some((media) => media.status === 'ready') ? undefined : opt.image,
                                        imageMediaId: readyMediaAssetIds(mediaDrafts)[0]
                                      })}
                                      className="mr-1 shrink-0"
                                      renderContent={({ open, replace, retry, busy }) => {
                                        const current = opt.mediaDrafts[0];
                                        const hasImage = Boolean(current || opt.image);
                                        return (
                                          <button
                                            type="button"
                                            onClick={() => current?.status === 'error' ? retry(current.clientId) : current ? replace(current.clientId) : open()}
                                            disabled={busy}
                                            className={`relative w-12 h-12 rounded-lg flex items-center justify-center shrink-0 overflow-hidden border border-dashed transition-all disabled:cursor-wait ${hasImage ? 'border-purple-500' : 'border-gray-200 text-gray-400 hover:text-purple-500'}`}
                                            aria-label={current?.status === 'error' ? 'Retry option image upload' : `Add image to option ${oIdx + 1}`}
                                            title={current?.status === 'error' ? 'Retry' : 'Add option image'}
                                          >
                                            {current?.previewUrl ? (
                                              <img src={current.previewUrl} className="w-full h-full object-cover" alt="" />
                                            ) : current?.presentation ? (
                                              <MediaImage media={current.presentation} className="w-full h-full object-cover" />
                                            ) : opt.image ? (
                                              <img src={opt.image} className="w-full h-full object-cover" alt="" />
                                            ) : (
                                              <Camera size={16} />
                                            )}
                                            {busy && <span className="absolute inset-x-0 bottom-0 h-1 bg-purple-500" />}
                                          </button>
                                        );
                                      }}
                                    />}
                                    <input dir="auto"
                                      type="text"
                                      value={opt.text}
                                      maxLength={80}
                                      autoFocus={focusedOptionId === opt.id}
                                      onChange={(e) => { const updated = q.options?.map(o => o.id === opt.id ? { ...o, text: e.target.value } : o); updateQuestion(activeSection.id, q.id, { options: updated }); }}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          e.preventDefault();
                                          handleAddQuizOption(activeSection.id, q.id);
                                        }
                                      }}
                                      onBlur={() => {
                                        if (focusedOptionId === opt.id) setFocusedOptionId(null);
                                      }}
                                      placeholder={`Option ${oIdx + 1}`}
                                      className="min-w-0 flex-1 text-[12px] leading-relaxed text-start font-normal p-2 bg-transparent focus:outline-none placeholder-gray-400"
                                    />
                                    <span className="text-[9px] text-gray-500 mr-1.5 whitespace-nowrap">{opt.text.length}/80</span>
                                    {optionPresentation === 'image' && (opt.image || opt.mediaDrafts.length > 0) && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          void cancelTemporaryMediaDrafts(opt.mediaDrafts);
                                          updateOption(activeSection.id, q.id, opt.id, { image: undefined, imageMediaId: undefined, mediaDrafts: [] });
                                        }}
                                        className="p-3 text-gray-300 hover:text-red-500 rounded-full flex items-center justify-center min-w-[44px] min-h-[44px]"
                                        aria-label={`Remove image from option ${oIdx + 1}`}
                                        title="Remove option image"
                                      ><X size={12} /></button>
                                    )}
                                    <button onClick={() => setSettingsOptionId({ secId: activeSection.id, qId: q.id, optId: opt.id })} className="p-3 text-gray-400 hover:text-gray-600 rounded-full flex items-center justify-center min-w-[44px] min-h-[44px] transition-colors"><MoreHorizontalIcon size={18} /></button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}

                          {/* Interactive Placeholder / Auto-Add Option */}
                          <div className="flex items-center gap-2 opacity-50 hover:opacity-80 focus-within:opacity-100 transition-opacity duration-200">
                            <button disabled className="shrink-0 w-8 h-8 rounded-full border-2 border-dashed border-gray-200 flex items-center justify-center text-gray-300">
                              <CheckCircle2 size={18} />
                            </button>
                            <div className="min-w-0 flex-1 flex items-center bg-gray-50/50 border border-dashed border-gray-200 rounded-xl px-1 py-1">
                              {optionPresentation === 'image' && <button disabled className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0 border border-dashed border-gray-200 text-gray-300 mr-1">
                                <Camera size={16} />
                              </button>}
                              <input dir="auto"
                                type="text"
                                placeholder="Add option..."
                                className="min-w-0 flex-1 text-[12px] leading-relaxed text-start font-normal p-2 bg-transparent focus:outline-none text-gray-500 placeholder-gray-500 cursor-pointer"
                                onFocus={() => handleAddQuizOption(activeSection.id, q.id)}
                              />
                              <button disabled className="p-3 text-gray-300 rounded-full flex items-center justify-center min-w-[44px] min-h-[44px]">
                                <MoreHorizontalIcon size={18} />
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

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
            accent="purple"
          />
          {/* Demographics Settings Section (Unlock Deeper Analytics) */}
          {/* Demographics Settings Section (Unlock Deeper Analytics) */}
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
                  className="text-gray-400 hover:text-purple-500 transition-colors ml-0.5"
                >
                  <Info size={14} />
                </button>
              </div>
            </div>

            {showInsightInfo && (
              <div className="p-3 bg-purple-50 border border-purple-100 text-purple-800 text-[10px] font-semibold rounded-xl leading-relaxed animate-in fade-in slide-in-from-top-1 duration-200">
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
                        ? 'bg-purple-600 text-white border-purple-600 shadow-sm'
                        : 'bg-white text-gray-550 border-gray-200 hover:bg-gray-55'
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
                  <span className="text-[10px] font-extrabold text-purple-600 whitespace-nowrap">
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
              <div className="space-y-2 p-3 bg-gray-55/35 border border-gray-100 rounded-2xl animate-in fade-in duration-200">
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
                        className={`px-3 py-1.5 rounded-full text-[9px] font-bold border transition-all flex items-center gap-1 active:scale-95 ${
                          isSelected
                            ? 'bg-purple-50 border-purple-200 text-purple-600 font-semibold'
                            : 'bg-white border-gray-200 text-gray-400'
                        }`}
                      >
                        {isSelected && <Check size={10} strokeWidth={4} />}
                        <span>{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          {/* Advanced Settings Row */}
          <section className="pt-2">
            <button
              type="button"
              onClick={() => {
                setAdvancedSheetView('main');
                setIsAdvancedSheetOpen(true);
              }}
              className="w-full flex items-center justify-between py-2.5 px-1 text-left transition-all active:opacity-75 pt-3 border-t border-gray-100"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gray-55/30 rounded-xl text-gray-500 border border-gray-100">
                  <Settings size={16} />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-gray-805">Advanced Settings</h4>
                  <p className="text-[9px] text-gray-500 mt-0.5 leading-tight">Results, duration & comments</p>
                </div>
              </div>
              <ChevronRight size={14} className="text-gray-400" />
            </button>
          </section>

          </div>
          {/* Unified Validation Error Display */}
          {hasAttemptedSubmit && !errorInfo.isValid && (
            <div className="p-4 bg-red-50 text-red-600 border border-red-200 rounded-2xl text-xs font-semibold flex flex-col gap-2 mt-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex items-center gap-2 font-bold text-red-800">
                <AlertCircle size={16} />
                <span>Please correct the following errors to {composerStep === 1 ? 'continue' : 'post'}:</span>
              </div>
              <ul className="list-disc pl-5 space-y-1">
                {errorInfo.errors.map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Advanced Settings Bottom Sheet with Sub-navigation Routing */}
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
              <p className="text-[11px] text-gray-500 leading-relaxed px-1">
                Control results, duration, and comments.
              </p>

              {/* Sub-routing rows */}
              <div className="space-y-1.5">
                {/* Results Visibility Sub-trigger */}
                <button
                  type="button"
                  onClick={() => setAdvancedSheetView('results')}
                  className="w-full flex items-center justify-between p-3.5 bg-gray-50 hover:bg-gray-100/70 rounded-xl transition-all border border-gray-100"
                >
                  <span className="text-xs font-bold text-gray-805">Result Visibility</span>
                  <div className="flex items-center gap-1 text-xs text-purple-600 font-black">
                    <span>{resultsWho === 'OnlyMe' ? 'Only Me' : resultsWho}</span>
                    <ChevronRight size={14} />
                  </div>
                </button>
              </div>

              {/* Duration section inline inside settings sheet */}
              <div className="space-y-3 pb-4 border-b border-gray-100 pt-1">
                <label className="flex items-center gap-2 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                  <Calendar size={12} /> Quiz Duration
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {durationOptions.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setDuration(opt.value)}
                      className={`py-2 rounded-xl text-xs font-bold border transition-all ${
                        duration === opt.value
                          ? 'bg-purple-600 text-white border-purple-600 shadow-sm shadow-purple-100'
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
                        ? 'bg-purple-600 text-white border-purple-600 shadow-sm shadow-purple-100'
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
                      className="w-full bg-purple-50/50 border border-purple-100 rounded-xl px-4 py-2.5 text-xs font-bold focus:outline-none focus:bg-white focus:border-purple-500 transition-all text-purple-900"
                    />
                  </div>
                )}
              </div>

              {/* Toggles List */}
              <div className="space-y-4 pt-1">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col text-left">
                    <span className="text-xs font-bold text-gray-800">Allow comments</span>
                    <span className="text-[10px] text-gray-500">Enable user comments on the post</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAllowComments(!allowComments)}
                    className={`w-10 h-5 rounded-full relative transition-colors ${allowComments ? 'bg-purple-600' : 'bg-gray-200'}`}
                  >
                    <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${allowComments ? 'left-6' : 'left-1'}`} />
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
                    className={`w-10 h-5 rounded-full relative transition-colors ${forceAnonymous ? 'bg-purple-600' : 'bg-gray-200'}`}
                  >
                    <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${forceAnonymous ? 'left-6' : 'left-1'}`} />
                  </button>
                </div>
              </div>

              <div className="pt-4">
                <button
                  onClick={() => setIsAdvancedSheetOpen(false)}
                  className="w-full bg-gray-900 text-white py-3.5 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-lg active:scale-95 transition-all"
                >
                  Done
                </button>
              </div>
            </div>
          )}

          {/* Results View Sub-screen */}
          {advancedSheetView === 'results' && (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => setAdvancedSheetView('main')}
                className="flex items-center gap-1.5 text-xs text-purple-600 font-bold hover:opacity-80 transition-opacity pb-2"
              >
                <span>&larr; Back to Advanced Settings</span>
              </button>

              <div className="space-y-2">
                {[
                  { id: 'Public', label: 'Public', desc: 'Results are visible to everyone.' },
                  { id: 'Participants', label: 'Participants Only', desc: 'Only participants can see results after voting.' },
                  { id: 'OnlyMe', label: 'Private (Only Me)', desc: 'Only you can see the results.' }
                ].map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setResultsWho(opt as any)}
                    className="w-full flex items-center justify-between p-4 rounded-2xl border transition-all text-left"
                    style={{ borderColor: resultsWho === opt ? '#9333ea' : '#f3f4f6', backgroundColor: resultsWho === opt ? '#faf5ff' : 'white' }}
                  >
                    <div>
                      <span className={`text-sm font-bold block ${resultsWho === opt ? 'text-purple-700' : 'text-gray-700'}`}>{opt.label}</span>
                      <span className="text-[10px] text-gray-550 leading-tight mt-0.5 block">{opt.desc}</span>
                    </div>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${resultsWho === opt ? 'border-purple-600 bg-purple-600' : 'border-gray-200'}`}>
                      {resultsWho === opt && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                    </div>
                  </button>
                ))}
              </div>

              {/* Result timing selector sub-section */}
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
                      disabled={!opt.enabled}
                      onClick={() => setResultsTiming(opt as any)}
                      className={`w-full flex items-center justify-between p-4 rounded-2xl border transition-all text-left ${!opt.enabled ? 'opacity-40 cursor-not-allowed bg-gray-55 grayscale' : ''}`}
                      style={{ borderColor: resultsTiming === opt ? '#9333ea' : '#f3f4f6', backgroundColor: resultsTiming === opt ? '#faf5ff' : 'white' }}
                    >
                      <span className={`text-sm font-bold ${resultsTiming === opt ? 'text-purple-700' : 'text-gray-700'}`}>{opt.label}</span>
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${resultsTiming === opt ? 'border-purple-600 bg-purple-600' : 'border-gray-200'}`}>
                        {resultsTiming === opt && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </BottomSheet>

      {/* Category Bottom Sheet */}
      <BottomSheet isOpen={isCategorySheetOpen} onClose={() => setIsCategorySheetOpen(false)} title="Select Category">
        <div className="flex flex-wrap gap-2 py-2">
          {QUIZ_CATEGORIES.map(cat => (
            <button key={cat} onClick={() => { setCategory(cat); setErrors(previous => ({ ...previous, category: false })); setIsCategorySheetOpen(false); }} className={`px-4 py-2 rounded-full text-xs font-bold border transition-all ${category === cat ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-650 border-gray-200 hover:bg-gray-50'}`}>{cat}</button>
          ))}
        </div>
      </BottomSheet>

      {/* Option Settings Bottom Sheet */}
      <BottomSheet isOpen={!!settingsOptionId} onClose={() => setSettingsOptionId(null)} title="Option Settings">
        {selectedOptionForSettings && (
          <div className="space-y-6 py-4 px-2">
            <button disabled={sections.find(s => s.id === settingsOptionId!.secId)?.questions.find(q => q.id === settingsOptionId!.qId)?.options?.indexOf(selectedOptionForSettings) === 0} onClick={() => { moveOption(settingsOptionId!.secId, settingsOptionId!.qId, settingsOptionId!.optId, 'up'); setSettingsOptionId(null); }} className="w-full flex items-center gap-4 p-4 rounded-2xl border hover:bg-gray-50 disabled:opacity-30">
              <div className="p-2.5 rounded-xl bg-gray-100 text-gray-500"><ArrowUp size={20} /></div><span className="font-bold text-sm text-gray-900">Move Up</span>
            </button>
            <button disabled={sections.find(s => s.id === settingsOptionId!.secId)?.questions.find(q => q.id === settingsOptionId!.qId)?.options?.indexOf(selectedOptionForSettings) === (sections.find(s => s.id === settingsOptionId!.secId)?.questions.find(q => q.id === settingsOptionId!.qId)?.options?.length || 0) - 1} onClick={() => { moveOption(settingsOptionId!.secId, settingsOptionId!.qId, settingsOptionId!.optId, 'down'); setSettingsOptionId(null); }} className="w-full flex items-center gap-4 p-4 rounded-2xl border hover:bg-gray-50 disabled:opacity-30">
              <div className="p-2.5 rounded-xl bg-gray-100 text-gray-500"><ArrowDown size={20} /></div><span className="font-bold text-sm text-gray-900">Move Down</span>
            </button>
            
            {settingsOptionId && (
              <button
                disabled={(sections.find(s => s.id === settingsOptionId.secId)?.questions.find(q => q.id === settingsOptionId.qId)?.options?.length || 0) <= 2}
                onClick={() => {
                  const q = sections.find(s => s.id === settingsOptionId.secId)?.questions.find(q => q.id === settingsOptionId.qId);
                  if (q && q.options) {
                    const removed = q.options.find(o => o.id === settingsOptionId.optId);
                    if (removed) void cancelTemporaryMediaDrafts(removed.mediaDrafts);
                    const updated = q.options.filter(o => o.id !== settingsOptionId.optId);
                    updateQuestion(settingsOptionId.secId, settingsOptionId.qId, {
                      options: updated,
                      correctOptionId: q.correctOptionId === settingsOptionId.optId ? undefined : q.correctOptionId
                    });
                  }
                  setSettingsOptionId(null);
                }}
                className={`w-full flex items-center gap-4 p-4 rounded-2xl border transition-all text-left ${
                  (sections.find(s => s.id === settingsOptionId.secId)?.questions.find(q => q.id === settingsOptionId.qId)?.options?.length || 0) <= 2
                    ? 'opacity-30 grayscale cursor-not-allowed border-gray-100'
                    : 'hover:bg-red-50 hover:border-red-200 hover:text-red-600 border-gray-100 text-red-600 active:scale-[0.98]'
                }`}
              >
                <div className={`p-2.5 rounded-xl ${
                  (sections.find(s => s.id === settingsOptionId.secId)?.questions.find(q => q.id === settingsOptionId.qId)?.options?.length || 0) <= 2
                    ? 'bg-gray-100 text-gray-400'
                    : 'bg-red-50 text-red-500'
                }`}><Trash2 size={20} /></div>
                <span className="font-bold text-sm">Delete Option</span>
              </button>
            )}
            <button onClick={() => setSettingsOptionId(null)} className="w-full py-4 bg-gray-900 text-white rounded-2xl font-black uppercase tracking-widest text-[10px]">Done</button>
          </div>
        )}
      </BottomSheet>

      {/* Question Settings Bottom Sheet */}
      <BottomSheet isOpen={isQuestionSettingsSheetOpen} onClose={() => setIsQuestionSettingsSheetOpen(false)} title="Question Settings">
        {activeSection && activeQuestionId && (
          <div className="space-y-4 py-4 px-2">
            <button disabled={activeSection.questions.findIndex(q => q.id === activeQuestionId) === 0} onClick={() => { moveQuestion(activeSection.id, activeQuestionId, 'up'); setIsQuestionSettingsSheetOpen(false); }} className="w-full flex items-center gap-4 p-4 rounded-2xl border hover:bg-gray-50 disabled:opacity-30"><div className="p-2.5 rounded-xl bg-gray-100 text-gray-500"><ArrowUp size={20} /></div><span className="font-bold text-sm">Move Up</span></button>
            <button disabled={activeSection.questions.findIndex(q => q.id === activeQuestionId) === activeSection.questions.length - 1} onClick={() => { moveQuestion(activeSection.id, activeQuestionId, 'down'); setIsQuestionSettingsSheetOpen(false); }} className="w-full flex items-center gap-4 p-4 rounded-2xl border hover:bg-gray-50 disabled:opacity-30"><div className="p-2.5 rounded-xl bg-gray-100 text-gray-500"><ArrowDown size={20} /></div><span className="font-bold text-sm">Move Down</span></button>
            <button disabled={activeSection.questions.length <= 1} onClick={() => { const removed = activeSection.questions.find(q => q.id === activeQuestionId); if (removed) void cancelTemporaryMediaDrafts([...removed.mediaDrafts, ...(removed.options || []).flatMap((option) => option.mediaDrafts)]); setSections(sections.map(s => s.id === activeSection.id ? { ...s, questions: s.questions.filter(q => q.id !== activeQuestionId) } : s)); setIsQuestionSettingsSheetOpen(false); }} className="w-full flex items-center gap-4 p-4 rounded-2xl border border-red-100 bg-red-50/30 text-red-600 disabled:opacity-30"><div className="p-2.5 rounded-xl bg-red-100 text-red-600"><Trash2 size={20} /></div><span className="font-bold text-sm">Delete Question</span></button>
            <button onClick={() => setIsQuestionSettingsSheetOpen(false)} className="w-full mt-4 py-4 bg-gray-900 text-white rounded-2xl font-black uppercase tracking-widest text-[10px]">Done</button>
          </div>
        )}
      </BottomSheet>

      {/* Section Settings Bottom Sheet */}
      <BottomSheet isOpen={isSectionSettingsSheetOpen} onClose={() => setIsSectionSettingsSheetOpen(false)} title="Section Settings">
        {activeSection && (
          <div className="space-y-4 py-4 px-2">
            <button disabled={activeSectionIndex === 0} onClick={() => { moveSection(activeSection.id, 'up'); setIsSectionSettingsSheetOpen(false); }} className="w-full flex items-center gap-4 p-4 rounded-2xl border hover:bg-gray-50 disabled:opacity-30"><div className="p-2.5 rounded-xl bg-gray-100 text-gray-500"><ArrowUp size={20} /></div><span className="font-bold text-sm">Move Up</span></button>
            <button disabled={activeSectionIndex === sections.length - 1} onClick={() => { moveSection(activeSection.id, 'down'); setIsSectionSettingsSheetOpen(false); }} className="w-full flex items-center gap-4 p-4 rounded-2xl border hover:bg-gray-50 disabled:opacity-30"><div className="p-2.5 rounded-xl bg-gray-100 text-gray-500"><ArrowDown size={20} /></div><span className="font-bold text-sm">Move Down</span></button>
            <button disabled={sections.length <= 1} onClick={() => { void cancelTemporaryMediaDrafts(collectSectionMedia([activeSection], true)); setSections(sections.filter(s => s.id !== activeSection.id)); setIsSectionSettingsSheetOpen(false); }} className="w-full flex items-center gap-4 p-4 rounded-2xl border border-red-100 bg-red-50/30 text-red-600 disabled:opacity-30"><div className="p-2.5 rounded-xl bg-red-100 text-red-600"><Trash2 size={20} /></div><span className="font-bold text-sm">Delete Section</span></button>
            <button onClick={() => setIsSectionSettingsSheetOpen(false)} className="w-full mt-4 py-4 bg-gray-900 text-white rounded-2xl font-black uppercase tracking-widest text-[10px]">Done</button>
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
              <button onClick={handleSaveDraft} className="w-full py-3 bg-purple-50 text-purple-600 rounded-xl font-bold text-sm hover:bg-purple-100 transition-colors">Save as Draft</button>
              <button onClick={() => setShowExitConfirm(false)} className="w-full py-3 bg-gray-100 text-gray-700 rounded-xl font-bold text-sm hover:bg-gray-200 transition-colors">Keep Editing</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
