
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { X, Plus, Trash2, Globe, Users, ChevronDown, Clock, Calendar, Type, ListChecks, ImageIcon, Settings, Info, ArrowRight, Camera, Lock, AlertCircle, ChevronRight, ChevronLeft, MoreHorizontal, Layout, Terminal, Navigation, Sparkles, GripVertical, Save, FileText, BarChart3, UserCircle, Heart, Fingerprint, MapPin, Briefcase, Check, GraduationCap, Home, Smile, Building2, User, MessageSquare, ShieldCheck, Link2, Target, MoreHorizontal as MoreHorizontalIcon, ArrowUp, ArrowDown, Star, List, GalleryHorizontalEnd, CornerDownRight, PowerOff, CheckCircle2 } from 'lucide-react';
import { Survey, SurveyType, SurveySection, SurveyQuestion, Option, UserProfile, Group } from '../types';
import { ImageCropper } from './ImageCropper';
import { BottomSheet } from './BottomSheet';
import { RichMentionInput } from './RichMentionInput';
import { api } from '../services/api';

interface CreateQuizModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (surveyData: Partial<Survey>) => void;
  onSaveDraft?: (surveyData: Partial<Survey>) => void;
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
  { id: 'marital_status', label: 'Marital Status', desc: 'Identify trends based on marital status' },
  { id: 'residence', label: 'Country of Residence', desc: 'Analyze responses by participants country of residence' },
  { id: 'nationality', label: 'Nationality', desc: 'Analyze by responses by Nationality' },
  { id: 'age_group', label: 'Age Group', desc: 'Compare responses across age groups' },
  { id: 'education', label: 'Education Level', desc: 'Analyze responses by education level' },
  { id: 'employment', label: 'Employment Type', desc: 'Analyze responses by employment type' },
];

const INITIAL_SECTIONS: SurveySection[] = [
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
        options: [
          { id: `opt-quiz-init-1`, text: '', votes: 0 },
          { id: `opt-quiz-init-2`, text: '', votes: 0 }
        ]
      }
    ]
  }
];

type VisibilityType = 'Public' | 'Followers' | 'Groups' | 'Custom Audience' | 'Custom Domain';

export const CreateQuizModal: React.FC<CreateQuizModalProps> = ({ isOpen, onClose, onSubmit, onSaveDraft, userProfile, draft, userGroups = [], initialGroupId }) => {
  const [visibility, setVisibility] = useState<VisibilityType>(initialGroupId ? 'Groups' : 'Public');
  const [isVisibilitySheetOpen, setIsVisibilitySheetOpen] = useState(false);
  const [isResultVisibilitySheetOpen, setIsResultVisibilitySheetOpen] = useState(false);
  const [isCategorySheetOpen, setIsCategorySheetOpen] = useState(false);
  const [isDurationSheetOpen, setIsDurationSheetOpen] = useState(false);
  const [isDemographicsSheetOpen, setIsDemographicsSheetOpen] = useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

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
  const [coverImage, setCoverImage] = useState<string | null>(null);

  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);
  const [sections, setSections] = useState<SurveySection[]>(INITIAL_SECTIONS);

  const totalQuestions = useMemo(() => {
    return sections.reduce((sum, sec) => sum + (sec.questions?.length || 0), 0);
  }, [sections]);

  const shouldShowTitleField = useMemo(() => {
    return totalQuestions > 1 || (title.trim().length > 0 && draft);
  }, [totalQuestions, title, draft]);

  const [settingsOptionId, setSettingsOptionId] = useState<{ secId: string, qId: string, optId: string } | null>(null);
  const [isQuestionSettingsSheetOpen, setIsQuestionSettingsSheetOpen] = useState(false);
  const [isSectionSettingsSheetOpen, setIsSectionSettingsSheetOpen] = useState(false);

  const [selectedDemographics, setSelectedDemographics] = useState<string[]>(['gender', 'age_group', 'residence']);
  const [selectedGroups, setSelectedGroups] = useState<string[]>(initialGroupId ? [initialGroupId] : []);
  const [activePreset, setActivePreset] = useState<'recommended' | 'professional' | 'geographic' | 'custom'>('recommended');

  useEffect(() => {
    const isRecommended = selectedDemographics.length === 3 && selectedDemographics.includes('gender') && selectedDemographics.includes('age_group') && selectedDemographics.includes('residence');
    const isProfessional = selectedDemographics.length === 2 && selectedDemographics.includes('education') && selectedDemographics.includes('employment');
    const isGeographic = selectedDemographics.length === 2 && selectedDemographics.includes('residence') && selectedDemographics.includes('nationality');
    
    if (isRecommended) setActivePreset('recommended');
    else if (isProfessional) setActivePreset('professional');
    else if (isGeographic) setActivePreset('geographic');
    else setActivePreset('custom');
  }, [selectedDemographics]);

  const handlePresetChange = (preset: 'recommended' | 'professional' | 'geographic' | 'custom') => {
    setActivePreset(preset);
    if (preset === 'recommended') {
      setSelectedDemographics(['gender', 'age_group', 'residence']);
    } else if (preset === 'professional') {
      setSelectedDemographics(['education', 'employment']);
    } else if (preset === 'geographic') {
      setSelectedDemographics(['residence', 'nationality']);
    } else if (preset === 'custom') {
      setSelectedDemographics([]);
    }
  };

  const [croppingImage, setCroppingImage] = useState<string | null>(null);
  const [activeCropTarget, setActiveCropTarget] = useState<{ type: 'cover' | 'question' | 'option', secId?: string, qId?: string, optId?: string } | null>(null);

  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [errors, setErrors] = useState<{ [key: string]: boolean | string }>({});
  const [focusedOptionId, setFocusedOptionId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
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
      setCoverImage(draft.coverImage || null);
      if (draft.sections && draft.sections.length > 0) {
        setSections(draft.sections);
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

  const postableGroups = useMemo(() => {
    return userGroups.filter(group => {
      const isAdminOrOwner = group.role === 'Owner' || group.role === 'Admin';
      const hasExplicitPermission = group.postingPermissions === 'AllMembers' || group.postingPermissions === 'ApprovalNeeded';
      return isAdminOrOwner || hasExplicitPermission;
    });
  }, [userGroups]);

  const visibilityOptions = [
    { id: 'Public', label: 'Public', desc: 'Visible to all users on the platform.', icon: Globe, allowed: true },
    { id: 'Followers', label: 'Followers', desc: 'Visible only to users who follow you.', icon: UserCircle, allowed: true },
    { id: 'Groups', label: 'Selected groups', desc: 'Visible only within selected groups.', icon: Users, allowed: true },
    { id: 'Custom Audience', label: 'Custom audience', desc: 'Specific targeted audience.', icon: Target, allowed: isVerified, premium: true },
    { id: 'Custom Domain', label: 'Custom domain', desc: 'Private branded link.', icon: Link2, allowed: false, premium: true },
  ];

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
    if (coverImage !== null) return true;
    if (sections.length > 1) return true;
    const firstQ = sections[0].questions[0];
    if (firstQ.text.trim() !== '') return true;
    if (sections[0].questions.length > 1) return true;
    return false;
  }, [title, description, category, coverImage, sections, draft]);

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

  const validateQuiz = () => {
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

    if (visibility === 'Groups' && selectedGroups.length === 0) {
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
          const filledOptions = q.options?.filter(o => o.text.trim() !== '');
          if ((filledOptions?.length || 0) < 2) {
            errorList.push(`Question ${qNum}: At least 2 options are required.`);
            hasQuestionError = true;
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

  const handleSaveDraft = () => {
    if (!userProfile?.id) {
      onClose();
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
        sections,
        coverImage: coverImage || undefined,
        targetAudience: visibility as any,
        targetGroups: visibility === 'Groups' ? selectedGroups : undefined,
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
      onSaveDraft(draftData);
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

  const handlePost = () => {
    setHasAttemptedSubmit(true);
    const { isValid, newErrors } = validateQuiz();
    setErrors(newErrors);
    if (!isValid) return;

    const firstQuestion = sections[0]?.questions[0];
    const computedTitle = title.trim() || firstQuestion?.text.trim() || 'Untitled Quiz';

    onSubmit({
      title: computedTitle,
      description,
      type: SurveyType.QUIZ,
      category,
      sections,
      coverImage: coverImage || undefined,
      targetAudience: visibility as any,
      targetGroups: visibility === 'Groups' ? selectedGroups : undefined,
      resultsWho,
      resultsTiming,
      allowAnonymous: true,
      forceAnonymous: forceAnonymous,
      expiresAt: getExpiresAt(),
      demographics: selectedDemographics,
      author: { id: userProfile.id || "", name: userProfile.name, avatar: userProfile.avatar },
      createdAt: new Date().toISOString()
    });
    onClose();
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const img = new Image();
      const objUrl = URL.createObjectURL(file);
      img.onload = () => {
        const MAX_DIMENSION = 1200;
        let width = img.width;
        let height = img.height;

        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
            const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            setCroppingImage(canvas.toDataURL('image/jpeg', 0.8));
        } else {
            const reader = new FileReader();
            reader.onloadend = () => setCroppingImage(reader.result as string);
            reader.readAsDataURL(file);
        }
        URL.revokeObjectURL(objUrl);
        // Clear value so the same file can be selected again
        e.target.value = '';
      };
      img.src = objUrl;
    }
  };

  const handleCropComplete = (croppedImg: string) => {
    if (!activeCropTarget) return;
    if (activeCropTarget.type === 'cover') setCoverImage(croppedImg);
    else if (activeCropTarget.type === 'question') updateQuestion(activeCropTarget.secId!, activeCropTarget.qId!, { image: croppedImg });
    else if (activeCropTarget.type === 'option') {
      setSections(sections.map(s => s.id === activeCropTarget.secId ? {
        ...s,
        questions: s.questions.map(q => q.id === activeCropTarget.qId && q.options ? {
          ...q,
          options: q.options.map(o => o.id === activeCropTarget.optId ? { ...o, image: croppedImg } : o)
        } : q)
      } : s));
    }
    setCroppingImage(null);
    setActiveCropTarget(null);
  };

  const addSection = () => {
    const newId = `sec-quiz-${Date.now()}`;
    const newQId = `q-quiz-${Date.now()}`;
    setSections([...sections, {
      id: newId, title: '',
      questions: [{
        id: newQId, text: '', type: 'multiple_choice', isRequired: true, weight: 10, imageLayout: 'vertical',
        options: [{ id: `o1-${Date.now()}`, text: '', votes: 0 }, { id: `o2-${Date.now()}`, text: '', votes: 0 }]
      }]
    }]);
    setActiveSectionId(newId);
    setActiveQuestionId(newQId);
  };

  const handleAddQuizOption = (secId: string, qId: string) => {
    const newOptId = `o-${Date.now()}`;
    const newOpt = { id: newOptId, text: '', votes: 0 };
    const section = sections.find(s => s.id === secId);
    const question = section?.questions.find(qu => qu.id === qId);
    if (question) {
      updateQuestion(secId, qId, { options: [...(question.options || []), newOpt] });
      setFocusedOptionId(newOptId);
    }
  };

  const updateQuestion = (secId: string, qId: string, updates: Partial<SurveyQuestion>) => {
    setSections(sections.map(s => s.id === secId ? { ...s, questions: s.questions.map(q => q.id === qId ? { ...q, ...updates } : q) } : s));
  };

  const handleChoiceTypeChange = (secId: string, qId: string, choiceType: 'multiple' | 'text') => {
    let newType: 'multiple_choice' | 'text' = 'multiple_choice';
    let newOptions: Option[] = [];
    if (choiceType === 'text') {
      newType = 'text';
      newOptions = [];
    } else {
      newOptions = [{ id: '1', text: '', votes: 0 }, { id: '2', text: '', votes: 0 }];
    }
    updateQuestion(secId, qId, { type: newType, options: newOptions, maxSelection: 1, correctOptionId: undefined });
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

  const handleGroupToggle = (groupId: string) => {
    setSelectedGroups(prev => prev.includes(groupId) ? prev.filter(id => id !== groupId) : [...prev, groupId]);
  };

  const selectedOptionForSettings = useMemo(() => {
    if (!settingsOptionId) return null;
    return sections.find(s => s.id === settingsOptionId.secId)?.questions.find(q => q.id === settingsOptionId.qId)?.options?.find(o => o.id === settingsOptionId.optId);
  }, [settingsOptionId, sections]);

  const errorInfo = validateQuiz();

  return (
    <div className="absolute inset-0 z-[60] bg-white flex flex-col animate-in slide-in-from-bottom duration-300">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-white/95 backdrop-blur-md sticky top-0 z-40 safe-top shrink-0">
        <button onClick={handleClose} className="p-2 -ml-2 hover:bg-gray-50 rounded-full text-gray-500"><X size={24} /></button>
        <div className="flex flex-col items-center flex-1 mx-2">
          <h1 className="text-sm font-black text-gray-900 uppercase tracking-wider">Quiz Composer</h1>
          <span className="text-[9px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">Content-First Creation</span>
        </div>
        <div className="w-10" />
      </div>

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto no-scrollbar bg-white">
        <div className="max-w-md mx-auto p-5 pb-32">
          {errorInfo.newErrors.userProfile && (
            <div className="p-3 mb-4 bg-red-50 text-red-600 border border-red-100 rounded-xl text-xs font-bold flex items-center gap-2">
              <AlertCircle size={16} />
              <span>{errorInfo.newErrors.userProfile}</span>
            </div>
          )}

          {/* Details Section */}
          <section className="space-y-2 pb-3 border-b border-gray-100 relative transition-all">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wide">Quiz Header</label>
              <button
                onClick={() => { setActiveCropTarget({ type: 'cover' }); fileInputRef.current?.click(); }}
                className={`p-1.5 rounded-full transition-colors ${coverImage ? 'text-purple-600 bg-purple-50' : 'text-gray-400 hover:text-purple-500 hover:bg-gray-50'}`}
              >
                <ImageIcon size={20} />
              </button>
            </div>
            {coverImage && (
              <div className="mb-2 animate-in zoom-in-95">
                <div className="relative w-20 h-20 rounded-xl overflow-hidden shadow-sm group">
                  <img src={coverImage} className="w-full h-full object-cover" alt="Cover" />
                  <button onClick={() => setCoverImage(null)} className="absolute top-1 right-1 p-1 bg-black/50 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                    <X size={10} />
                  </button>
                </div>
              </div>
            )}
            {shouldShowTitleField && (
              <RichMentionInput
                value={title}
                onChange={(val) => setTitle(val)}
                placeholder="Quiz Title"
                className="text-sm font-semibold bg-transparent border-b border-gray-100 focus:outline-none focus:border-purple-500 transition-all pt-0.5 pb-1.5 placeholder-gray-400 min-h-[44px] text-gray-900"
                minRows={1}
              />
            )}
            <RichMentionInput
              value={description}
              onChange={(val) => setDescription(val)}
              placeholder="Describe what this quiz is about (optional)..."
              className="mt-1.5 text-[11px] text-gray-500 bg-transparent border-b border-gray-100 focus:outline-none focus:border-purple-500 transition-all pt-0.5 pb-1.5 placeholder-gray-400 min-h-[32px]"
              minRows={1}
            />
          </section>

          {/* Compact Settings Bar */}
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-3 px-1 border-b border-gray-100 bg-white sticky top-0 z-30">
            {/* Category Chip */}
            <button
              onClick={() => setIsCategorySheetOpen(true)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] font-bold border transition-all flex items-center gap-1 active:scale-95 ${
                category
                  ? 'bg-purple-50 border-purple-200 text-purple-700 font-semibold'
                  : errorInfo.newErrors.category && hasAttemptedSubmit
                  ? 'bg-red-50 border-red-300 text-red-600'
                  : 'bg-gray-50 border-gray-200 text-gray-600'
              }`}
            >
              <span>Category: {category || 'Select'}</span>
              <ChevronDown size={12} />
            </button>

            {/* Visibility Chip */}
            <button
              onClick={() => setIsVisibilitySheetOpen(true)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] font-bold border transition-all flex items-center gap-1 active:scale-95 ${
                visibility !== 'Public'
                  ? 'bg-purple-50 border-purple-200 text-purple-700 font-semibold'
                  : 'bg-gray-50 border-gray-200 text-gray-600'
              }`}
            >
              <span>Audience: {visibility === 'Groups' && selectedGroups.length > 0 ? `${selectedGroups.length} Groups` : visibility}</span>
              <ChevronDown size={12} />
            </button>

            {/* Timer Chip */}
            <button
              onClick={() => setIsDurationSheetOpen(true)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] font-bold border transition-all flex items-center gap-1 active:scale-95 ${
                duration !== 'none'
                  ? 'bg-purple-50 border-purple-200 text-purple-700 font-semibold'
                  : 'bg-gray-50 border-gray-200 text-gray-600'
              }`}
            >
              <span>Timer: {duration === 'custom' ? 'Custom' : durationOptions.find(o => o.value === duration)?.label || 'None'}</span>
              <ChevronDown size={12} />
            </button>

            {/* Results Chip */}
            <button
              onClick={() => setIsResultVisibilitySheetOpen(true)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] font-bold border transition-all flex items-center gap-1 active:scale-95 ${
                resultsWho !== 'Public' || resultsTiming !== 'AnyTime'
                  ? 'bg-purple-50 border-purple-200 text-purple-700 font-semibold'
                  : 'bg-gray-50 border-gray-200 text-gray-600'
              }`}
            >
              <span>Results: {resultsWho === 'OnlyMe' ? 'Me' : resultsWho}</span>
              <ChevronDown size={12} />
            </button>

            {/* Analytics Chip */}
            <button
              onClick={() => setIsDemographicsSheetOpen(true)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] font-bold border transition-all flex items-center gap-1 active:scale-95 ${
                selectedDemographics.length > 0
                  ? 'bg-purple-50 border-purple-200 text-purple-700 font-semibold'
                  : 'bg-gray-50 border-gray-200 text-gray-600'
              }`}
            >
              <span>Analytics: {selectedDemographics.length > 0 ? `${selectedDemographics.length} Attributes` : 'Off'}</span>
              <ChevronDown size={12} />
            </button>
          </div>

          {/* Question Builder Area */}
          <div className="space-y-6 mt-4">
            {/* Sections tab bar - only show if there are multiple sections */}
            {(sections.length > 1) && (
              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 px-1">
                {sections.map((sec, idx) => (
                  <button
                    key={sec.id}
                    onClick={() => setActiveSectionId(sec.id)}
                    className={`shrink-0 px-4 py-2 rounded-xl text-xs font-bold border transition-all flex items-center gap-2 ${
                      activeSectionId === sec.id
                        ? 'bg-purple-600 text-white border-purple-600 shadow-md shadow-purple-200'
                        : 'bg-gray-50 text-gray-500 border-gray-100'
                    }`}
                  >
                    <span className="opacity-40">{idx + 1}</span>
                    <span className="truncate max-w-[100px]">{sec.title || `Section ${idx + 1}`}</span>
                  </button>
                ))}
                <button
                  onClick={addSection}
                  className="shrink-0 px-4 py-2 bg-purple-50 text-purple-600 rounded-xl border border-dashed border-purple-200 text-xs font-bold flex items-center gap-1.5 active:scale-95 transition-transform"
                >
                  <Plus size={14} /> Add Section
                </button>
              </div>
            )}

            {activeSection && (
              <div className="space-y-4 animate-in fade-in duration-300">
                {/* Section Title Input - only show if sections > 1 */}
                {sections.length > 1 && (
                  <div className="px-1 flex items-start gap-2">
                    <textarea
                      rows={1}
                      value={activeSection.title}
                      onChange={(e) => setSections(sections.map(s => s.id === activeSection.id ? { ...s, title: e.target.value } : s))}
                      placeholder={`Section ${activeSectionIndex + 1} Title`}
                      className="flex-1 text-base font-bold bg-transparent border-b border-gray-100 focus:outline-none focus:border-purple-500 transition-all p-0 pb-2 placeholder-gray-300 resize-none min-h-[40px]"
                    />
                    <button
                      onClick={() => setIsSectionSettingsSheetOpen(true)}
                      className="p-3 text-gray-400 hover:text-gray-650 hover:bg-gray-50 rounded-full transition-all shrink-0 mt-1 flex items-center justify-center min-w-[44px] min-h-[44px]"
                    >
                      <MoreHorizontalIcon size={20} />
                    </button>
                  </div>
                )}

                {/* Questions Tab/Progress Row */}
                {(totalQuestions > 1 || sections.length > 1) && (
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
                            options: [
                              { id: `o1-${Date.now()}`, text: '', votes: 0 },
                              { id: `o2-${Date.now()}`, text: '', votes: 0 }
                            ]
                          }]
                        } : s));
                        setActiveQuestionId(qId);
                      }}
                      className="shrink-0 px-4 py-2 rounded-full bg-white text-green-600 border border-dashed border-green-200 flex items-center justify-center gap-1.5 text-xs font-bold h-10 active:scale-95 transition-transform"
                    >
                      <Plus size={14} /> Add Question
                    </button>
                    {sections.length === 1 && (
                      <button
                        onClick={addSection}
                        className="shrink-0 px-4 py-2 bg-purple-50 text-purple-600 rounded-full border border-dashed border-purple-200 text-xs font-bold flex items-center justify-center gap-1.5 h-10 active:scale-95 transition-transform"
                      >
                        <Plus size={14} /> Add Section
                      </button>
                    )}
                  </div>
                )}

                {/* Active Question Card */}
                {activeQuestionId && (() => {
                  const q = activeSection.questions.find(qu => qu.id === activeQuestionId);
                  if (!q) return null;
                  const currentChoiceType = q.type === 'text' ? 'text' : 'multiple';

                  return (
                    <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-4 shadow-sm">
                      <div className="flex items-start gap-2">
                        <div className="flex-1 flex flex-col gap-2">
                          {q.image && (
                            <div className="relative w-24 h-24 rounded-xl overflow-hidden shadow-sm group animate-in zoom-in-95">
                              <img src={q.image} className="w-full h-full object-cover" alt="" />
                              <button onClick={() => updateQuestion(activeSection.id, q.id, { image: undefined })} className="absolute top-1 right-1 p-1 bg-black/50 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"><X size={10} /></button>
                            </div>
                          )}
                          <div className="flex items-center gap-2">
                            <button onClick={() => { setActiveCropTarget({ type: 'question', secId: activeSection.id, qId: q.id }); fileInputRef.current?.click(); }} className={`p-1.5 rounded-full transition-colors ${q.image ? 'text-purple-600 bg-purple-50' : 'text-gray-400 hover:text-purple-500 hover:bg-gray-50'}`}><Camera size={20} /></button>
                            <textarea
                              value={q.text}
                              onChange={(e) => updateQuestion(activeSection.id, q.id, { text: e.target.value })}
                              placeholder={totalQuestions <= 1 ? "Ask a trivia question..." : "Question Text"}
                              className="flex-1 text-sm font-semibold text-gray-900 border-b border-gray-100 focus:outline-none focus:border-purple-500 pt-0.5 pb-1.5 resize-none min-h-[44px] bg-transparent"
                            />
                          </div>
                        </div>
                        <button onClick={() => setIsQuestionSettingsSheetOpen(true)} className="p-3 text-gray-400 hover:text-gray-655 hover:bg-gray-50 rounded-full transition-all shrink-0 mt-1 flex items-center justify-center min-w-[44px] min-h-[44px]"><MoreHorizontalIcon size={20} /></button>
                      </div>

                      <div className="space-y-3 pt-2">
                        <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">Choice Type</label>
                        <div className="flex gap-2">
                          {[{ id: 'multiple', label: 'Multiple Choice' }, { id: 'text', label: 'Short Answer' }].map((type) => (
                            <button key={type.id} onClick={() => handleChoiceTypeChange(activeSection.id, q.id, type.id as any)} className={`flex-1 py-2.5 rounded-xl text-[10px] font-bold border transition-all ${currentChoiceType === type.id ? 'bg-purple-600 text-white border-purple-600 shadow-md shadow-purple-200' : 'bg-gray-50 text-gray-500 border-gray-100 hover:bg-gray-100'}`}>
                              {type.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {q.type === 'multiple_choice' && (
                        <div className="space-y-3 pt-2 border-t border-gray-50">
                          <div className="flex items-center justify-between px-1 mb-1">
                            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Options (Select Correct)</span>
                            {!q.correctOptionId && <span className="text-[9px] font-bold text-red-500 animate-pulse">Required: Select correct answer</span>}
                          </div>
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
                                  <div className={`flex-1 flex items-center bg-gray-50 rounded-xl px-1 py-1 border transition-all shadow-sm ${isCorrect ? 'border-green-200 ring-2 ring-green-50 bg-green-50/20' : 'border-transparent focus-within:border-purple-200 focus-within:bg-white'}`}>
                                    <button onClick={() => { setActiveCropTarget({ type: 'option', secId: activeSection.id, qId: q.id, optId: opt.id }); fileInputRef.current?.click(); }} className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 overflow-hidden border border-dashed transition-all mr-1 ${opt.image ? 'border-purple-500' : 'border-gray-200 text-gray-400 hover:text-purple-500'}`}>
                                      {opt.image ? <img src={opt.image} className="w-full h-full object-cover" alt="" /> : <Camera size={16} />}
                                    </button>
                                    <input
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
                                      className="flex-1 text-xs font-semibold p-2 bg-transparent focus:outline-none"
                                    />
                                    <span className="text-[9px] text-gray-400 mr-1.5 whitespace-nowrap">{opt.text.length}/80</span>
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
                            <div className="flex-1 flex items-center bg-gray-50/50 border border-dashed border-gray-200 rounded-xl px-1 py-1">
                              <button disabled className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 border border-dashed border-gray-200 text-gray-300 mr-1">
                                <Camera size={16} />
                              </button>
                              <input
                                type="text"
                                placeholder="Add option..."
                                className="flex-1 text-xs font-semibold p-2 bg-transparent focus:outline-none text-gray-400 cursor-pointer"
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

          {/* Engagement Settings */}
          <div className="border-t border-gray-100 pt-4 mt-6 space-y-3">
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">Engagement Settings</label>
            <div className="bg-gray-50 rounded-2xl p-4 space-y-4 border border-gray-100">
              <button onClick={() => setAllowComments(!allowComments)} className="w-full flex items-center justify-between py-1 group">
                <div className="flex flex-col text-left">
                  <span className="text-xs font-bold text-gray-800">Allow comments</span>
                  <span className="text-[10px] text-gray-400">Enable users to leave comments</span>
                </div>
                <div className={`w-10 h-5 rounded-full transition-colors relative ${allowComments ? 'bg-purple-600' : 'bg-gray-200'}`}>
                  <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${allowComments ? 'left-6' : 'left-1'}`} />
                </div>
              </button>
              <button onClick={() => setForceAnonymous(!forceAnonymous)} className="w-full flex items-center justify-between py-1 group">
                <div className="flex flex-col text-left">
                  <span className="text-xs font-bold text-gray-800">Require Anonymous Responses</span>
                  <span className="text-[10px] text-gray-400">All participants will be forced to respond without identity</span>
                </div>
                <div className={`w-10 h-5 rounded-full transition-colors relative ${forceAnonymous ? 'bg-purple-600' : 'bg-gray-200'}`}>
                  <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${forceAnonymous ? 'left-6' : 'left-1'}`} />
                </div>
              </button>
            </div>
          </div>

          {/* Unified Validation Error Display */}
          {hasAttemptedSubmit && !errorInfo.isValid && (
            <div className="p-4 bg-red-50 text-red-600 border border-red-200 rounded-2xl text-xs font-semibold flex flex-col gap-2 mt-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex items-center gap-2 font-bold text-red-800">
                <AlertCircle size={16} />
                <span>Please correct the following errors to publish:</span>
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

      {/* Sticky Footer */}
      <div className="border-t border-gray-100 bg-white/95 backdrop-blur-md px-4 py-3 sticky bottom-0 z-40 safe-bottom shrink-0 flex gap-3">
        <button
          onClick={handleSaveDraft}
          className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-2xl font-black uppercase tracking-wider text-[11px] hover:bg-gray-200 transition-all active:scale-[0.98]"
        >
          Save Draft
        </button>
        <button
          onClick={handlePost}
          className="flex-1 py-3 bg-purple-600 text-white rounded-2xl font-black uppercase tracking-wider text-[11px] hover:bg-purple-700 transition-all active:scale-[0.98] shadow-lg shadow-purple-200"
        >
          Publish Quiz
        </button>
      </div>

      {/* Duration Bottom Sheet */}
      <BottomSheet isOpen={isDurationSheetOpen} onClose={() => setIsDurationSheetOpen(false)} title="Quiz Duration">
        <div className="space-y-4 py-2 px-1">
          <p className="text-xs text-gray-500 mb-2">Select how long this quiz will accept responses.</p>
          <div className="flex flex-wrap gap-2">
            {durationOptions.map(opt => (
              <button
                key={opt.value}
                onClick={() => { setDuration(opt.value); setIsDurationSheetOpen(false); }}
                className={`px-4 py-2 rounded-full text-xs font-bold border transition-all ${
                  duration === opt.value
                    ? 'bg-purple-600 text-white border-purple-600 shadow-md'
                    : 'bg-white text-gray-650 border-gray-200 hover:bg-gray-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="pt-2 border-t border-gray-100 space-y-2">
            <button
              onClick={() => setDuration('custom')}
              className={`w-full py-3 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-2 ${
                duration === 'custom'
                  ? 'bg-purple-600 text-white border-purple-600'
                  : 'bg-white text-gray-650 border-gray-200 hover:bg-gray-50'
              }`}
            >
              <Calendar size={14} /> Custom End Date
            </button>
            {duration === 'custom' && (
              <input
                type="datetime-local"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="w-full p-3 rounded-xl border border-gray-200 text-xs font-semibold focus:outline-none focus:border-purple-500 transition-all text-gray-900"
              />
            )}
          </div>
          <button onClick={() => setIsDurationSheetOpen(false)} className="w-full py-4 bg-gray-900 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] mt-4">Done</button>
        </div>
      </BottomSheet>

      {/* Demographics Bottom Sheet */}
      <BottomSheet isOpen={isDemographicsSheetOpen} onClose={() => setIsDemographicsSheetOpen(false)} title="Analytics & Demographics">
        <div className="flex flex-col h-full bg-white px-1 py-2 space-y-6 overflow-y-auto no-scrollbar">
          <div className="bg-purple-50 rounded-2xl p-4 border border-purple-100 shadow-sm shrink-0">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 bg-purple-600 text-white rounded-xl flex items-center justify-center shadow-md shrink-0">
                <BarChart3 size={16} />
              </div>
              <div>
                <h4 className="text-xs font-black text-gray-900 leading-tight">Unlock Deep Analytics</h4>
                <p className="text-[9px] text-purple-600 font-bold mt-0.5">Demographics Breakdown</p>
              </div>
            </div>
            <p className="text-[10px] text-gray-600 leading-relaxed">
              Choose optional demographic questions to unlock deeper result breakdowns. Participants will respond optionally.
            </p>
          </div>

          <div className="space-y-3 shrink-0">
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest">Presets</label>
            <div className="grid grid-cols-2 gap-2">
              {(['recommended', 'professional', 'geographic', 'custom'] as const).map(preset => (
                <button
                  key={preset}
                  onClick={() => handlePresetChange(preset)}
                  className={`py-2 rounded-xl text-[10px] font-bold border transition-all uppercase tracking-wider ${
                    activePreset === preset
                      ? 'bg-purple-600 text-white border-purple-600 shadow-md shadow-purple-200'
                      : 'bg-gray-50 text-gray-500 border-gray-100 hover:bg-gray-100'
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3 shrink-0">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                Selected Attributes
              </label>
              {activePreset !== 'custom' && (
                <span className="text-[9px] text-gray-400 font-medium">
                  (Preset-controlled, select Custom to edit)
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {DEMOGRAPHIC_OPTIONS.map((opt) => {
                const isSelected = selectedDemographics.includes(opt.id);
                const isCustomMode = activePreset === 'custom';
                return (
                  <button
                    key={opt.id}
                    disabled={!isCustomMode}
                    onClick={() => handleDemographicToggle(opt.id)}
                    className={`px-3 py-1.5 rounded-full text-[10px] font-bold border transition-all flex items-center gap-1 ${
                      isSelected
                        ? 'bg-purple-50 border-purple-200 text-purple-600 font-semibold'
                        : 'bg-white border-gray-100 text-gray-400'
                    } ${!isCustomMode ? 'cursor-default opacity-85' : 'active:scale-95'}`}
                  >
                    {isSelected && <Check size={10} strokeWidth={4} />}
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100 space-y-2 shrink-0">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-gray-700">
                Provides {selectedDemographics.length} analytical comparisons
              </span>
              <span className="text-[10px] font-extrabold text-purple-600">
                +{selectedDemographics.length} questions for participant
              </span>
            </div>
            <p className="text-[9px] text-gray-400 font-medium leading-normal">
              * Selected questions will be prompted as optional questions during participation.
            </p>
          </div>

          <button onClick={() => setIsDemographicsSheetOpen(false)} className="w-full py-4 bg-gray-900 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] shrink-0">Done</button>
        </div>
      </BottomSheet>

      {/* Reused Bottom Sheets from Survey Builder */}
      <BottomSheet isOpen={isVisibilitySheetOpen} onClose={() => setIsVisibilitySheetOpen(false)} title="Post visibility">
        <div className="space-y-2 py-2">
          {visibilityOptions.map((option) => {
            const Icon = option.icon;
            const isSelected = visibility === option.id;
            return (
              <button key={option.id} disabled={!option.allowed} onClick={() => { setVisibility(option.id as VisibilityType); if (option.id !== 'Groups') setIsVisibilitySheetOpen(false); }} className={`w-full flex items-center gap-4 p-4 rounded-2xl border transition-all text-left ${!option.allowed ? 'opacity-40 grayscale cursor-not-allowed' : isSelected ? 'border-purple-500 bg-purple-50/50' : 'border-transparent hover:bg-gray-50'}`}>
                <div className={`p-2.5 rounded-xl ${isSelected ? 'bg-purple-600 text-white shadow-md' : 'bg-gray-100 text-gray-500'}`}><Icon size={20} /></div>
                <div className="flex-1"><h4 className={`font-bold text-sm ${isSelected ? 'text-purple-700' : 'text-gray-900'}`}>{option.label}</h4><p className="text-[10px] text-gray-500 mt-0.5">{option.desc}</p></div>
                {isSelected && <div className="w-6 h-6 bg-purple-600 text-white rounded-full flex items-center justify-center"><Check size={14} strokeWidth={3} /></div>}
              </button>
            );
          })}
        </div>
      </BottomSheet>

      {/* Result Visibility Bottom Sheet */}
      <BottomSheet isOpen={isResultVisibilitySheetOpen} onClose={() => setIsResultVisibilitySheetOpen(false)} title="Result Visibility" customLayout={true}>
        <div className="flex flex-col h-full bg-white px-5 py-4 space-y-8 overflow-y-auto no-scrollbar">
          <div className="space-y-4">
            <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Section 1: Who Can See the Results</h3>
            <div className="space-y-2">
              {['Public', 'Followers', 'Participants', 'OnlyMe'].map((opt) => (
                <button key={opt} onClick={() => setResultsWho(opt as any)} className="w-full flex items-center justify-between p-4 rounded-2xl border" style={{ borderColor: resultsWho === opt ? '#9333ea' : '#f3f4f6', backgroundColor: resultsWho === opt ? '#faf5ff' : 'white' }}>
                  <span className="text-sm font-bold text-gray-700">{opt === 'Participants' ? 'Participants Only' : opt === 'OnlyMe' ? 'Only Me' : opt}</span>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${resultsWho === opt ? 'border-purple-600 bg-purple-600' : 'border-gray-200'}`}>{resultsWho === opt && <div className="w-1.5 h-1.5 bg-white rounded-full" />}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Section 3: When Results Are Visible</h3>
            <div className="space-y-2">
              <button onClick={() => setResultsTiming('AnyTime')} className="w-full flex items-center justify-between p-4 rounded-2xl border" style={{ borderColor: resultsTiming === 'AnyTime' ? '#9333ea' : '#f3f4f6', backgroundColor: resultsTiming === 'AnyTime' ? '#faf5ff' : 'white' }}><span className="text-sm font-bold text-gray-700">Any time</span></button>
              <button onClick={() => setResultsTiming('Immediately')} className="w-full flex items-center justify-between p-4 rounded-2xl border" style={{ borderColor: resultsTiming === 'Immediately' ? '#9333ea' : '#f3f4f6', backgroundColor: resultsTiming === 'Immediately' ? '#faf5ff' : 'white' }}><span className="text-sm font-bold text-gray-700">Immediately</span></button>
              <button disabled={!canShowResultsAfterEnd} onClick={() => setResultsTiming('AfterEnd')} className="w-full flex items-center justify-between p-4 rounded-2xl border disabled:opacity-40" style={{ borderColor: resultsTiming === 'AfterEnd' ? '#9333ea' : '#f3f4f6', backgroundColor: resultsTiming === 'AfterEnd' ? '#faf5ff' : 'white' }}><span className="text-sm font-bold text-gray-700">After post ends</span></button>
            </div>
          </div>
          <button onClick={() => setIsResultVisibilitySheetOpen(false)} className="w-full py-4 bg-gray-900 text-white rounded-2xl font-black uppercase tracking-widest text-[10px]">Done</button>
        </div>
      </BottomSheet>

      {/* Category Bottom Sheet */}
      <BottomSheet isOpen={isCategorySheetOpen} onClose={() => setIsCategorySheetOpen(false)} title="Select Category">
        <div className="flex flex-wrap gap-2 py-2">
          {QUIZ_CATEGORIES.map(cat => (
            <button key={cat} onClick={() => { setCategory(cat); setIsCategorySheetOpen(false); }} className={`px-4 py-2 rounded-full text-xs font-bold border transition-all ${category === cat ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>{cat}</button>
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
            <button disabled={activeSection.questions.length <= 1} onClick={() => { setSections(sections.map(s => s.id === activeSection.id ? { ...s, questions: s.questions.filter(q => q.id !== activeQuestionId) } : s)); setIsQuestionSettingsSheetOpen(false); }} className="w-full flex items-center gap-4 p-4 rounded-2xl border border-red-100 bg-red-50/30 text-red-600 disabled:opacity-30"><div className="p-2.5 rounded-xl bg-red-100 text-red-600"><Trash2 size={20} /></div><span className="font-bold text-sm">Delete Question</span></button>
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
            <button disabled={sections.length <= 1} onClick={() => { setSections(sections.filter(s => s.id !== activeSection.id)); setIsSectionSettingsSheetOpen(false); }} className="w-full flex items-center gap-4 p-4 rounded-2xl border border-red-100 bg-red-50/30 text-red-600 disabled:opacity-30"><div className="p-2.5 rounded-xl bg-red-100 text-red-600"><Trash2 size={20} /></div><span className="font-bold text-sm">Delete Section</span></button>
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

      {croppingImage && <ImageCropper imageSrc={croppingImage} onCrop={handleCropComplete} onCancel={() => { setCroppingImage(null); setActiveCropTarget(null); }} />}
      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload} />
    </div>
  );
};
