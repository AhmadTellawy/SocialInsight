
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { X, Image as ImageIcon, Plus, Trash2, Globe, Users, AlertCircle, Clock, Calendar, ChevronDown, List, GalleryHorizontalEnd, Info, Lock, Camera, Save, BarChart3, Check, ChevronRight, UserCircle, Target, Link2, LayoutGrid, Settings2, Star, MoreHorizontal, ArrowUp, ArrowDown, MessageSquare, ArrowLeft, Tag } from 'lucide-react';
import { Survey, SurveyType, UserProfile, Option, Group, DraftOption } from '../types';
import { ImageCropper } from './ImageCropper';
import { BottomSheet } from './BottomSheet';
import { RichMentionInput } from './RichMentionInput';
import { api } from '../services/api';

interface CreatePollScreenProps {
  onClose: () => void;
  onSubmit: (surveyData: Partial<Survey>) => void;
  onSaveDraft?: (surveyData: Partial<Survey>) => void | Promise<void>;
  userProfile: UserProfile;
  draft?: Survey;
  userGroups?: Group[];
  initialGroupId?: string | null;
}

const POLL_CATEGORIES = [
  "Entertainment", "Social", "Economic", "Political", "Health",
  "Educational", "Cultural", "Environmental", "Technology", "Media",
  "Legal", "Sports", "Business / Commercial", "Government / Public",
  "Community / Development", "Family", "Youth", "Quality of Life", "Other"
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

type VisibilityType = 'Groups' | 'Custom Audience' | 'Custom Domain';

export const CreatePollScreen: React.FC<CreatePollScreenProps> = ({ onClose, onSubmit, onSaveDraft, userProfile, draft, userGroups = [], initialGroupId }) => {
  const [visibility, setVisibility] = useState<VisibilityType>('Groups');
  const [selectedGroups, setSelectedGroups] = useState<string[]>(initialGroupId ? [initialGroupId] : []);
  const [isCategorySheetOpen, setIsCategorySheetOpen] = useState(false);
  const [isAdvancedSheetOpen, setIsAdvancedSheetOpen] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [advancedSheetView, setAdvancedSheetView] = useState<'main' | 'visibility' | 'results'>('main');

  const handleExit = () => {
    // Check if there are any changes to prompt for save
    if (title.trim() || options.some(o => o.text.trim()) || coverImage) {
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

  const handleSaveDraft = async () => {
    if (!userProfile?.id) {
      alert('Please log in to save a draft');
      return;
    }

    if (onSaveDraft) {
      const finalCategory = category === 'Other' ? otherCategoryText.trim() : category;
      const draftData: Partial<Survey> = {
        id: draft?.id,
        title: title.trim(),
        description: '',
        type: SurveyType.POLL,
        pollChoiceType,
        author: { id: userProfile.id, name: userProfile.name, avatar: userProfile.avatar },
        options: options.map(o => ({
          id: o.id,
          text: o.text,
          votes: 0,
          image: o.image || undefined,
          isRating: o.isRating || (pollChoiceType === 'rating'),
          ratingValue: o.ratingValue || 0,
          withFollowUp: o.withFollowUp,
          followUpLabel: o.followUpLabel
        })),
        coverImage: coverImage || undefined,
        imageLayout: imageLayout,
        targetAudience: visibility as any,
        targetGroups: visibility === 'Groups' ? selectedGroups : undefined,
        resultsWho,
        resultsTiming,
        category: finalCategory,
        allowUserOptions: pollChoiceType === 'rating' ? false : allowUserOptions,
        allowMultipleSelection: pollChoiceType === 'rating' ? false : allowMultipleSelection,
        allowComments,
        allowAnonymous: true,
        forceAnonymous: forceAnonymous,
        demographics: selectedDemographics,
        expiresAt: getExpiresAt(),
        status: 'DRAFT',
        isDraft: true,
        currentStep: 1
      };

      try {
        await onSaveDraft(draftData);
      } catch (error) {
        console.error('Failed to save draft:', error);
        alert('Failed to save draft. Please try again.');
        return;
      }
    }
    onClose();
  };

  // New Detailed Visibility State
  const [resultsWho, setResultsWho] = useState<'Public' | 'Followers' | 'Participants' | 'OnlyMe'>('Public');
  const [resultsTiming, setResultsTiming] = useState<'AnyTime' | 'Immediately' | 'AfterEnd'>('AnyTime');

  const [category, setCategory] = useState<string>('');
  const [otherCategoryText, setOtherCategoryText] = useState<string>('');

  const [imageLayout, setImageLayout] = useState<'vertical' | 'horizontal'>('vertical');
  const [coverImage, setCoverImage] = useState<string | null>(null);
  const [croppingImage, setCroppingImage] = useState<string | null>(null);
  const [activeCropId, setActiveCropId] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [pollChoiceType, setPollChoiceType] = useState<'multiple' | 'rating'>('multiple');

  const [options, setOptions] = useState<DraftOption[]>([
    { id: '1', text: '', image: undefined, withFollowUp: false, followUpLabel: '' },
    { id: '2', text: '', image: undefined, withFollowUp: false, followUpLabel: '' }
  ]);

  const [settingsOptionId, setSettingsOptionId] = useState<string | null>(null);

  const [allowUserOptions, setAllowUserOptions] = useState(false);
  const [allowMultipleSelection, setAllowMultipleSelection] = useState(false);
  const [allowComments, setAllowComments] = useState(true);
  const [forceAnonymous, setForceAnonymous] = useState(false);

  const [duration, setDuration] = useState<string>('none');
  const [customEndDate, setCustomEndDate] = useState<string>('');

  const [selectedDemographics, setSelectedDemographics] = useState<string[]>([]);
  const [errors, setErrors] = useState<{ [key: string]: boolean | string }>({});
  const [focusedOptionId, setFocusedOptionId] = useState<string | null>(null);
  const [selectedInsightPreset, setSelectedInsightPreset] = useState<'basic' | 'professional' | 'social' | 'custom' | null>(null);
  const [showInsightInfo, setShowInsightInfo] = useState(false);
  const [showLayoutInfo, setShowLayoutInfo] = useState(false);

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

  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (draft) {
      const combinedPrompt = [draft.title, draft.description].filter(Boolean).join('\n\n');
      setTitle(combinedPrompt || '');
      setCategory(draft.category || '');
      setPollChoiceType(draft.pollChoiceType || 'multiple');
      setVisibility((draft.targetAudience as VisibilityType) || 'Public');
      setResultsWho(draft.resultsWho || 'Public');
      setResultsTiming(draft.resultsTiming || 'AnyTime');
      setAllowUserOptions(draft.allowUserOptions || false);
      setAllowMultipleSelection(draft.allowMultipleSelection || false);
      setAllowComments(draft.allowComments !== undefined ? draft.allowComments : true);
      setForceAnonymous(draft.forceAnonymous || false);
      setCoverImage(draft.coverImage || null);
      setImageLayout(draft.imageLayout || 'vertical');
      if (draft.options) {
        setOptions(draft.options.map(o => ({
          id: o.id,
          text: o.text,
          image: o.image || undefined,
          isRating: o.isRating,
          ratingValue: o.ratingValue,
          withFollowUp: o.withFollowUp || false,
          followUpLabel: o.followUpLabel || ''
        })));
      }
      if (draft.demographics) {
        setSelectedDemographics(draft.demographics);
      }
      if (draft.expiresAt) {
        const expiration = new Date(draft.expiresAt);
        const now = draft.createdAt ? new Date(draft.createdAt) : new Date();
        const diffHour = (expiration.getTime() - now.getTime()) / (1000 * 60 * 60);

        if (diffHour > 80000) { // arbitrary massive amount like 10y
          setDuration('none');
        } else if (Math.abs(diffHour - 1) < 0.5) {
          setDuration('1h');
        } else if (Math.abs(diffHour - 24) < 1) {
          setDuration('24h');
        } else if (Math.abs(diffHour - 72) < 2) {
          setDuration('3d');
        } else if (Math.abs(diffHour - 168) < 4) {
          setDuration('1w');
        } else if (Math.abs(diffHour - 720) < 24) {
          setDuration('1m');
        } else {
          setDuration('custom');
          // Format ISO without Z mapping direct local string input length 16 yyyy-MM-ddThh:mm
          const localString = new Date(expiration.getTime() - (expiration.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
          setCustomEndDate(localString);
        }
      }

    }
  }, [draft]);

  // Sync "After post ends" with duration
  const canShowResultsAfterEnd = duration !== 'none';

  useEffect(() => {
    if (duration === 'none' && resultsTiming === 'AfterEnd') {
      setResultsTiming('Immediately');
    }
  }, [duration]);

  const durationLabel = DURATION_OPTIONS.find(opt => opt.value === duration)?.label || (duration === 'custom' ? 'Custom' : 'None');
  const audienceLabel = visibility === 'Groups' && selectedGroups.length > 0 ? `${selectedGroups.length} Groups` : visibility;
  const resultsLabel = resultsWho === 'OnlyMe' ? 'Only Me' : resultsWho;
  const advancedItems = [
    duration !== 'none' ? durationLabel : null,
    pollChoiceType !== 'rating' && allowMultipleSelection ? 'Multi' : null,
    pollChoiceType !== 'rating' && allowUserOptions ? 'User opts' : null,
    !allowComments ? 'Comments off' : null,
    forceAnonymous ? 'Anon' : null,
  ].filter(Boolean) as string[];
  const advancedSummary = advancedItems.length === 0
    ? 'Default'
    : advancedItems.length === 1
      ? advancedItems[0]
      : `${advancedItems.length} on`;


  const isVerified = (userProfile?.stats?.followers || 0) > 1000;
  const isOrganization = false;

  const postableGroups = useMemo(() => {
    return userGroups.filter(group => {
      const isAdminOrOwner = group.role === 'Owner' || group.role === 'Admin';
      const hasExplicitPermission = group.postingPermissions === 'AllMembers' || group.postingPermissions === 'ApprovalNeeded';
      return isAdminOrOwner || hasExplicitPermission;
    });
  }, [userGroups]);

  const visibilityOptions = [
    { id: 'Groups', label: 'Selected groups', desc: 'Visible only within selected groups.', icon: Users, allowed: true },
    { id: 'Custom Audience', label: 'Custom audience', desc: 'Specific targeted audience.', icon: Target, allowed: isVerified, premium: true },
    { id: 'Custom Domain', label: 'Custom domain', desc: 'Private branded link.', icon: Link2, allowed: isOrganization, premium: true },
  ];

  const handleAddOption = () => {
    const newOptId = Date.now().toString();
    setOptions(prev => [...prev, { id: newOptId, text: '', image: undefined, withFollowUp: false, followUpLabel: '' }]);
    setFocusedOptionId(newOptId);
  };

  const handleRemoveOption = (id: string) => {
    setOptions(prev => prev.length > 2 ? prev.filter(o => o.id !== id) : prev);
  };

  const handleOptionChange = (id: string, text: string) => {
    setOptions(prev => prev.map(o => id === o.id ? { ...o, text } : o));
    if (errors.options) setErrors({ ...errors, options: false });
  };

  const handleChoiceTypeChange = (type: 'multiple' | 'rating') => {
    setPollChoiceType(type);
    if (type === 'rating') {
      setOptions([
        { id: 'rate-5', text: '5', image: null, isRating: true, ratingValue: 5, withFollowUp: false, followUpLabel: '' },
        { id: 'rate-4', text: '4', image: null, isRating: true, ratingValue: 4, withFollowUp: false, followUpLabel: '' },
        { id: 'rate-3', text: '3', image: null, isRating: true, ratingValue: 3, withFollowUp: false, followUpLabel: '' },
        { id: 'rate-2', text: '2', image: null, isRating: true, ratingValue: 2, withFollowUp: false, followUpLabel: '' },
        { id: 'rate-1', text: '1', image: null, isRating: true, ratingValue: 1, withFollowUp: false, followUpLabel: '' },
      ]);
      setAllowMultipleSelection(false);
      setAllowUserOptions(false);
    } else {
      setOptions([
        { id: '1', text: '', image: null, withFollowUp: false, followUpLabel: '' },
        { id: '2', text: '', image: null, withFollowUp: false, followUpLabel: '' }
      ]);
    }
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
    if (activeCropId === 'cover') {
      setCoverImage(croppedImg);
    } else if (activeCropId) {
      setOptions(options.map(o => o.id === activeCropId ? { ...o, image: croppedImg } : o));
    }
    setCroppingImage(null);
    setActiveCropId(null);
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

  const moveOption = (id: string, direction: 'up' | 'down') => {
    const index = options.findIndex(o => o.id === id);
    if (index === -1) return;
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === options.length - 1) return;

    const newOptions = [...options];
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    [newOptions[index], newOptions[swapIndex]] = [newOptions[swapIndex], newOptions[index]];
    setOptions(newOptions);
  };

  const updateFollowUp = (id: string, updates: { withFollowUp?: boolean; followUpLabel?: string }) => {
    setOptions(prev => prev.map(o => o.id === id ? { ...o, ...updates } : o));
  };

  const validate = () => {
    const newErrors: { [key: string]: boolean | string } = {};
    let isValid = true;
    if (!userProfile?.id) {
      newErrors.userProfile = "User profile not found. Please log in.";
      isValid = false;
    }
    if (!title.trim()) {
      newErrors.title = "Question text is required";
      isValid = false;
    }

    if (pollChoiceType === 'multiple') {
      if (options.filter(o => o.text.trim() !== '').length < 2) {
        newErrors.options = "At least 2 options are required";
        isValid = false;
      }
    }

    if (!category) {
      newErrors.category = "Please select a category";
      isValid = false;
      setIsCategorySheetOpen(true);
    }
    if (visibility === 'Groups' && selectedGroups.length === 0) {
      newErrors.visibility = "Please select at least one group.";
      isValid = false;
      setIsAdvancedSheetOpen(true);
      setAdvancedSheetView('visibility');
    }
    if (category === 'Other' && !otherCategoryText.trim()) {
      newErrors.otherCategoryText = true;
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

  const handleSubmit = () => {
    if (!userProfile?.id) {
      alert('Please log in to create a post');
      return;
    }
    setHasAttemptedSubmit(true);
    if (!validate()) return;

    try {
      const finalCategory = category === 'Other' ? otherCategoryText.trim() : category;
      onSubmit({
        title: title.trim(),
        description: '',
        type: SurveyType.POLL,
        pollChoiceType,
        author: { id: userProfile.id, name: userProfile.name, avatar: userProfile.avatar },
        options: options.map(o => ({
          id: o.id,
          text: o.text,
          votes: 0,
          image: o.image || undefined,
          isRating: o.isRating || (pollChoiceType === 'rating'),
          ratingValue: o.ratingValue || 0,
          withFollowUp: o.withFollowUp,
          followUpLabel: o.followUpLabel
        })),
        coverImage: coverImage || undefined,
        imageLayout: imageLayout,
        targetAudience: visibility as any,
        targetGroups: visibility === 'Groups' ? selectedGroups : undefined,
        resultsWho,
        resultsTiming,
        category: finalCategory,
        allowUserOptions: pollChoiceType === 'rating' ? false : allowUserOptions,
        allowMultipleSelection: pollChoiceType === 'rating' ? false : allowMultipleSelection,
        allowComments,
        allowAnonymous: true,
        forceAnonymous: forceAnonymous,
        demographics: selectedDemographics,
        expiresAt: getExpiresAt()
      });

      // Close the creation screen and return to home
      onClose();
    } catch (error) {
      console.error('Error in handleSubmit:', error);
      alert('Failed to create post. Please try again.');
    }
  };

  const selectedOptionForSettings = options.find(o => o.id === settingsOptionId);

  return (
    <div className="absolute inset-0 z-[60] bg-white flex flex-col animate-in slide-in-from-right duration-350">
      {/* Simplified Clean Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-white/95 backdrop-blur-md sticky top-0 z-40 safe-top shrink-0">
        <button onClick={handleExit} className="p-2 -ml-2 hover:bg-gray-50 rounded-full text-gray-500">
          <ArrowLeft size={24} />
        </button>
        <h1 className="text-sm font-black text-gray-800">New Poll</h1>
        <button onClick={handleSubmit} className="text-white font-black text-[11px] px-5 py-2.5 rounded-full bg-blue-600 hover:bg-blue-700 transition-all uppercase tracking-widest shadow-md active:scale-95 shadow-blue-200/50">
          Post
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

          {/* 1. Question Section */}
          <section className="space-y-4 pb-4 border-b border-gray-100">
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <RichMentionInput
                  value={title}
                  onChange={(val) => { setTitle(val); if (errors.title) setErrors(prev => ({ ...prev, title: false })) }}
                  placeholder="Ask a question..."
                  className={`text-sm font-semibold bg-transparent border-b border-gray-100 focus:outline-none focus:border-blue-500 transition-all pt-0.5 pb-1.5 placeholder-gray-300 min-h-[44px] ${errors.title ? 'border-red-300 text-red-500' : 'text-gray-900'}`}
                  minRows={1}
                  autoFocus
                />
                {errors.title && <p className="text-[10px] font-bold text-red-500 px-1 mt-1">{errors.title}</p>}
              </div>
              <button
                type="button"
                onClick={() => { setActiveCropId('cover'); fileInputRef.current?.click(); }}
                className={`p-1.5 rounded-full transition-colors shrink-0 mt-1 ${coverImage ? 'text-blue-600 bg-blue-50' : 'text-gray-400 hover:text-blue-500 hover:bg-gray-50'}`}
              >
                <Camera size={20} />
              </button>
            </div>

            {/* Cover Media Preview */}
            {coverImage && (
              <div className="relative w-24 h-24 rounded-xl overflow-hidden border border-gray-100 shadow-sm group animate-in zoom-in-95 mt-2">
                <img src={coverImage} className="w-full h-full object-cover" alt="Cover" />
                <button onClick={() => setCoverImage(null)} className="absolute top-1 right-1 p-1 bg-black/50 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"><X size={10} /></button>
              </div>
            )}

            {/* Category and Poll Type Grid */}
            <div className="grid grid-cols-2 gap-4 pt-3 mt-3 border-t border-gray-55/50">
              {/* Left Column: Category */}
              <div className="space-y-1.5 text-left min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <div className="p-1.5 bg-gray-50 rounded-lg text-gray-500 border border-gray-100 shrink-0">
                    <Tag size={12} />
                  </div>
                  <span className="text-xs font-bold text-gray-800">Category</span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsCategorySheetOpen(true)}
                  className={`w-full flex items-center justify-between border rounded-xl px-3 py-2 text-[8px] font-semibold transition-all active:scale-[0.98] min-w-0 ${
                    category
                      ? 'bg-blue-50 border-blue-200 text-blue-700 font-semibold'
                      : hasAttemptedSubmit && !category
                      ? 'bg-red-50 border-red-200 text-red-600 font-bold'
                      : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-55'
                  }`}
                >
                  <div className="flex items-center min-w-0 mr-1">
                    <span className="truncate">{category || 'Select category'}</span>
                  </div>
                  <ChevronDown size={14} className="text-gray-400 shrink-0" />
                </button>
                {errors.category && !category && (
                  <p className="text-[10px] font-semibold text-red-600 px-1 mt-1">Please select a category.</p>
                )}
              </div>

              {/* Right Column: Poll Type */}
              <div className="space-y-1.5 text-left font-sans">
                <div className="flex items-center gap-2 mb-1">
                  <div className="p-1.5 bg-gray-50 rounded-lg text-gray-500 border border-gray-100 shrink-0">
                    <BarChart3 size={12} />
                  </div>
                  <span className="text-xs font-bold text-gray-800">Poll Type</span>
                </div>
                <div className="flex bg-gray-55/30 border border-gray-100 p-0.5 rounded-xl h-[38px] items-center">
                  <button
                    type="button"
                    onClick={() => handleChoiceTypeChange('multiple')}
                    className={`flex-1 h-full rounded-lg text-[8px] font-black uppercase tracking-wider transition-all ${
                      pollChoiceType === 'multiple'
                        ? 'bg-white text-blue-600 border border-blue-500 shadow-xs'
                        : 'text-gray-400 hover:text-gray-650'
                    }`}
                  >
                    Multiple Choice
                  </button>
                  <button
                    type="button"
                    onClick={() => handleChoiceTypeChange('rating')}
                    className={`flex-1 h-full rounded-lg text-[8px] font-black uppercase tracking-wider transition-all ${
                      pollChoiceType === 'rating'
                        ? 'bg-white text-blue-600 border border-blue-500 shadow-xs'
                        : 'text-gray-400 hover:text-gray-650'
                    }`}
                  >
                    Rating
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* 3. Options Section */}
          <section className="space-y-4 pb-2.5 border-b border-gray-100">
            <div className="flex items-center justify-between px-1 border-b border-gray-55/40 pb-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="p-1.5 bg-gray-55/30 rounded-lg text-gray-500 border border-gray-100 shrink-0">
                  <List size={12} />
                </div>
                <span className="text-xs font-bold text-gray-800">Options <span className="text-red-500">*</span></span>
                {errors.options && <span className="text-[10px] font-bold text-red-600 truncate">{errors.options}</span>}
              </div>

              {pollChoiceType === 'multiple' && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] font-bold text-gray-400">Option Layout</span>
                  <button
                    type="button"
                    onClick={() => setShowLayoutInfo(!showLayoutInfo)}
                    className="text-gray-400 hover:text-blue-500 transition-colors mr-1"
                  >
                    <Info size={14} />
                  </button>
                  <div className="flex gap-1">
                    {[
                      { id: 'vertical', icon: List },
                      { id: 'horizontal', icon: GalleryHorizontalEnd }
                    ].map((layout) => {
                      const Icon = layout.icon;
                      const isActive = imageLayout === layout.id;
                      return (
                        <button
                          key={layout.id}
                          type="button"
                          onClick={() => setImageLayout(layout.id as any)}
                          className={`p-1.5 rounded-lg border transition-all active:scale-95 ${
                            isActive
                              ? 'bg-blue-600 text-white border-blue-600 shadow-sm shadow-blue-100'
                              : 'bg-white text-gray-400 border-gray-200 hover:bg-gray-50'
                          }`}
                          title={layout.id}
                        >
                          <Icon size={15} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {pollChoiceType === 'multiple' && showLayoutInfo && (
              <div className="p-3 bg-blue-50 border border-blue-100 text-blue-800 text-[10px] font-semibold rounded-xl leading-relaxed animate-in fade-in slide-in-from-top-1 duration-200">
                Choose how image-based poll options are displayed, such as a vertical list or side-by-side layout.
              </div>
            )}

            <div className="space-y-3">
              {options.map((option, idx) => (
                <div key={option.id} className="flex items-center gap-2 animate-in fade-in slide-in-from-bottom-1 duration-200">
                  <span className="text-xs font-black text-gray-300 w-4 text-center shrink-0">{idx + 1}</span>
                  <div className="flex-1 flex flex-col gap-1.5">
                    <div className="flex items-center w-full bg-gray-55/5 border border-gray-200 rounded-xl px-2 py-0.5 focus-within:border-blue-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-blue-100 transition-all shadow-xs">
                      {pollChoiceType === 'multiple' && (
                        <button
                          type="button"
                          onClick={() => {
                            setActiveCropId(option.id);
                            fileInputRef.current?.click();
                          }}
                          className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 overflow-hidden border border-dashed transition-all ${option.image ? 'border-blue-500' : 'border-gray-200 text-gray-400 hover:text-blue-500'}`}
                        >
                          {option.image ? (
                            <img src={option.image} className="w-full h-full object-cover" alt="" />
                          ) : (
                            <Camera size={14} />
                          )}
                        </button>
                      )}

                      {pollChoiceType === 'rating' ? (
                        <div className="flex-1 px-2.5 py-1.5 flex items-center gap-2">
                          <div className="flex text-yellow-500">
                            {Array.from({ length: option.ratingValue || 0 }).map((_, i) => (
                              <Star key={i} size={14} fill="currentColor" />
                            ))}
                          </div>
                        </div>
                      ) : (
                        <input
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
                          placeholder={`Option ${idx + 1}`}
                          className="flex-1 px-2.5 py-1.5 bg-transparent text-sm font-semibold focus:outline-none text-gray-900"
                        />
                      )}

                      {pollChoiceType !== 'rating' && (
                        <span className="text-[9px] text-gray-450 mr-1.5 whitespace-nowrap">{option.text.length}/80</span>
                      )}

                      {pollChoiceType === 'multiple' && option.image && (
                        <button
                          type="button"
                          onClick={() => setOptions(options.map(o => o.id === option.id ? { ...o, image: null } : o))}
                          className="p-1.5 text-gray-300 hover:text-red-500 rounded-full flex items-center justify-center transition-colors mr-1"
                        >
                          <X size={14} strokeWidth={3} />
                        </button>
                      )}
                    </div>

                    {option.withFollowUp && (
                      <div className="px-2 py-1.5 bg-blue-50 border border-blue-100 rounded-lg text-[10px] flex items-center gap-2">
                        <MessageSquare size={10} className="text-blue-500" />
                        <span className="font-bold text-blue-700 truncate">Follow-up: {option.followUpLabel || "Please explain..."}</span>
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
              {pollChoiceType === 'multiple' && (
                <div className="flex items-center gap-2 opacity-50 hover:opacity-80 focus-within:opacity-100 transition-opacity duration-200">
                  <span className="text-xs font-black text-gray-300 w-4 text-center shrink-0">{options.length + 1}</span>
                  <div className="flex-1 flex flex-col gap-2">
                    <div className="flex items-center w-full bg-gray-50/30 border border-dashed border-gray-200 rounded-xl px-2 py-0.5">
                      <button disabled className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border border-dashed border-gray-200 text-gray-300">
                        <Camera size={14} />
                      </button>
                      <input
                        type="text"
                        placeholder="Add option..."
                        className="flex-1 px-2.5 py-1.5 bg-transparent text-sm font-semibold focus:outline-none text-gray-400 cursor-pointer"
                        onFocus={handleAddOption}
                      />
                    </div>
                  </div>
                  <button disabled className="p-2 text-gray-200 rounded-full flex items-center justify-center shrink-0">
                    <MoreHorizontal size={18} />
                  </button>
                </div>
              )}
            </div>
          </section>



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
                <p className="text-[9px] text-gray-400 mt-0.5 leading-tight">Visibility, results, duration & comments</p>
              </div>
            </div>
            <ChevronRight size={14} className="text-gray-400" />
          </button>

          {/* 5. Optional Demographics Insights (Unlock Deeper Analytics Selector) */}
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
                  className="text-gray-400 hover:text-blue-500 transition-colors ml-0.5"
                >
                  <Info size={14} />
                </button>
              </div>
            </div>

            {showInsightInfo && (
              <div className="p-3 bg-blue-50 border border-blue-100 text-blue-800 text-[10px] font-semibold rounded-xl leading-relaxed animate-in fade-in slide-in-from-top-1 duration-200">
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
                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
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
                  <span className="text-[10px] font-extrabold text-blue-600 whitespace-nowrap">
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
                        className={`px-3 py-1.5 rounded-full text-[9px] font-bold border transition-all flex items-center gap-1 active:scale-95 ${
                          isSelected
                            ? 'bg-blue-50 border-blue-200 text-blue-600 font-semibold'
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

          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept="image/*"
            onChange={handleImageUpload}
          />
        </div>
      </div>

      {/* Advanced Settings Bottom Sheet with Sub-navigation Routing */}
      <BottomSheet
        isOpen={isAdvancedSheetOpen}
        onClose={() => {
          if (visibility === 'Groups' && selectedGroups.length === 0) {
            setVisibility('Public');
          }
          setAdvancedSheetView('main');
          setIsAdvancedSheetOpen(false);
        }}
        title={
          advancedSheetView === 'visibility'
            ? 'Post Visibility'
            : advancedSheetView === 'results'
            ? 'Result Visibility'
            : 'Advanced Settings'
        }
      >
        <div className="space-y-5 py-2 px-2 animate-in fade-in duration-200">
          {advancedSheetView === 'main' && (
            <div className="space-y-5">
              <p className="text-[11px] text-gray-550 leading-relaxed px-1">
                Control who can see, vote, and view results.
              </p>

              {/* Sub-routing rows */}
              <div className="space-y-1.5">
                {/* Visibility Sub-trigger */}
                <button
                  type="button"
                  onClick={() => setAdvancedSheetView('visibility')}
                  className="w-full flex items-center justify-between p-3.5 bg-gray-50 hover:bg-gray-100/70 rounded-xl transition-all border border-gray-100"
                >
                  <span className="text-xs font-bold text-gray-800">Post Visibility</span>
                  <div className="flex items-center gap-1 text-xs text-blue-600 font-black">
                    <span>{audienceLabel}</span>
                    <ChevronRight size={14} />
                  </div>
                </button>

                {/* Results Visibility Sub-trigger */}
                <button
                  type="button"
                  onClick={() => setAdvancedSheetView('results')}
                  className="w-full flex items-center justify-between p-3.5 bg-gray-50 hover:bg-gray-100/70 rounded-xl transition-all border border-gray-100"
                >
                  <span className="text-xs font-bold text-gray-800">Result Visibility</span>
                  <div className="flex items-center gap-1 text-xs text-blue-600 font-black">
                    <span>{resultsLabel}</span>
                    <ChevronRight size={14} />
                  </div>
                </button>
              </div>

              {/* Duration section inline inside settings sheet */}
              <div className="space-y-3 pb-4 border-b border-gray-100 pt-1">
                <label className="flex items-center gap-2 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                  <Calendar size={12} /> Poll Duration
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {DURATION_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setDuration(opt.value)}
                      className={`py-2 rounded-xl text-xs font-bold border transition-all ${
                        duration === opt.value
                          ? 'bg-blue-600 text-white border-blue-600 shadow-sm shadow-blue-100'
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
                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm shadow-blue-100'
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
                      className="w-full bg-blue-50/50 border border-blue-100 rounded-xl px-4 py-2.5 text-xs font-bold focus:outline-none focus:bg-white focus:border-blue-500 transition-all text-blue-900"
                    />
                  </div>
                )}
              </div>

              {/* Toggles List */}
              <div className="space-y-4 pt-1">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col text-left">
                    <span className="text-xs font-bold text-gray-800">Allow comments</span>
                    <span className="text-[10px] text-gray-400">Enable user comments on the post</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAllowComments(!allowComments)}
                    className={`w-10 h-5 rounded-full relative transition-colors ${allowComments ? 'bg-blue-600' : 'bg-gray-200'}`}
                  >
                    <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${allowComments ? 'left-6' : 'left-1'}`} />
                  </button>
                </div>

                {pollChoiceType !== 'rating' && (
                  <>
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col text-left">
                        <span className="text-xs font-bold text-gray-800">Multiple selection</span>
                        <span className="text-[10px] text-gray-400">Allow participants to choose more than one option</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setAllowMultipleSelection(!allowMultipleSelection)}
                        className={`w-10 h-5 rounded-full relative transition-colors ${allowMultipleSelection ? 'bg-blue-600' : 'bg-gray-200'}`}
                      >
                        <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${allowMultipleSelection ? 'left-6' : 'left-1'}`} />
                      </button>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex flex-col text-left">
                        <span className="text-xs font-bold text-gray-800">Allow user options</span>
                        <span className="text-[10px] text-gray-400">Allow participants to add new options</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setAllowUserOptions(!allowUserOptions)}
                        className={`w-10 h-5 rounded-full relative transition-colors ${allowUserOptions ? 'bg-blue-600' : 'bg-gray-200'}`}
                      >
                        <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${allowUserOptions ? 'left-6' : 'left-1'}`} />
                      </button>
                    </div>
                  </>
                )}

                <div className="flex items-center justify-between">
                  <div className="flex flex-col text-left">
                    <span className="text-xs font-bold text-gray-800">Force anonymous</span>
                    <span className="text-[10px] text-gray-400">Keep all participants identity completely anonymous</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setForceAnonymous(!forceAnonymous)}
                    className={`w-10 h-5 rounded-full relative transition-colors ${forceAnonymous ? 'bg-blue-600' : 'bg-gray-200'}`}
                  >
                    <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${forceAnonymous ? 'left-6' : 'left-1'}`} />
                  </button>
                </div>
              </div>


            </div>
          )}

          {/* Visibility View Sub-screen */}
          {advancedSheetView === 'visibility' && (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => {
                  if (visibility === 'Groups' && selectedGroups.length === 0) {
                    setErrors(prev => ({ ...prev, visibility: "Please select at least one group." }));
                    return;
                  }
                  setErrors(prev => ({ ...prev, visibility: false }));
                  setAdvancedSheetView('main');
                }}
                className="flex items-center gap-1.5 text-xs text-blue-600 font-bold hover:opacity-80 transition-opacity pb-2"
              >
                <span>&larr; Back to Advanced Settings</span>
              </button>

              <div className="space-y-2">
                {visibilityOptions.map((option) => {
                  const Icon = option.icon;
                  const isSelected = visibility === option.id;
                  return (
                    <button
                      key={option.id}
                      onClick={() => {
                        if (option.allowed) {
                          setVisibility(option.id as VisibilityType);
                          if (option.id !== 'Groups') {
                            setErrors(prev => ({ ...prev, visibility: false }));
                          }
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
                        <div className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center shadow-sm">
                          <Check size={14} strokeWidth={3} />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {visibility === 'Groups' && (
                <div className="mt-4 p-4 bg-gray-50 rounded-2xl animate-in slide-in-from-top-2 border border-gray-100">
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
                            onClick={() => {
                              handleGroupToggle(group.id);
                              setErrors(prev => ({ ...prev, visibility: false }));
                            }}
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
                    </div>
                  ) : (
                    <div className="py-6 text-center">
                      <Users size={32} className="mx-auto text-gray-300 mb-2 opacity-30" />
                      <p className="text-xs text-gray-500 font-medium leading-relaxed px-4">
                        You don't have permission to post in any groups.
                      </p>
                    </div>
                  )}

                  {errors.visibility && selectedGroups.length === 0 && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-[10px] text-red-600 font-bold flex items-center gap-1.5 mt-2 animate-in fade-in">
                      <AlertCircle size={14} className="shrink-0" />
                      <span>{errors.visibility}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Results View Sub-screen */}
          {advancedSheetView === 'results' && (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => setAdvancedSheetView('main')}
                className="flex items-center gap-1.5 text-xs text-blue-600 font-bold hover:opacity-80 transition-opacity pb-2"
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
                    onClick={() => setResultsWho(opt.id as any)}
                    className="w-full flex items-center justify-between p-4 rounded-2xl border transition-all text-left"
                    style={{ borderColor: resultsWho === opt.id ? '#3b82f6' : '#f3f4f6', backgroundColor: resultsWho === opt.id ? '#eff6ff' : 'white' }}
                  >
                    <div>
                      <span className={`text-sm font-bold block ${resultsWho === opt.id ? 'text-blue-700' : 'text-gray-700'}`}>{opt.label}</span>
                      <span className="text-[10px] text-gray-505 leading-tight mt-0.5 block">{opt.desc}</span>
                    </div>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${resultsWho === opt.id ? 'border-blue-600 bg-blue-600' : 'border-gray-200'}`}>
                      {resultsWho === opt.id && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
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
                      onClick={() => setResultsTiming(opt.id as any)}
                      className={`w-full flex items-center justify-between p-4 rounded-2xl border transition-all text-left ${!opt.enabled ? 'opacity-40 cursor-not-allowed bg-gray-50 grayscale' : ''}`}
                      style={{ borderColor: resultsTiming === opt.id ? '#3b82f6' : '#f3f4f6', backgroundColor: resultsTiming === opt.id ? '#eff6ff' : 'white' }}
                    >
                      <span className={`text-sm font-bold ${resultsTiming === opt.id ? 'text-blue-700' : 'text-gray-700'}`}>{opt.label}</span>
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${resultsTiming === opt.id ? 'border-blue-600 bg-blue-600' : 'border-gray-200'}`}>
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

      {/* Category Bottom Sheet */}
      <BottomSheet
        isOpen={isCategorySheetOpen}
        onClose={() => setIsCategorySheetOpen(false)}
        title="Select Category"
      >
        <div className="flex flex-wrap gap-2 py-2 animate-in fade-in duration-200">
          {POLL_CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => {
                setCategory(cat);
                setErrors(prev => ({ ...prev, category: false }));
                setIsCategorySheetOpen(false);
              }}
              className={`px-4 py-2 rounded-full text-xs font-bold border transition-all active:scale-95 ${category === cat
                ? 'bg-blue-600 text-white border-blue-600 shadow-md'
                : 'bg-white text-gray-650 border-gray-200 hover:bg-gray-50'
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
        {selectedOptionForSettings && (
          <div className="space-y-6 py-4 px-2 animate-in fade-in slide-in-from-bottom-2">
            <div className="flex flex-col gap-2">
              <button
                disabled={pollChoiceType === 'rating' || options.indexOf(selectedOptionForSettings) === 0}
                onClick={() => { moveOption(selectedOptionForSettings.id, 'up'); setSettingsOptionId(null); }}
                className={`w-full flex items-center gap-4 p-4 rounded-2xl border transition-all text-left ${(pollChoiceType === 'rating' || options.indexOf(selectedOptionForSettings) === 0) ? 'opacity-30 grayscale cursor-not-allowed' : 'hover:bg-gray-50 active:scale-[0.98]'
                  }`}
              >
                <div className="p-2.5 rounded-xl bg-gray-100 text-gray-500"><ArrowUp size={20} /></div>
                <span className="font-bold text-sm text-gray-900">Move Up</span>
              </button>

              <button
                disabled={pollChoiceType === 'rating' || options.indexOf(selectedOptionForSettings) === options.length - 1}
                onClick={() => { moveOption(selectedOptionForSettings.id, 'down'); setSettingsOptionId(null); }}
                className={`w-full flex items-center gap-4 p-4 rounded-2xl border transition-all text-left ${(pollChoiceType === 'rating' || options.indexOf(selectedOptionForSettings) === options.length - 1) ? 'opacity-30 grayscale cursor-not-allowed' : 'hover:bg-gray-50 active:scale-[0.98]'
                  }`}
              >
                <div className="p-2.5 rounded-xl bg-gray-100 text-gray-500"><ArrowDown size={20} /></div>
                <span className="font-bold text-sm text-gray-900">Move Down</span>
              </button>

              {pollChoiceType === 'multiple' && (
                <button
                  disabled={options.length <= 2}
                  onClick={() => { handleRemoveOption(selectedOptionForSettings.id); setSettingsOptionId(null); }}
                  className={`w-full flex items-center gap-4 p-4 rounded-2xl border transition-all text-left ${options.length <= 2 ? 'opacity-30 grayscale cursor-not-allowed border-gray-100' : 'hover:bg-red-50 hover:border-red-200 hover:text-red-600 border-gray-100 text-red-600 active:scale-[0.98]'
                    }`}
                >
                  <div className={`p-2.5 rounded-xl ${options.length <= 2 ? 'bg-gray-100 text-gray-400' : 'bg-red-50 text-red-500'}`}><Trash2 size={20} /></div>
                  <span className="font-bold text-sm">Delete Option</span>
                </button>
              )}
            </div>

            <div className="h-px bg-gray-100 my-2" />

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-sm font-bold text-gray-800">Clarification Question</span>
                  <span className="text-[10px] text-gray-400 font-medium">Ask for additional details if this is chosen</span>
                </div>
                <button
                  onClick={() => updateFollowUp(selectedOptionForSettings.id, { withFollowUp: !selectedOptionForSettings.withFollowUp })}
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
                    onChange={(e) => updateFollowUp(selectedOptionForSettings.id, { followUpLabel: e.target.value })}
                    placeholder="e.g. Please explain your choice..."
                    className="w-full bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-sm focus:outline-none focus:bg-white focus:border-blue-500 transition-all font-bold"
                    autoFocus
                  />
                </div>
              )}
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

      {croppingImage && <ImageCropper imageSrc={croppingImage} onCrop={handleCropComplete} onCancel={() => { setCroppingImage(null); setActiveCropId(null); }} />}

      {showExitConfirm && (
        <div className="fixed inset-0 z-[110] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl p-6 w-full max-w-xs shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="w-12 h-12 bg-orange-100 text-orange-600 rounded-2xl flex items-center justify-center mb-4"><AlertCircle size={24} /></div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">Discard changes?</h3>
            <p className="text-sm text-gray-500 mb-6 leading-relaxed">You have unsaved work. If you exit now, your changes will be lost.</p>
            <div className="flex flex-col gap-2">
              <button onClick={handleDiscard} className="w-full py-3 bg-red-600 text-white rounded-xl font-bold text-sm hover:bg-red-700 transition-colors">Discard and Exit</button>
              <button onClick={handleSaveDraft} className="w-full py-3 bg-blue-50 text-blue-600 rounded-xl font-bold text-sm hover:bg-blue-100 transition-colors">Save as Draft</button>
              <button onClick={() => setShowExitConfirm(false)} className="w-full py-3 bg-gray-100 text-gray-700 rounded-xl font-bold text-sm hover:bg-gray-200 transition-colors">Keep Editing</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
