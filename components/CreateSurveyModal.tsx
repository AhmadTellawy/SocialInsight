
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { X, Plus, Trash2, Globe, Users, ChevronDown, Clock, Calendar, Type, ListChecks, ImageIcon, Settings, Info, ArrowRight, Camera, Lock, AlertCircle, ChevronRight, ChevronLeft, MoreVertical, Layout, Terminal, Navigation, Sparkles, GripVertical, Save, FileText, BarChart3, UserCircle, Heart, Fingerprint, MapPin, Briefcase, Check, GraduationCap, Home, Smile, Building2, User, MessageSquare, ShieldCheck, Link2, Target, MoreHorizontal, ArrowUp, ArrowDown, Star, List, GalleryHorizontalEnd, CornerDownRight, PowerOff } from 'lucide-react';
import { Survey, SurveyType, SurveySection, SurveyQuestion, Option, UserProfile, Group } from '../types';
import { ImageCropper } from './ImageCropper';
import { BottomSheet } from './BottomSheet';
import { RichMentionInput } from './RichMentionInput';
import { api } from '../services/api';

interface CreateSurveyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (surveyData: Partial<Survey>) => void;
  onSaveDraft?: (surveyData: Partial<Survey>) => void;
  userProfile: UserProfile;
  draft?: Survey;
  userGroups?: Group[];
  initialGroupId?: string | null;
}

const SURVEY_CATEGORIES = [
  "Entertainment", "Social", "Economic", "Political", "Health",
  "Educational", "Cultural", "Environmental", "Technology", "Media",
  "Legal", "Sports", "Business / Commercial", "Government / Public",
  "Community / Development", "Family", "Youth", "Quality of Life", "Other"
];

const DEMOGRAPHIC_OPTIONS = [
  { id: 'gender', label: 'Gender', desc: 'Understand response patterns by gender' },
  { id: 'marital_status', label: 'Marital Status', desc: 'Identify trends based on marital status' },
  { id: 'residence', label: 'Country of Residence', desc: 'Analyze responses by participants country of residence' },
  { id: 'nationality', label: 'Nationality', desc: 'Analyze by responses by Nationality' },
  { id: 'age_group', label: 'Age Group', desc: 'Compare responses across age groups' },
  { id: 'education', label: 'Education Level', desc: 'Analyze responses by education level' },
  { id: 'household', label: 'Household Size', desc: 'Understand patterns based on household size' },
  { id: 'family_role', label: 'Family Role', desc: 'Explore insights based on family role' },
  { id: 'employment', label: 'Employment Type', desc: 'Analyze responses by employment type' },
  { id: 'industry', label: 'Industry / Field of Work', desc: 'Identify trends across different industries' },
  { id: 'occupation', label: 'Occupation', desc: 'Analyze response differences by occupation' },
];

const INITIAL_SECTIONS: SurveySection[] = [
  {
    id: `sec-init`,
    title: '',
    questions: [
      {
        id: `q-init-1`,
        text: '',
        type: 'multiple_choice',
        maxSelection: 1,
        isRequired: true,
        imageLayout: 'vertical',
        options: [
          { id: `opt-init-1`, text: '', votes: 0, withFollowUp: false, followUpLabel: '' },
          { id: `opt-init-2`, text: '', votes: 0, withFollowUp: false, followUpLabel: '' }
        ]
      }
    ]
  }
];

type VisibilityType = 'Public' | 'Followers' | 'Groups' | 'Custom Audience' | 'Custom Domain';

export const CreateSurveyModal: React.FC<CreateSurveyModalProps> = ({ isOpen, onClose, onSubmit, onSaveDraft, userProfile, draft, userGroups = [], initialGroupId }) => {
  const [step, setStep] = useState<1 | 2 | 3>((draft?.currentStep as 1 | 2 | 3) || 1);

  const [visibility, setVisibility] = useState<VisibilityType>(initialGroupId ? 'Groups' : 'Public');
  const [isVisibilitySheetOpen, setIsVisibilitySheetOpen] = useState(false);
  const [isResultVisibilitySheetOpen, setIsResultVisibilitySheetOpen] = useState(false);
  const [isCategorySheetOpen, setIsCategorySheetOpen] = useState(false);

  // New Detailed Visibility State
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
  const [settingsOptionId, setSettingsOptionId] = useState<{ secId: string, qId: string, optId: string } | null>(null);
  const [isQuestionSettingsSheetOpen, setIsQuestionSettingsSheetOpen] = useState(false);
  const [isSectionSettingsSheetOpen, setIsSectionSettingsSheetOpen] = useState(false);

  const [selectedDemographics, setSelectedDemographics] = useState<string[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<string[]>(initialGroupId ? [initialGroupId] : []);

  const [croppingImage, setCroppingImage] = useState<string | null>(null);
  const [activeCropTarget, setActiveCropTarget] = useState<{ type: 'cover' | 'question' | 'option', secId?: string, qId?: string, optId?: string } | null>(null);

  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [errors, setErrors] = useState<{ [key: string]: boolean | string }>({});

  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const activeSection = sections.find(s => s.id === activeSectionId);
  const activeSectionIndex = useMemo(() => sections.findIndex(s => s.id === activeSectionId), [sections, activeSectionId]);

  const getQuestionCountBeforeSection = (secIdx: number) => {
    return sections.slice(0, secIdx).reduce((acc, sec) => acc + sec.questions.length, 0);
  };

  const [localDraftId, setLocalDraftId] = useState<string | null>(null);

  useEffect(() => {
    console.log("CreateSurveyModal mounted. Draft prop:", draft);
    if (draft) {
      setLocalDraftId(draft.id);
      setTitle(draft.title || '');
      // ... rest of loading logic
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
        setActiveSectionId(draft.sections[0].id);
        if (draft.sections[0].questions.length > 0) {
          setActiveQuestionId(draft.sections[0].questions[0].id);
        }
      }
      if (draft.demographics) {
        setSelectedDemographics(draft.demographics);
      }
      if (draft.targetGroups) {
        setSelectedGroups(draft.targetGroups);
      }
    }
  }, [draft]);

  const handleDiscard = async () => {
    if (draft && draft.id && draft.isDraft) {
      try {
        await api.deletePost(draft.id);
      } catch (e) {
        console.error("Failed to delete draft", e);
      }
    }
    onClose();
  };

  // Logic: "After post ends" only enabled if duration is not None
  const canShowResultsAfterEnd = duration !== 'none';

  // Side effect: If Duration is none, force timing to Immediately
  useEffect(() => {
    if (duration === 'none' && resultsTiming === 'AfterEnd') {
      setResultsTiming('Immediately');
    }
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
  }, [step]);

  const hasChanges = useMemo(() => {
    // User requested explicit confirmation every time, so we check for content regardless of draft status
    if (title.trim() !== '') return true;
    if (description.trim() !== '') return true;
    if (category !== '') return true;
    if (coverImage !== null) return true;
    if (sections.length > 1) return true;
    const firstQ = sections[0].questions[0];
    if (firstQ.text.trim() !== '') return true;
    if (sections[0].questions.length > 1) return true;
    return false;
  }, [title, description, category, coverImage, sections]);

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

  const validateStep1 = () => {
    const newErrors: { [key: string]: boolean | string } = {};
    if (!title.trim()) newErrors.title = true;
    if (!category) newErrors.category = true;
    if (visibility === 'Groups' && selectedGroups.length === 0) newErrors.visibility = "Please select at least one group.";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateStep2 = () => {
    const newErrors: { [key: string]: boolean | string } = {};
    let hasEmptyQuestion = false;
    sections.forEach(s => {
      s.questions.forEach(q => {
        if (!q.text.trim()) hasEmptyQuestion = true;
        if (q.type === 'multiple_choice' && (q.options?.filter(o => o.text.trim() !== '').length || 0) < 2) {
          hasEmptyQuestion = true;
        }
      });
    });
    if (hasEmptyQuestion) newErrors.questions = "All questions must have text and at least 2 options.";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const getExpiresAt = () => {
    const now = new Date();
    if (duration === 'custom' && customEndDate) return new Date(customEndDate).toISOString();
    if (duration === 'none') return new Date(now.getFullYear() + 10, now.getMonth(), now.getDate()).toISOString();
    const map: Record<string, number> = { '1h': 60, '24h': 1440, '3d': 4320, '1w': 10080, '1m': 43200 };
    const mins = map[duration] || 10080;
    return new Date(now.getTime() + mins * 60000).toISOString();
  };

  const handlePost = (isDraft: boolean = false) => {
    // For drafts, we only validate title
    if (isDraft) {
      if (!title.trim()) {
        setErrors({ title: true });
        return;
      }
    } else {
      if (!validateStep1() || !validateStep2()) return;
    }

    const surveyData: Partial<Survey> = {
      id: localDraftId || undefined, // Pass ID if it exists
      title,
      description,
      type: SurveyType.SURVEY,
      // ... rest
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
      createdAt: new Date().toISOString(),
      isDraft: isDraft,
      status: isDraft ? 'DRAFT' : 'PUBLISHED', // Explicitly set status to avoid ambiguity
      currentStep: step
    };

    if (isDraft && onSaveDraft) {
      onSaveDraft(surveyData);
    } else {
      onSubmit(surveyData);
    }
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
        e.target.value = '';
      };
      img.src = objUrl;
    }
  };

  const handleCropComplete = (croppedImg: string) => {
    if (!activeCropTarget) return;

    if (activeCropTarget.type === 'cover') {
      setCoverImage(croppedImg);
    } else if (activeCropTarget.type === 'question') {
      updateQuestion(activeCropTarget.secId!, activeCropTarget.qId!, { image: croppedImg });
    } else if (activeCropTarget.type === 'option') {
      setSections(sections.map(s => {
        if (s.id !== activeCropTarget.secId) return s;
        return {
          ...s,
          questions: s.questions.map(q => {
            if (q.id !== activeCropTarget.qId || !q.options) return q;
            return {
              ...q,
              options: q.options.map(o => o.id === activeCropTarget.optId ? { ...o, image: croppedImg } : o)
            };
          })
        };
      }));
    }
    setCroppingImage(null);
    setActiveCropTarget(null);
  };

  const addSection = () => {
    const newId = `sec-${Date.now()}`;
    const newQId = `q-${Date.now()}`;
    setSections([...sections, {
      id: newId,
      title: '',
      questions: [{
        id: newQId,
        text: '',
        type: 'multiple_choice',
        maxSelection: 1,
        isRequired: true,
        imageLayout: 'vertical',
        options: [{ id: `o1-${Date.now()}`, text: '', votes: 0, withFollowUp: false, followUpLabel: '' }, { id: `o2-${Date.now()}`, text: '', votes: 0, withFollowUp: false, followUpLabel: '' }]
      }]
    }]);
    setActiveSectionId(newId);
    setActiveQuestionId(newQId);
  };

  const updateQuestion = (secId: string, qId: string, updates: Partial<SurveyQuestion>) => {
    setSections(sections.map(s => s.id === secId ? { ...s, questions: s.questions.map(q => q.id === qId ? { ...q, ...updates } : q) } : s));
  };

  const handleChoiceTypeChange = (secId: string, qId: string, choiceType: 'multiple' | 'rating' | 'text') => {
    let newType: 'multiple_choice' | 'text' = 'multiple_choice';
    let newOptions: Option[] = [];

    if (choiceType === 'rating') {
      newOptions = [
        { id: 'rate-5', text: '5', votes: 0, isRating: true, ratingValue: 5 },
        { id: 'rate-4', text: '4', votes: 0, isRating: true, ratingValue: 4 },
        { id: 'rate-3', text: '3', votes: 0, isRating: true, ratingValue: 3 },
        { id: 'rate-2', text: '2', votes: 0, isRating: true, ratingValue: 2 },
        { id: 'rate-1', text: '1', votes: 0, isRating: true, ratingValue: 1 },
      ];
    } else if (choiceType === 'text') {
      newType = 'text';
      newOptions = [];
    } else {
      newOptions = [
        { id: '1', text: '', votes: 0 },
        { id: '2', text: '', votes: 0 }
      ];
    }

    updateQuestion(secId, qId, { type: newType, options: newOptions, maxSelection: 1 });
  };

  const moveOption = (secId: string, qId: string, optId: string, direction: 'up' | 'down') => {
    setSections(sections.map(s => {
      if (s.id !== secId) return s;
      return {
        ...s,
        questions: s.questions.map(q => {
          if (q.id !== qId || !q.options) return q;
          const index = q.options.findIndex(o => o.id === optId);
          if (index === -1) return q;
          if (direction === 'up' && index === 0) return q;
          if (direction === 'down' && index === q.options.length - 1) return q;

          const newOptions = [...q.options];
          const swapIndex = direction === 'up' ? index - 1 : index + 1;
          [newOptions[index], newOptions[swapIndex]] = [newOptions[swapIndex], newOptions[index]];
          return { ...q, options: newOptions };
        })
      };
    }));
  };

  const moveQuestion = (secId: string, qId: string, direction: 'up' | 'down') => {
    setSections(sections.map(s => {
      if (s.id !== secId) return s;
      const index = s.questions.findIndex(q => q.id === qId);
      if (index === -1) return s;
      if (direction === 'up' && index === 0) return s;
      if (direction === 'down' && index === s.questions.length - 1) return s;

      const newQs = [...s.questions];
      const swapIndex = direction === 'up' ? index - 1 : index + 1;
      [newQs[index], newQs[swapIndex]] = [newQs[swapIndex], newQs[index]];
      return { ...s, questions: newQs };
    }));
  };

  const moveSection = (id: string, direction: 'up' | 'down') => {
    const index = sections.findIndex(s => s.id === id);
    if (index === -1) return;
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === sections.length - 1) return;

    const newSections = [...sections];
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    [newSections[index], newSections[swapIndex]] = [newSections[swapIndex], newSections[index]];
    setSections(newSections);
  };

  const handleDemographicToggle = (id: string) => {
    setSelectedDemographics(prev =>
      prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]
    );
  };

  const handleGroupToggle = (groupId: string) => {
    setSelectedGroups(prev =>
      prev.includes(groupId) ? prev.filter(id => id !== groupId) : [...prev, groupId]
    );
  };

  const selectedOptionForSettings = useMemo(() => {
    if (!settingsOptionId) return null;
    const s = sections.find(s => s.id === settingsOptionId.secId);
    const q = s?.questions.find(q => q.id === settingsOptionId.qId);
    return q?.options?.find(o => o.id === settingsOptionId.optId);
  }, [settingsOptionId, sections]);

  const allQuestionsFlat = useMemo(() => {
    const flat: { id: string, text: string, globalIndex: number }[] = [];
    sections.forEach(sec => {
      sec.questions.forEach(q => {
        flat.push({
          id: q.id,
          text: q.text || `Untitled Question`,
          globalIndex: flat.length + 1
        });
      });
    });
    return flat;
  }, [sections]);

  const futureQuestionsForJump = useMemo(() => {
    if (!settingsOptionId) return [];
    const currentQIdx = allQuestionsFlat.findIndex(q => q.id === settingsOptionId.qId);
    if (currentQIdx === -1) return [];
    return allQuestionsFlat.slice(currentQIdx + 1);
  }, [settingsOptionId, allQuestionsFlat]);

  return (
    <div className="absolute inset-0 z-[60] bg-white flex flex-col animate-in slide-in-from-bottom duration-300">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-white/95 backdrop-blur-md sticky top-0 z-40 safe-top shrink-0">
        <button onClick={handleClose} className="p-2 -ml-2 hover:bg-gray-50 rounded-full text-gray-500"><X size={24} /></button>
        <div className="flex flex-col items-center flex-1 mx-2">
          <h1 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Survey Creation</h1>
          <div className="flex gap-1">
            {[1, 2, 3].map(s => <div key={s} className={`h-1 w-8 rounded-full transition-all duration-300 ${step >= s ? 'bg-blue-600' : 'bg-gray-100'}`} />)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {step < 3 ? (
            <button onClick={() => step === 1 ? validateStep1() && setStep(2) : validateStep2() && setStep(3)} className="text-blue-600 font-black text-[10px] px-5 py-2 rounded-full bg-blue-50 hover:bg-blue-100 transition-all uppercase tracking-widest">Next</button>
          ) : (
            <button onClick={() => handlePost(false)} className="text-white font-black text-[10px] px-5 py-2 rounded-full bg-blue-600 hover:bg-blue-700 transition-all uppercase tracking-widest shadow-lg shadow-blue-200">Publish</button>
          )}
        </div>
      </div>

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto no-scrollbar bg-white">
        <div className="max-w-md mx-auto p-5 pb-32">
          {step === 1 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <section className="p-2 space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className={errors.visibility ? 'p-1 rounded-xl bg-red-50 ring-1 ring-red-100' : ''}>
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                      <Globe size={10} /> Post visibility
                    </label>
                    <button
                      onClick={() => setIsVisibilitySheetOpen(true)}
                      className="w-full flex items-center justify-between bg-gray-50 text-gray-900 text-[11px] font-bold rounded-xl px-3 py-2.5 transition-colors text-left"
                    >
                      <span className="truncate">{visibility === 'Groups' && selectedGroups.length > 0 ? `${selectedGroups.length} Groups` : visibility}</span>
                      <ChevronDown className="text-gray-400 shrink-0" size={14} />
                    </button>
                    {errors.visibility && typeof errors.visibility === 'string' && <p className="text-[9px] text-red-500 font-bold mt-1 px-1">{errors.visibility}</p>}
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                      <Lock size={10} /> Results Access
                    </label>
                    <button
                      onClick={() => setIsResultVisibilitySheetOpen(true)}
                      className="w-full flex items-center justify-between bg-gray-50 text-gray-900 text-[11px] font-bold rounded-xl px-3 py-2.5 transition-colors text-left"
                    >
                      <span className="truncate">{resultsWho === 'OnlyMe' ? 'Only Me' : resultsWho}</span>
                      <ChevronDown className="text-gray-400 shrink-0" size={14} />
                    </button>
                  </div>
                </div>
              </section>

              <section className={`space-y-3 pb-4 border-b border-gray-50 relative transition-colors ${errors.title ? 'p-3 rounded-2xl bg-red-50' : ''}`}>
                <div className="flex items-center justify-between"><label className="block text-xs font-bold text-gray-400 uppercase tracking-wide">The Survey Header <span className="text-red-500">*</span></label><button onClick={() => { setActiveCropTarget({ type: 'cover' }); fileInputRef.current?.click(); }} className={`p-1.5 rounded-full transition-colors ${coverImage ? 'text-blue-600 bg-blue-50' : 'text-gray-400 hover:text-blue-500 hover:bg-gray-50'}`}><ImageIcon size={20} /></button></div>
                {coverImage && <div className="mb-2"><div className="relative w-20 h-20 rounded-xl overflow-hidden shadow-sm group animate-in zoom-in-95"><img src={coverImage} className="w-full h-full object-cover" alt="Cover" /><button onClick={() => setCoverImage(null)} className="absolute top-1 right-1 p-1 bg-black/50 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"><X size={10} /></button></div></div>}
                <RichMentionInput
                  value={title}
                  onChange={(val) => { setTitle(val); setErrors(prev => ({ ...prev, title: false })); }}
                  placeholder="Survey Title"
                  className={`text-xl font-bold bg-transparent border-b border-gray-100 focus:outline-none focus:border-blue-500 transition-all p-0 pb-2 placeholder-gray-300 min-h-[60px] ${errors.title ? 'text-red-500 border-red-300' : 'text-gray-900'}`}
                  autoFocus
                />
                <RichMentionInput
                  value={description}
                  onChange={(val) => setDescription(val)}
                  placeholder="Describe what this survey is about..."
                  className="mt-2 text-sm text-gray-600 bg-transparent border-b border-gray-100 focus:outline-none focus:border-blue-500 transition-all p-0 pb-2 placeholder-gray-300 min-h-[40px]"
                />
              </section>

              <div className="space-y-3 pt-2">
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">
                  Category <span className="text-red-500">*</span>
                </label>
                <button
                  onClick={() => setIsCategorySheetOpen(true)}
                  className={`inline-flex px-4 py-2 rounded-full text-xs font-bold border transition-all active:scale-95 ${category
                    ? 'bg-blue-50 border-blue-200 text-blue-600'
                    : 'bg-white border-gray-200 text-gray-400 hover:bg-gray-50'
                    } ${errors.category ? 'border-red-300 bg-red-50' : ''}`}
                >
                  {category || 'Select Survey Category'}
                </button>
                {errors.category && <p className="text-[10px] font-bold text-red-500 px-1">Please select a category.</p>}
              </div>

              <section className="p-2 space-y-3">
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-1"><Clock size={12} /> Survey Duration</label>
                <div className="flex flex-wrap gap-2">
                  {durationOptions.map(opt => (
                    <button key={opt.value} onClick={() => setDuration(opt.value)} className={`px-4 py-1.5 rounded-full text-xs font-bold border transition-all ${duration === opt.value ? 'bg-gray-900 text-white border-gray-900 shadow-md' : 'bg-white text-gray-500 border-gray-100 hover:border-gray-300'}`}>
                      {opt.label}
                    </button>
                  ))}
                  <button onClick={() => setDuration('custom')} className={`px-4 py-1.5 rounded-full text-xs font-bold border transition-all flex items-center gap-1 ${duration === 'custom' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-500 border-gray-100'}`}>
                    <Calendar size={12} /> Custom
                  </button>
                </div>
              </section>

              <section className="space-y-4 pb-4 border-b border-gray-50">
                <button onClick={() => setAllowComments(!allowComments)} className="w-full flex items-center justify-between py-1 group"><div className="flex flex-col text-left"><span className="text-sm font-bold text-gray-800">Allow comments</span><span className="text-[10px] text-gray-400">Enable users to leave comments</span></div><div className={`w-10 h-5 rounded-full transition-colors relative ${allowComments ? 'bg-blue-600' : 'bg-gray-200'}`}><div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${allowComments ? 'left-6' : 'left-1'}`} /></div></button>
                <button onClick={() => setForceAnonymous(!forceAnonymous)} className="w-full flex items-center justify-between py-1 group"><div className="flex flex-col text-left"><span className="text-sm font-bold text-gray-800">Require Anonymous Responses</span><span className="text-[10px] text-gray-400">All participants will be forced to respond without identity</span></div><div className={`w-10 h-5 rounded-full transition-colors relative ${forceAnonymous ? 'bg-blue-600' : 'bg-gray-200'}`}><div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${forceAnonymous ? 'left-6' : 'left-1'}`} /></div></button>
              </section>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <section className="space-y-6">
                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 px-1">
                  {sections.map((sec, idx) => (
                    <button key={sec.id} onClick={() => setActiveSectionId(sec.id)} className={`shrink-0 px-4 py-2 rounded-xl text-xs font-bold border transition-all flex items-center gap-2 ${activeSectionId === sec.id ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-200' : 'bg-gray-50 text-gray-500 border-gray-100'}`}>
                      <span className="opacity-40">{idx + 1}</span>
                      <span className="truncate max-w-[100px]">{sec.title || `Section ${idx + 1}`}</span>
                    </button>
                  ))}
                  <button onClick={addSection} className="shrink-0 px-4 py-2 bg-blue-50 text-blue-600 rounded-xl border border-dashed border-blue-200 text-xs font-bold flex items-center gap-1.5 whitespace-nowrap active:scale-95 transition-transform">
                    <Plus size={14} /> Add Section
                  </button>
                </div>
                {activeSection && (
                  <div className="space-y-6 animate-in fade-in duration-300">
                    <div className="px-1 flex items-start gap-2">
                      <textarea
                        rows={1}
                        value={activeSection.title}
                        onChange={(e) => setSections(sections.map(s => s.id === activeSection.id ? { ...s, title: e.target.value } : s))}
                        placeholder={`Section ${activeSectionIndex + 1} Title`}
                        className="flex-1 text-xl font-bold bg-transparent border-b border-gray-100 focus:outline-none focus:border-blue-500 transition-all p-0 pb-2 placeholder-gray-300 resize-none min-h-[50px] overflow-hidden"
                      />
                      <button
                        onClick={() => setIsSectionSettingsSheetOpen(true)}
                        className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-full transition-all shrink-0 mt-1"
                      >
                        <MoreHorizontal size={20} />
                      </button>
                    </div>
                    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 px-1">
                      {activeSection.questions.map((q, qIdx) => {
                        const globalQNum = getQuestionCountBeforeSection(activeSectionIndex) + qIdx + 1;
                        return (
                          <button key={q.id} onClick={() => setActiveQuestionId(q.id)} className={`shrink-0 h-10 w-10 rounded-full text-xs font-black border transition-all flex items-center justify-center ${activeQuestionId === q.id ? 'bg-green-600 text-white border-green-600' : 'bg-gray-50 text-gray-400 border-gray-100'}`}>
                            Q{globalQNum}
                          </button>
                        );
                      })}
                      <button onClick={() => { const qId = `q-${Date.now()}`; setSections(sections.map(s => s.id === activeSection.id ? { ...s, questions: [...s.questions, { id: qId, text: '', type: 'multiple_choice', isRequired: true, imageLayout: 'vertical', options: [{ id: '1', text: '', votes: 0, withFollowUp: false, followUpLabel: '' }, { id: '2', text: '', votes: 0, withFollowUp: false, followUpLabel: '' }] }] } : s)); setActiveQuestionId(qId); }} className="shrink-0 px-4 py-2 rounded-full bg-white text-green-600 border border-dashed border-green-200 flex items-center justify-center gap-1.5 text-xs font-bold whitespace-nowrap active:scale-95 transition-transform h-10">
                        <Plus size={14} /> Add Question
                      </button>
                    </div>
                    {activeQuestionId && (() => {
                      const q = activeSection.questions.find(qu => qu.id === activeQuestionId);
                      if (!q) return null;
                      const isRating = q.options?.some(o => o.isRating);
                      const currentChoiceType = q.type === 'text' ? 'text' : isRating ? 'rating' : 'multiple';

                      return (
                        <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-4">
                          <div className="flex items-start gap-2">
                            <div className="flex-1 flex flex-col gap-2">
                              {q.image && (
                                <div className="relative w-24 h-24 rounded-xl overflow-hidden shadow-sm group animate-in zoom-in-95">
                                  <img src={q.image} className="w-full h-full object-cover" alt="" />
                                  <button onClick={() => updateQuestion(activeSection.id, q.id, { image: undefined })} className="absolute top-1 right-1 p-1 bg-black/50 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"><X size={10} /></button>
                                </div>
                              )}
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => { setActiveCropTarget({ type: 'question', secId: activeSection.id, qId: q.id }); fileInputRef.current?.click(); }}
                                  className={`p-1.5 rounded-full transition-colors ${q.image ? 'text-blue-600 bg-blue-50' : 'text-gray-400 hover:text-blue-500 hover:bg-gray-50'}`}
                                >
                                  <Camera size={20} />
                                </button>
                                <textarea
                                  value={q.text}
                                  onChange={(e) => updateQuestion(activeSection.id, q.id, { text: e.target.value })}
                                  placeholder="Question Text"
                                  className="flex-1 text-xl font-bold text-gray-900 border-b border-gray-100 focus:outline-none focus:border-blue-500 p-0 pb-2 resize-none min-h-[60px] placeholder-gray-300 bg-transparent"
                                />
                              </div>
                            </div>
                            <button
                              onClick={() => setIsQuestionSettingsSheetOpen(true)}
                              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-full transition-all shrink-0 mt-1"
                            >
                              <MoreHorizontal size={20} />
                            </button>
                          </div>

                          <div className="space-y-3 pt-2">
                            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">Choice Type</label>
                            <div className="flex gap-2">
                              {[
                                { id: 'multiple', label: 'Multiple Choice' },
                                { id: 'rating', label: 'Rating Scale' },
                                { id: 'text', label: 'Free Text' }
                              ].map((type) => (
                                <button
                                  key={type.id}
                                  onClick={() => handleChoiceTypeChange(activeSection.id, q.id, type.id as any)}
                                  className={`flex-1 py-2.5 rounded-xl text-[10px] font-bold border transition-all ${currentChoiceType === type.id ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-200' : 'bg-gray-50 text-gray-500 border-gray-100 hover:bg-gray-100'}`}
                                >
                                  {type.label}
                                </button>
                              ))}
                            </div>
                          </div>

                          {q.type === 'multiple_choice' && !isRating && (
                            <div className="space-y-2 px-1 pt-2">
                              <div className="flex items-center justify-between">
                                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest">Options layout</label>
                                <div className="flex gap-1.5">
                                  {[
                                    { id: 'vertical', icon: List },
                                    { id: 'horizontal', icon: GalleryHorizontalEnd }
                                  ].map((layout) => (
                                    <button
                                      key={layout.id}
                                      onClick={() => updateQuestion(activeSection.id, q.id, { imageLayout: layout.id as any })}
                                      className={`p-1.5 rounded-lg border transition-all ${q.imageLayout === layout.id
                                        ? 'bg-gray-900 text-white border-gray-900 shadow-sm'
                                        : 'bg-white text-gray-400 border-gray-200 hover:bg-gray-50'
                                        }`}
                                      title={layout.id}
                                    >
                                      <layout.icon size={16} />
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wide italic">Applies only if images are added to options.</p>
                            </div>
                          )}

                          {q.type === 'multiple_choice' ? (
                            <div className="space-y-3 pt-2 border-t border-gray-50">
                              {q.options?.map((opt, oIdx) => (
                                <div key={opt.id} className="flex flex-col gap-1 animate-in fade-in slide-in-from-bottom-1 duration-200">
                                  <div className="flex items-center gap-2">
                                    <div className="flex-1 flex items-center bg-gray-50 rounded-xl px-1 py-1 border border-transparent focus-within:border-blue-200 focus-within:bg-white transition-all shadow-sm">
                                      {currentChoiceType === 'multiple' && (
                                        <button
                                          onClick={() => { setActiveCropTarget({ type: 'option', secId: activeSection.id, qId: q.id, optId: opt.id }); fileInputRef.current?.click(); }}
                                          className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 overflow-hidden border border-dashed transition-all mr-1 ${opt.image ? 'border-blue-500' : 'border-gray-200 text-gray-400 hover:text-blue-500'
                                            }`}
                                        >
                                          {opt.image ? <img src={opt.image} className="w-full h-full object-cover" alt="" /> : <Camera size={16} />}
                                        </button>
                                      )}
                                      {isRating ? (
                                        <div className="flex-1 px-3 py-2 flex items-center gap-2">
                                          <div className="flex text-yellow-500">
                                            {Array.from({ length: opt.ratingValue || 0 }).map((_, i) => (
                                              <Star key={i} size={14} fill="currentColor" />
                                            ))}
                                          </div>
                                        </div>
                                      ) : (
                                        <div className="flex-1 flex items-center">
                                          <input
                                            type="text"
                                            value={opt.text}
                                            onChange={(e) => {
                                              const updated = q.options?.map(o => o.id === opt.id ? { ...o, text: e.target.value } : o);
                                              updateQuestion(activeSection.id, q.id, { options: updated });
                                            }}
                                            placeholder={`Option ${oIdx + 1}`}
                                            className="flex-1 text-xs font-semibold p-2 bg-transparent focus:outline-none"
                                          />
                                          {opt.image && (
                                            <button onClick={() => {
                                              const updated = q.options?.map(o => o.id === opt.id ? { ...o, image: undefined } : o);
                                              updateQuestion(activeSection.id, q.id, { options: updated });
                                            }} className="p-1.5 text-gray-300 hover:text-red-500"><X size={12} /></button>
                                          )}
                                        </div>
                                      )}
                                      <button
                                        onClick={() => setSettingsOptionId({ secId: activeSection.id, qId: q.id, optId: opt.id })}
                                        className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors"
                                      >
                                        <MoreHorizontal size={16} />
                                      </button>
                                    </div>
                                    {q.options && q.options.length > 2 && q.type === 'multiple_choice' && !isRating && (
                                      <button
                                        onClick={() => {
                                          const updated = q.options?.filter(o => o.id !== opt.id);
                                          updateQuestion(activeSection.id, q.id, { options: updated });
                                        }}
                                        className="text-gray-300 hover:text-red-500 p-1"
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    )}
                                  </div>
                                  <div className="flex flex-wrap gap-2 ml-2">
                                    {opt.withFollowUp && (
                                      <div className="px-2 py-1 bg-blue-50 border border-blue-100 rounded-lg text-[9px] flex items-center gap-2">
                                        <MessageSquare size={10} className="text-blue-500" />
                                        <span className="font-bold text-blue-700 truncate">Follow-up: {opt.followUpLabel || "Please explain..."}</span>
                                      </div>
                                    )}
                                    {opt.jumpToQuestionId && (() => {
                                      const targetQ = allQuestionsFlat.find(aq => aq.id === opt.jumpToQuestionId);
                                      return (
                                        <div className="px-2 py-1 bg-purple-50 border border-purple-100 rounded-lg text-[9px] flex items-center gap-2">
                                          <CornerDownRight size={10} className="text-purple-500" />
                                          <span className="font-bold text-purple-700 truncate">Jump to: {targetQ ? `Q${targetQ.globalIndex}: ${targetQ.text}` : "Question"}</span>
                                        </div>
                                      );
                                    })()}
                                    {opt.isTerminal && (
                                      <div className="px-2 py-1 bg-red-50 border border-red-100 rounded-lg text-[9px] flex items-center gap-2">
                                        <PowerOff size={10} className="text-red-500" />
                                        <span className="font-bold text-red-700 uppercase tracking-widest">End Survey</span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                              {q.type === 'multiple_choice' && !isRating && (
                                <button
                                  onClick={() => {
                                    const newOpt = { id: `o-${Date.now()}`, text: '', votes: 0, withFollowUp: false, followUpLabel: '' };
                                    updateQuestion(activeSection.id, q.id, { options: [...(q.options || []), newOpt] });
                                  }}
                                  className="w-full py-2 border border-dashed border-gray-100 rounded-xl text-gray-400 font-bold text-[10px] uppercase tracking-widest hover:border-blue-300 hover:text-blue-600 transition-all flex items-center justify-center gap-1.5"
                                >
                                  <Plus size={14} /> Add Option
                                </button>
                              )}
                            </div>
                          ) : q.type === 'text' ? (
                            <div className="p-4 bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl flex flex-col items-center justify-center gap-2">
                              <Type size={24} className="text-gray-300" />
                              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Free Text Input Field</p>
                              <p className="text-[9px] text-gray-400 text-center px-4">Participants will provide a written response instead of choosing from options.</p>
                            </div>
                          ) : null}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </section>

              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept="image/*"
                onChange={handleImageUpload}
              />
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="bg-blue-50 rounded-[2.5rem] p-6 border border-blue-100 shadow-sm relative overflow-hidden">
                <div className="flex items-center gap-3 mb-4"><div className="w-10 h-10 bg-blue-600 text-white rounded-2xl flex items-center justify-center shadow-md"><BarChart3 size={20} /></div><div><h2 className="text-xl font-black text-gray-900 leading-tight">Analytics Setup</h2><p className="text-[10px] font-black text-blue-600 uppercase tracking-widest mt-0.5">Demographics Filter</p></div></div>
                <p className="text-sm text-gray-600 leading-relaxed bg-white/50 p-4 rounded-2xl border border-blue-100/50">Request demographic info to enhance analytics.</p>
              </div>
              <div className="space-y-3"><label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] px-1">Available Attributes</label><div className="flex flex-wrap gap-2">{DEMOGRAPHIC_OPTIONS.map((opt) => { const isSelected = selectedDemographics.includes(opt.id); return <button key={opt.id} onClick={() => handleDemographicToggle(opt.id)} className={`px-4 py-3 rounded-2xl border text-left transition-all max-w-[calc(50%-4px)] flex-1 min-w-[160px] ${isSelected ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-200' : 'bg-white text-gray-600 border-gray-100 hover:border-gray-200'}`}><div className="flex items-center justify-between mb-1"><span className={`text-[12px] font-bold ${isSelected ? 'text-white' : 'text-gray-900'}`}>{opt.label}</span>{isSelected && <Check size={12} strokeWidth={4} />}</div><p className={`text-[9px] leading-tight font-medium ${isSelected ? 'text-blue-50' : 'text-gray-400'}`}>{opt.desc}</p></button>; })}</div></div>
              <div className="flex flex-col gap-3 pt-6"><button onClick={() => handlePost(false)} className="w-full py-5 bg-blue-600 text-white rounded-[2rem] font-black uppercase tracking-[0.2em] text-xs shadow-xl shadow-blue-500/20 active:scale-95 transition-all flex items-center justify-center gap-2">Confirm & Publish <ChevronRight size={18} /></button><button onClick={() => setStep(2)} className="w-full py-4 bg-gray-50 text-gray-400 rounded-[2rem] font-black uppercase tracking-[0.2em] text-[10px] active:scale-95 transition-all">Back</button></div>
            </div>
          )}
        </div>
      </div>

      <BottomSheet
        isOpen={isVisibilitySheetOpen}
        onClose={() => setIsVisibilitySheetOpen(false)}
        title="Post visibility"
      >
        <div className="space-y-2 py-2">
          {visibilityOptions.map((option) => {
            const Icon = option.icon;
            const isSelected = visibility === option.id;
            return (
              <button
                key={option.id}
                onClick={() => {
                  if (option.allowed) {
                    setVisibility(option.id as VisibilityType);
                    if (option.id !== 'Groups') setIsVisibilitySheetOpen(false);
                  }
                }}
                className={`w-full flex items-center gap-4 p-4 rounded-2xl border transition-all text-left group ${!option.allowed ? 'opacity-40 cursor-not-allowed grayscale' : 'hover:bg-gray-50'
                  } ${isSelected ? 'border-blue-500 bg-blue-50/50 ring-1 ring-blue-500/20' : 'border-transparent'}`}
              >
                <div className={`p-2.5 rounded-xl transition-colors ${isSelected ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-100 text-gray-500 group-hover:bg-gray-200'}`}>
                  <Icon size={20} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className={`font-bold text-sm ${isSelected ? 'text-blue-700' : 'text-gray-900'}`}>{option.label}</h4>
                    {option.premium && (
                      <span className="text-[8px] font-black bg-gradient-to-r from-amber-400 to-orange-500 text-white px-1.5 py-0.5 rounded-md uppercase tracking-wider">PRO</span>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-500 leading-tight mt-0.5">{option.desc}</p>
                </div>
                {isSelected && (
                  <div className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center shadow-sm animate-in zoom-in">
                    <Check size={14} strokeWidth={3} />
                  </div>
                )}
              </button>
            );
          })}

          {visibility === 'Groups' && (
            <div className="mt-4 p-4 bg-gray-50 rounded-2xl animate-in slide-in-from-top-2">
              <div className="flex items-center justify-between mb-3 px-1">
                <h5 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Select target groups</h5>
                <span className="text-[9px] font-bold text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded uppercase">Postable</span>
              </div>

              {postableGroups.length > 0 ? (
                <div className="space-y-2 max-h-[250px] overflow-y-auto no-scrollbar">
                  {postableGroups.map(group => {
                    const isGroupSelected = selectedGroups.includes(group.id);
                    return (
                      <button
                        key={group.id}
                        onClick={() => handleGroupToggle(group.id)}
                        className={`w-full flex items-center gap-3 p-2 rounded-xl transition-all border ${isGroupSelected
                          ? 'bg-white border-blue-200 shadow-sm ring-1 ring-blue-500/5'
                          : 'bg-transparent border-transparent hover:bg-white/50'
                          }`}
                      >
                        <img src={group.image} className="w-10 h-10 rounded-lg object-cover border border-gray-200 shadow-xs" alt="" />
                        <div className="flex-1 text-left min-w-0">
                          <p className="text-xs font-bold text-gray-800 truncate">{group.name}</p>
                          <p className="text-[10px] text-gray-400">{(group.memberCount || 0).toLocaleString()} members</p>
                        </div>
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${isGroupSelected ? 'bg-blue-600 border-blue-600' : 'border-gray-200'
                          }`}>
                          {isGroupSelected && <Check size={12} className="text-white" strokeWidth={3} />}
                        </div>
                      </button>
                    );
                  })}

                  <button
                    onClick={() => {
                      setIsVisibilitySheetOpen(false);
                      setErrors(prev => ({ ...prev, visibility: false }));
                    }}
                    className="w-full mt-4 py-2.5 bg-blue-600 text-white rounded-xl text-xs font-bold shadow-md shadow-blue-200 active:scale-95 transition-all"
                  >
                    Confirm {selectedGroups.length > 0 ? `(${selectedGroups.length})` : ''}
                  </button>
                </div>
              ) : (
                <div className="py-6 text-center">
                  <Users size={32} className="mx-auto text-gray-300 mb-2 opacity-30" />
                  <p className="text-xs text-gray-500 font-medium leading-relaxed px-4">
                    You don't have permission to post in any groups.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </BottomSheet>

      {/* Result Visibility Bottom Sheet */}
      <BottomSheet
        isOpen={isResultVisibilitySheetOpen}
        onClose={() => setIsResultVisibilitySheetOpen(false)}
        title="Result Visibility"
        customLayout={true}
      >
        <div className="flex flex-col h-full bg-white">
          <div className="flex-1 overflow-y-auto px-5 py-4 no-scrollbar space-y-8">
            {/* Section 1: Who Can See */}
            <div className="space-y-4">
              <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">Section 1: Who Can See the Results</h3>
              <div className="space-y-2">
                {[
                  { id: 'Public', label: 'Public' },
                  { id: 'Followers', label: 'Followers' },
                  { id: 'Participants', label: 'Participants Only' },
                  { id: 'OnlyMe', label: 'Only Me' }
                ].map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setResultsWho(opt.id as any)}
                    className="w-full flex items-center justify-between p-4 rounded-2xl border transition-all"
                    style={{ borderColor: resultsWho === opt.id ? '#3b82f6' : '#f3f4f6', backgroundColor: resultsWho === opt.id ? '#eff6ff' : 'white' }}
                  >
                    <span className={`text-sm font-bold ${resultsWho === opt.id ? 'text-blue-700' : 'text-gray-700'}`}>{opt.label}</span>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${resultsWho === opt.id ? 'border-blue-600 bg-blue-600' : 'border-gray-200'}`}>
                      {resultsWho === opt.id && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="h-px bg-gray-100" />


            {/* Section 3: When Results Are Visible */}
            <div className="space-y-4">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Section 3: When Results Are Visible</h3>
                {!canShowResultsAfterEnd && <span className="text-[9px] font-bold text-gray-400 flex items-center gap-1"><Info size={10} /> Set duration to enable timing</span>}
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
                    onClick={() => setResultsTiming(opt.id as any)}
                    className={`w-full flex items-center justify-between p-4 rounded-2xl border transition-all ${!opt.enabled ? 'opacity-40 cursor-not-allowed bg-gray-50 grayscale' : ''}`}
                    style={{ borderColor: resultsTiming === opt.id ? '#3b82f6' : '#f3f4f6', backgroundColor: resultsTiming === opt.id ? '#eff6ff' : 'white' }}
                  >
                    <span className={`text-sm font-bold ${resultsTiming === opt.id ? 'text-blue-700' : 'text-gray-700'}`}>{opt.label}</span>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${resultsTiming === opt.id ? 'border-blue-600 bg-blue-600' : 'border-gray-200'}`}>
                      {resultsTiming === opt.id && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="p-5 border-t border-gray-50 bg-gray-50/50 pb-safe">
            <button
              onClick={() => setIsResultVisibilitySheetOpen(false)}
              className="w-full py-4 bg-gray-900 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl"
            >
              Done
            </button>
          </div>
        </div>
      </BottomSheet>

      {/* Category Bottom Sheet */}
      <BottomSheet
        isOpen={isCategorySheetOpen}
        onClose={() => setIsCategorySheetOpen(false)}
        title="Select Category"
      >
        <div className="flex flex-wrap gap-2 py-2">
          {SURVEY_CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => {
                setCategory(cat);
                setErrors(prev => ({ ...prev, category: false }));
                setIsCategorySheetOpen(false);
              }}
              className={`px-4 py-2 rounded-full text-xs font-bold border transition-all active:scale-95 ${category === cat
                ? 'bg-blue-600 text-white border-blue-600 shadow-md'
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </BottomSheet>

      {/* Option Settings Bottom Sheet */}
      <BottomSheet
        isOpen={!!settingsOptionId}
        onClose={() => setSettingsOptionId(null)}
        title="Option Settings"
      >
        {settingsOptionId && selectedOptionForSettings && (
          <div className="space-y-6 py-4 px-2 animate-in fade-in slide-in-from-bottom-2">
            <div className="flex flex-col gap-2">
              {(() => {
                const s = sections.find(s => s.id === settingsOptionId.secId);
                const q = s?.questions.find(q => q.id === settingsOptionId.qId);
                const optIndex = q?.options?.findIndex(o => o.id === settingsOptionId.optId) ?? -1;
                const optCount = q?.options?.length ?? 0;
                const isRatingOpt = q?.options?.some(o => o.isRating);

                return (
                  <>
                    <button
                      disabled={optIndex === 0 || isRatingOpt || q?.type === 'text'}
                      onClick={() => {
                        moveOption(settingsOptionId.secId, settingsOptionId.qId, settingsOptionId.optId, 'up');
                        setSettingsOptionId(null);
                      }}
                      className={`w-full flex items-center gap-4 p-4 rounded-2xl border transition-all text-left ${(optIndex === 0 || isRatingOpt || q?.type === 'text') ? 'opacity-30 grayscale cursor-not-allowed' : 'hover:bg-gray-50 active:scale-[0.98]'
                        }`}
                    >
                      <div className="p-2.5 rounded-xl bg-gray-100 text-gray-500"><ArrowUp size={20} /></div>
                      <span className="font-bold text-sm text-gray-900">Move Up</span>
                    </button>

                    <button
                      disabled={optIndex === optCount - 1 || isRatingOpt || q?.type === 'text'}
                      onClick={() => {
                        moveOption(settingsOptionId.secId, settingsOptionId.qId, settingsOptionId.optId, 'down');
                        setSettingsOptionId(null);
                      }}
                      className={`w-full flex items-center gap-4 p-4 rounded-2xl border transition-all text-left ${(optIndex === optCount - 1 || isRatingOpt || q?.type === 'text') ? 'opacity-30 grayscale cursor-not-allowed' : 'hover:bg-gray-50 active:scale-[0.98]'
                        }`}
                    >
                      <div className="p-2.5 rounded-xl bg-gray-100 text-gray-500"><ArrowDown size={20} /></div>
                      <span className="font-bold text-sm text-gray-900">Move Down</span>
                    </button>
                  </>
                );
              })()}
            </div>

            <div className="h-px bg-gray-100 my-2" />

            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-sm font-bold text-gray-800">Clarification Question</span>
                  <span className="text-[10px] text-gray-400 font-medium">Ask for additional details if this is chosen</span>
                </div>
                <button
                  onClick={() => {
                    setSections(sections.map(s => {
                      if (s.id !== settingsOptionId.secId) return s;
                      return {
                        ...s,
                        questions: s.questions.map(q => {
                          if (q.id !== settingsOptionId.qId || !q.options) return q;
                          return {
                            ...q,
                            options: q.options.map(o => o.id === settingsOptionId.optId ? { ...o, withFollowUp: !o.withFollowUp } : o)
                          };
                        })
                      };
                    }));
                  }}
                  className={`w-10 h-5 rounded-full relative transition-colors ${selectedOptionForSettings.withFollowUp ? 'bg-blue-600' : 'bg-gray-200'}`}
                >
                  <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${selectedOptionForSettings.withFollowUp ? 'left-6' : 'left-1'}`} />
                </button>
              </div>

              {selectedOptionForSettings.withFollowUp && (
                <div className="animate-in fade-in slide-in-from-top-1">
                  <label className="block text-[10px] font-black text-blue-600 uppercase tracking-widest mb-1.5 px-1">Follow-up Question Text</label>
                  <input
                    type="text"
                    value={selectedOptionForSettings.followUpLabel}
                    onChange={(e) => {
                      setSections(sections.map(s => {
                        if (s.id !== settingsOptionId.secId) return s;
                        return {
                          ...s,
                          questions: s.questions.map(q => {
                            if (q.id !== settingsOptionId.qId || !q.options) return q;
                            return {
                              ...q,
                              options: q.options.map(o => o.id === settingsOptionId.optId ? { ...o, followUpLabel: e.target.value } : o)
                            };
                          })
                        };
                      }));
                    }}
                    placeholder="e.g. Please explain your choice..."
                    className="w-full bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-sm focus:outline-none focus:bg-white focus:border-blue-500 transition-all font-bold"
                    autoFocus
                  />
                </div>
              )}

              <div className="h-px bg-gray-100 my-2" />

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-gray-800">Redirect to specific question</span>
                    <span className="text-[10px] text-gray-400 font-medium">Skip subsequent questions based on choice</span>
                  </div>
                  <button
                    onClick={() => {
                      setSections(sections.map(s => s.id === settingsOptionId.secId ? {
                        ...s,
                        questions: s.questions.map(q => q.id === settingsOptionId.qId ? {
                          ...q,
                          options: q.options?.map(o => o.id === settingsOptionId.optId ? {
                            ...o,
                            jumpToQuestionId: o.jumpToQuestionId ? undefined : (futureQuestionsForJump[0]?.id || undefined),
                            isTerminal: false
                          } : o)
                        } : q)
                      } : s));
                    }}
                    className={`w-10 h-5 rounded-full relative transition-colors ${selectedOptionForSettings.jumpToQuestionId ? 'bg-purple-600' : 'bg-gray-200'}`}
                  >
                    <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${selectedOptionForSettings.jumpToQuestionId ? 'left-6' : 'left-1'}`} />
                  </button>
                </div>

                {selectedOptionForSettings.jumpToQuestionId && (
                  <div className="animate-in fade-in slide-in-from-top-1">
                    <label className="block text-[10px] font-black text-purple-600 uppercase tracking-widest mb-1.5 px-1">Target Question</label>
                    <div className="relative">
                      <select
                        value={selectedOptionForSettings.jumpToQuestionId}
                        onChange={(e) => {
                          setSections(sections.map(s => s.id === settingsOptionId.secId ? {
                            ...s,
                            questions: s.questions.map(q => q.id === settingsOptionId.qId ? {
                              ...q,
                              options: q.options?.map(o => o.id === settingsOptionId.optId ? { ...o, jumpToQuestionId: e.target.value } : o)
                            } : q)
                          } : s));
                        }}
                        className="w-full bg-purple-50 border border-purple-100 rounded-xl px-4 py-3 text-xs font-bold focus:outline-none appearance-none pr-10"
                      >
                        {futureQuestionsForJump.length > 0 ? (
                          futureQuestionsForJump.map(fq => (
                            <option key={fq.id} value={fq.id}>{`Q${fq.globalIndex}: ${fq.text}`}</option>
                          ))
                        ) : (
                          <option disabled>No future questions available</option>
                        )}
                      </select>
                      <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-purple-400 pointer-events-none" />
                    </div>
                    {futureQuestionsForJump.length === 0 && <p className="text-[9px] text-red-500 font-bold mt-1 px-1">You must add more questions to the survey to use jump logic.</p>}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-sm font-bold text-gray-800">End survey on selection</span>
                  <span className="text-[10px] text-gray-400 font-medium">Selecting this will finish the survey immediately</span>
                </div>
                <button
                  onClick={() => {
                    setSections(sections.map(s => s.id === settingsOptionId.secId ? {
                      ...s,
                      questions: s.questions.map(q => q.id === settingsOptionId.qId ? {
                        ...q,
                        options: q.options?.map(o => o.id === settingsOptionId.optId ? {
                          ...o,
                          isTerminal: !o.isTerminal,
                          jumpToQuestionId: undefined
                        } : o)
                      } : q)
                    } : s));
                  }}
                  className={`w-10 h-5 rounded-full relative transition-colors ${selectedOptionForSettings.isTerminal ? 'bg-red-600' : 'bg-gray-200'}`}
                >
                  <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${selectedOptionForSettings.isTerminal ? 'left-6' : 'left-1'}`} />
                </button>
              </div>
            </div>

            <button
              onClick={() => setSettingsOptionId(null)}
              className="w-full mt-4 py-4 bg-gray-900 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-lg active:scale-95 transition-all"
            >
              Done
            </button>
          </div>
        )}
      </BottomSheet>

      {/* Question Settings Bottom Sheet */}
      <BottomSheet
        isOpen={isQuestionSettingsSheetOpen}
        onClose={() => setIsQuestionSettingsSheetOpen(false)}
        title="Question Settings"
      >
        {activeSection && activeQuestionId && (
          <div className="space-y-4 py-4 px-2">
            <div className="flex flex-col gap-2">
              {(() => {
                const index = activeSection.questions.findIndex(q => q.id === activeQuestionId);
                const count = activeSection.questions.length;

                return (
                  <>
                    <button
                      disabled={index === 0}
                      onClick={() => {
                        moveQuestion(activeSection.id, activeQuestionId, 'up');
                        setIsQuestionSettingsSheetOpen(false);
                      }}
                      className={`w-full flex items-center gap-4 p-4 rounded-2xl border transition-all text-left ${index === 0 ? 'opacity-30 grayscale cursor-not-allowed' : 'hover:bg-gray-50 active:scale-[0.98]'
                        }`}
                    >
                      <div className="p-2.5 rounded-xl bg-gray-100 text-gray-500"><ArrowUp size={20} /></div>
                      <span className="font-bold text-sm text-gray-900">Move Up</span>
                    </button>

                    <button
                      disabled={index === count - 1}
                      onClick={() => {
                        moveQuestion(activeSection.id, activeQuestionId, 'down');
                        setIsQuestionSettingsSheetOpen(false);
                      }}
                      className={`w-full flex items-center gap-4 p-4 rounded-2xl border transition-all text-left ${index === count - 1 ? 'opacity-30 grayscale cursor-not-allowed' : 'hover:bg-gray-50 active:scale-[0.98]'
                        }`}
                    >
                      <div className="p-2.5 rounded-xl bg-gray-100 text-gray-500"><ArrowDown size={20} /></div>
                      <span className="font-bold text-sm text-gray-900">Move Down</span>
                    </button>

                    <div className="h-px bg-gray-100 my-2" />

                    <button
                      disabled={count <= 1}
                      onClick={() => {
                        const updatedQs = activeSection.questions.filter(q => q.id !== activeQuestionId);
                        setSections(sections.map(s => s.id === activeSection.id ? { ...s, questions: updatedQs } : s));
                        setActiveQuestionId(updatedQs[0]?.id || null);
                        setIsQuestionSettingsSheetOpen(false);
                      }}
                      className={`w-full flex items-center gap-4 p-4 rounded-2xl border border-red-100 transition-all text-left bg-red-50/30 ${count <= 1 ? 'opacity-30 grayscale cursor-not-allowed' : 'hover:bg-red-50 active:scale-[0.98]'
                        }`}
                    >
                      <div className="p-2.5 rounded-xl bg-red-100 text-red-600"><Trash2 size={20} /></div>
                      <span className="font-bold text-sm text-red-600">Delete Question</span>
                    </button>
                  </>
                );
              })()}
            </div>

            <button
              onClick={() => setIsQuestionSettingsSheetOpen(false)}
              className="w-full mt-4 py-4 bg-gray-900 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-lg active:scale-95 transition-all"
            >
              Done
            </button>
          </div>
        )}
      </BottomSheet>

      {/* Section Settings Bottom Sheet */}
      <BottomSheet
        isOpen={isSectionSettingsSheetOpen}
        onClose={() => setIsSectionSettingsSheetOpen(false)}
        title="Section Settings"
      >
        {activeSection && (
          <div className="space-y-4 py-4 px-2">
            <div className="flex flex-col gap-2">
              <button
                disabled={activeSectionIndex === 0}
                onClick={() => {
                  moveSection(activeSection.id, 'up');
                  setIsSectionSettingsSheetOpen(false);
                }}
                className={`w-full flex items-center gap-4 p-4 rounded-2xl border transition-all text-left ${activeSectionIndex === 0 ? 'opacity-30 grayscale cursor-not-allowed' : 'hover:bg-gray-50 active:scale-[0.98]'
                  }`}
              >
                <div className="p-2.5 rounded-xl bg-gray-100 text-gray-500"><ArrowUp size={20} /></div>
                <span className="font-bold text-sm text-gray-900">Move Up</span>
              </button>

              <button
                disabled={activeSectionIndex === sections.length - 1}
                onClick={() => {
                  moveSection(activeSection.id, 'down');
                  setIsSectionSettingsSheetOpen(false);
                }}
                className={`w-full flex items-center gap-4 p-4 rounded-2xl border transition-all text-left ${activeSectionIndex === sections.length - 1 ? 'opacity-30 grayscale cursor-not-allowed' : 'hover:bg-gray-50 active:scale-[0.98]'
                  }`}
              >
                <div className="p-2.5 rounded-xl bg-gray-100 text-gray-500"><ArrowDown size={20} /></div>
                <span className="font-bold text-sm text-gray-900">Move Down</span>
              </button>

              <div className="h-px bg-gray-100 my-2" />

              <button
                disabled={sections.length <= 1}
                onClick={() => {
                  const updatedSections = sections.filter(s => s.id !== activeSection.id);
                  setSections(updatedSections);
                  setActiveSectionId(updatedSections[0]?.id || null);
                  setIsSectionSettingsSheetOpen(false);
                }}
                className={`w-full flex items-center gap-4 p-4 rounded-2xl border border-red-100 transition-all text-left bg-red-50/30 ${sections.length <= 1 ? 'opacity-30 grayscale cursor-not-allowed' : 'hover:bg-red-50 active:scale-[0.98]'
                  }`}
              >
                <div className="p-2.5 rounded-xl bg-red-100 text-red-600"><Trash2 size={20} /></div>
                <span className="font-bold text-sm text-red-600">Delete Section</span>
              </button>
            </div>

            <button
              onClick={() => setIsSectionSettingsSheetOpen(false)}
              className="w-full mt-4 py-4 bg-gray-900 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-lg active:scale-95 transition-all"
            >
              Done
            </button>
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
              <button onClick={() => handlePost(true)} className="w-full py-3 bg-blue-50 text-blue-600 rounded-xl font-bold text-sm hover:bg-blue-100 transition-colors">Save as Draft</button>
              <button onClick={() => setShowExitConfirm(false)} className="w-full py-3 bg-gray-100 text-gray-700 rounded-xl font-bold text-sm hover:bg-gray-200 transition-colors">Keep Editing</button>
            </div>
          </div>
        </div>
      )}

      {croppingImage && <ImageCropper imageSrc={croppingImage} onCrop={handleCropComplete} onCancel={() => { setCroppingImage(null); setActiveCropTarget(null); }} />}
    </div>
  );
};
