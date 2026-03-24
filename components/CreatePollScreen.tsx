
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { X, Image as ImageIcon, Plus, Trash2, Globe, Users, AlertCircle, Clock, Calendar, ChevronDown, List, GalleryHorizontalEnd, Info, Lock, Camera, Save, BarChart3, Check, ChevronRight, UserCircle, Target, Link2, LayoutGrid, Settings2, Star, MoreHorizontal, ArrowUp, ArrowDown, MessageSquare } from 'lucide-react';
import { Survey, SurveyType, UserProfile, Option, Group, DraftOption } from '../types';
import { ImageCropper } from './ImageCropper';
import { BottomSheet } from './BottomSheet';
import { RichMentionInput } from './RichMentionInput';
import { api } from '../services/api';

interface CreatePollScreenProps {
  onClose: () => void;
  onSubmit: (surveyData: Partial<Survey>) => void;
  onSaveDraft?: (surveyData: Partial<Survey>) => void;
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

type VisibilityType = 'Public' | 'Followers' | 'Groups' | 'Custom Audience' | 'Custom Domain';

export const CreatePollScreen: React.FC<CreatePollScreenProps> = ({ onClose, onSubmit, onSaveDraft, userProfile, draft, userGroups = [], initialGroupId }) => {
  const [step, setStep] = useState<1 | 2>((draft?.currentStep as 1 | 2) || 1);
  const [visibility, setVisibility] = useState<VisibilityType>(initialGroupId ? 'Groups' : 'Public');
  const [selectedGroups, setSelectedGroups] = useState<string[]>(initialGroupId ? [initialGroupId] : []);
  const [isVisibilitySheetOpen, setIsVisibilitySheetOpen] = useState(false);
  const [isResultVisibilitySheetOpen, setIsResultVisibilitySheetOpen] = useState(false);
  const [isCategorySheetOpen, setIsCategorySheetOpen] = useState(false);
  const [isAdvancedSheetOpen, setIsAdvancedSheetOpen] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  const handleExit = () => {
    // Check if there are any changes to prompt for save
    if (title.trim() || options.some(o => o.text.trim()) || coverImage) {
      setShowExitConfirm(true);
    } else {
      onClose();
    }
  };

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

  const handleSaveDraft = async () => {
    if (!userProfile || !userProfile.id) {
      alert('Please log in to save a draft');
      return;
    }

    if (onSaveDraft) {
      const finalCategory = category === 'Other' ? otherCategoryText.trim() : category;
      const draftData: Partial<Survey> = {
        id: draft?.id,
        title,
        description,
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
        currentStep: step
      };

      try {
        let savedDraft;
        if (draftData.id) {
          savedDraft = await api.updatePost(draftData.id, draftData);
        } else {
          savedDraft = await api.createSurvey(draftData);
        }

        // Hydrate UI state with server ID mappings
        if (savedDraft) {
          if (savedDraft.options) {
            setOptions(savedDraft.options.map((o: any) => ({
              id: o.id,
              text: o.text,
              image: o.image || undefined,
              isRating: o.isRating,
              ratingValue: o.ratingValue,
              withFollowUp: o.withFollowUp || false,
              followUpLabel: o.followUpLabel || ''
            })));
          }
          if (savedDraft.coverImage) setCoverImage(savedDraft.coverImage);
        }

        onSaveDraft(savedDraft || draftData);
      } catch (error) {
        console.error('Failed to save draft:', error);
        alert('Failed to save draft. Please try again.');
        return; // do not close on error
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
  const [description, setDescription] = useState('');
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

  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (draft) {
      setTitle(draft.title || '');
      setDescription(draft.description || '');
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
    { id: 'Public', label: 'Public', desc: 'Visible to all users on the platform.', icon: Globe, allowed: true },
    { id: 'Followers', label: 'Followers', desc: 'Visible only to users who follow you.', icon: UserCircle, allowed: true },
    { id: 'Groups', label: 'Selected groups', desc: 'Visible only within selected groups.', icon: Users, allowed: true },
    { id: 'Custom Audience', label: 'Custom audience', desc: 'Specific targeted audience.', icon: Target, allowed: isVerified, premium: true },
    { id: 'Custom Domain', label: 'Custom domain', desc: 'Private branded link.', icon: Link2, allowed: isOrganization, premium: true },
  ];

  const handleAddOption = () => {
    setOptions(prev => [...prev, { id: Date.now().toString(), text: '', image: undefined, withFollowUp: false, followUpLabel: '' }]);
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
      const reader = new FileReader();
      reader.onloadend = () => {
        setCroppingImage(reader.result as string);
      };
      reader.readAsDataURL(file);
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
    if (!title.trim()) newErrors.title = "Question text is required";

    if (pollChoiceType === 'multiple') {
      if (options.filter(o => o.text.trim() !== '').length < 2) newErrors.options = "At least 2 options are required";
    }

    if (!category) newErrors.category = "Please select a category";
    if (visibility === 'Groups' && selectedGroups.length === 0) newErrors.visibility = "Select at least one group.";
    if (category === 'Other' && !otherCategoryText.trim()) {
      newErrors.otherCategoryText = true;
      isValid = false;
    }

    if (visibility === 'Groups' && selectedGroups.length === 0) {
      newErrors.visibility = 'Please select at least one group.';
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
    if (!validate()) return;

    if (!userProfile || !userProfile.id) {
      alert('Please log in to create a post');
      return;
    }

    try {
      const finalCategory = category === 'Other' ? otherCategoryText.trim() : category;
      onSubmit({
        title,
        description,
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
    <div className="absolute inset-0 z-[60] bg-white flex flex-col animate-in slide-in-from-bottom duration-300">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-white/95 backdrop-blur-md sticky top-0 z-40 safe-top shrink-0">
        <button onClick={handleExit} className="p-2 -ml-2 hover:bg-gray-50 rounded-full text-gray-500"><X size={24} /></button>
        <div className="flex flex-col items-center flex-1 mx-2">
          <h1 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Poll Creation</h1>
          <div className="flex gap-1">
            {[1, 2].map(s => <div key={s} className={`h-1 w-8 rounded-full transition-all duration-300 ${step >= s ? 'bg-blue-600' : 'bg-gray-100'}`} />)}
          </div>
        </div>
        {step === 1 ? (
          <button onClick={() => validate() && setStep(2)} className="text-blue-600 font-black text-[10px] px-5 py-2 rounded-full bg-blue-50 hover:bg-blue-100 transition-all uppercase tracking-widest">Next</button>
        ) : (
          <button onClick={handleSubmit} className="text-white font-black text-[10px] px-5 py-2 rounded-full bg-blue-600 hover:bg-blue-700 transition-all uppercase tracking-widest shadow-lg shadow-blue-200">Post</button>
        )}
      </div>

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto no-scrollbar bg-white">
        <div className="max-w-md mx-auto p-5 pb-32">
          {step === 1 ? (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              {/* 1. Top Settings Row */}
              <section className="grid grid-cols-3 gap-2.5 pb-4 border-b border-gray-50">
                <div className={errors.visibility ? 'p-0.5 rounded-xl bg-red-50 ring-1 ring-red-100' : ''}>
                  <label className="block text-[10px] font-black text-gray-400 tracking-tight mb-1.5 truncate">
                    <Globe size={10} className="inline mr-1" /> Post visibility
                  </label>
                  <button
                    onClick={() => setIsVisibilitySheetOpen(true)}
                    className="w-full flex items-center justify-between bg-gray-50 border border-gray-200 text-gray-900 rounded-xl px-2 py-2.5 transition-colors text-left"
                  >
                    <span className="truncate text-[10px] font-bold">{visibility === 'Groups' && selectedGroups.length > 0 ? `${selectedGroups.length} Groups` : visibility}</span>
                    <ChevronDown className="text-gray-400 shrink-0" size={12} />
                  </button>
                </div>

                <div>
                  <label className="block text-[10px] font-black text-gray-400 tracking-tight mb-1.5 truncate">
                    <Lock size={10} className="inline mr-1" /> Result Visibility
                  </label>
                  <button
                    onClick={() => setIsResultVisibilitySheetOpen(true)}
                    className="w-full flex items-center justify-between bg-gray-50 border border-gray-200 text-gray-900 rounded-xl px-2 py-2.5 transition-colors text-left"
                  >
                    <span className="truncate text-[10px] font-bold">{resultsWho === 'OnlyMe' ? 'Only Me' : resultsWho}</span>
                    <ChevronDown className="text-gray-400 shrink-0" size={12} />
                  </button>
                </div>

                <div>
                  <label className="block text-[10px] font-black text-gray-400 tracking-tight mb-1.5 truncate">
                    <Settings2 size={10} className="inline mr-1" /> Advance Setting
                  </label>
                  <button
                    onClick={() => setIsAdvancedSheetOpen(true)}
                    className="w-full flex items-center justify-between bg-blue-50 border border-blue-100 text-blue-600 px-2 py-2.5 rounded-xl transition-all hover:bg-blue-100 active:scale-[0.98]"
                  >
                    <span className="text-[10px] font-black truncate">Settings</span>
                    <ChevronRight size={12} className="opacity-40 shrink-0" />
                  </button>
                </div>
              </section>

              {/* Main Content */}
              <section className="space-y-4 pb-4 border-b border-gray-50">
                <div className="space-y-1">
                  <div className="flex items-center justify-between px-1">
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest">Your Question <span className="text-red-500">*</span></label>
                    <button
                      onClick={() => { setActiveCropId('cover'); fileInputRef.current?.click(); }}
                      className={`p-1.5 rounded-full transition-colors ${coverImage ? 'text-blue-600 bg-blue-50' : 'text-gray-400 hover:text-blue-500 hover:bg-gray-50'}`}
                    >
                      <Camera size={20} />
                    </button>
                  </div>
                  <RichMentionInput
                    value={title}
                    onChange={(val) => { setTitle(val); if (errors.title) setErrors({ ...errors, title: false }) }}
                    placeholder="What's the question?"
                    className={`text-xl font-bold bg-transparent border-b border-gray-100 focus:outline-none focus:border-blue-500 transition-all p-0 pb-2 placeholder-gray-300 min-h-[60px] ${errors.title ? 'border-red-300' : ''}`}
                    autoFocus
                  />
                  {errors.title && <p className="text-[10px] font-bold text-red-500 px-1">{errors.title}</p>}
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">Description (Optional)</label>
                  <RichMentionInput
                     value={description}
                     onChange={(val) => setDescription(val)}
                     placeholder="Provide more context..."
                     className="text-sm text-gray-600 bg-transparent border-b border-gray-100 focus:outline-none focus:border-blue-500 transition-all p-0 pb-2 placeholder-gray-300 min-h-[40px]"
                  />
                </div>

                {/* Cover Media Preview below description */}
                {coverImage && (
                  <div className="pt-2 animate-in zoom-in-95 duration-200">
                    <div className="relative w-full rounded-2xl overflow-hidden group">
                      <img src={coverImage} className="w-full h-auto block" alt="Cover" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                        <button onClick={() => { setActiveCropId('cover'); fileInputRef.current?.click(); }} className="p-2.5 bg-white text-gray-900 rounded-full hover:bg-gray-100 transition-colors">
                          <Camera size={20} />
                        </button>
                        <button onClick={() => setCoverImage(null)} className="p-2.5 bg-red-600 text-white rounded-full hover:bg-red-700 transition-colors">
                          <Trash2 size={20} />
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Category Selection between Description and Choice Type */}
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
                    {category || 'Select Poll Category'}
                  </button>
                  {errors.category && <p className="text-[10px] font-bold text-red-500 px-1">Please select a category.</p>}
                </div>

                {/* Choice Type Selector */}
                <div className="space-y-3 pt-2">
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">Choice Type</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleChoiceTypeChange('multiple')}
                      className={`flex-1 py-2.5 rounded-xl text-xs font-bold border transition-all ${pollChoiceType === 'multiple' ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-200' : 'bg-gray-50 text-gray-500 border-gray-100 hover:bg-gray-100'}`}
                    >
                      Multiple Choice
                    </button>
                    <button
                      onClick={() => handleChoiceTypeChange('rating')}
                      className={`flex-1 py-2.5 rounded-xl text-xs font-bold border transition-all ${pollChoiceType === 'rating' ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-200' : 'bg-gray-50 text-gray-500 border-gray-100 hover:bg-gray-100'}`}
                    >
                      Rating Scale
                    </button>
                  </div>
                </div>

                {/* Layout and Choices Section */}
                <div className="space-y-4 pt-4">
                  {pollChoiceType === 'multiple' && (
                    <div className="space-y-2 px-1">
                      <div className="flex items-center justify-between">
                        <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest">Options layout</label>
                        <div className="flex gap-1.5">
                          {[
                            { id: 'vertical', icon: List },
                            { id: 'horizontal', icon: GalleryHorizontalEnd }
                          ].map((layout) => (
                            <button
                              key={layout.id}
                              onClick={() => setImageLayout(layout.id as any)}
                              className={`p-1.5 rounded-lg border transition-all ${imageLayout === layout.id
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
                      <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wide italic">This setting applies only if images are added to options.</p>
                    </div>
                  )}

                  <div className="flex items-center justify-between px-1">
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest">Choices <span className="text-red-500">*</span></label>
                    {errors.options && <span className="text-[10px] font-bold text-red-500">{errors.options}</span>}
                  </div>
                  {options.map((option, idx) => (
                    <div key={option.id} className="flex items-center gap-3 animate-in fade-in slide-in-from-bottom-1 duration-200">
                      <span className="text-xs font-black text-gray-300 w-4">{idx + 1}</span>
                      <div className="flex-1 flex flex-col gap-2">
                        <div className="flex items-center bg-gray-50 rounded-xl px-1 py-1 border border-transparent focus-within:border-blue-200 focus-within:bg-white transition-all shadow-sm">
                          {pollChoiceType === 'multiple' && (
                            <button
                              onClick={() => {
                                setActiveCropId(option.id);
                                fileInputRef.current?.click();
                              }}
                              className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 overflow-hidden border border-dashed transition-all ${option.image ? 'border-blue-500' : 'border-gray-200 text-gray-400 hover:text-blue-500'
                                }`}
                            >
                              {option.image ? (
                                <img src={option.image} className="w-full h-full object-cover" alt="" />
                              ) : (
                                <Camera size={16} />
                              )}
                            </button>
                          )}

                          {pollChoiceType === 'rating' ? (
                            <div className="flex-1 px-3 py-2 flex items-center gap-2">
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
                              onChange={(e) => handleOptionChange(option.id, e.target.value)}
                              placeholder={`Option ${idx + 1}`}
                              className="flex-1 px-3 py-2 bg-transparent text-sm font-semibold focus:outline-none text-gray-900"
                            />
                          )}

                          <div className="flex items-center gap-1 shrink-0 px-1">
                            {pollChoiceType === 'multiple' && option.image && (
                              <button
                                onClick={() => setOptions(options.map(o => o.id === option.id ? { ...o, image: null } : o))}
                                className="p-1.5 text-gray-300 hover:text-red-500 transition-colors"
                              >
                                <X size={14} strokeWidth={3} />
                              </button>
                            )}
                            <button
                              onClick={() => setSettingsOptionId(option.id)}
                              className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors"
                            >
                              <MoreHorizontal size={18} />
                            </button>
                          </div>
                        </div>

                        {option.withFollowUp && (
                          <div className="px-2 py-1.5 bg-blue-50 border border-blue-100 rounded-lg text-[10px] flex items-center gap-2">
                            <MessageSquare size={10} className="text-blue-500" />
                            <span className="font-bold text-blue-700 truncate">Follow-up: {option.followUpLabel || "Please explain..."}</span>
                          </div>
                        )}
                      </div>

                      {pollChoiceType === 'multiple' && options.length > 2 && (
                        <button onClick={() => handleRemoveOption(option.id)} className="text-gray-300 hover:text-red-500 p-1 shrink-0">
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  ))}
                  {pollChoiceType === 'multiple' && (
                    <button onClick={handleAddOption} className="w-full py-3 border-2 border-dashed border-gray-100 rounded-xl text-gray-400 font-bold text-sm hover:border-blue-300 hover:text-blue-600 transition-all active:scale-[0.99]">
                      <Plus size={18} className="inline mr-1" /> Add Option
                    </button>
                  )}
                </div>
              </section>

              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept="image/*"
                onChange={handleImageUpload}
              />
            </div>
          ) : (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="bg-blue-50 rounded-[2.5rem] p-6 border border-blue-100 shadow-sm"><div className="flex items-center gap-3 mb-4"><div className="w-10 h-10 bg-blue-600 text-white rounded-2xl flex items-center justify-center shadow-md"><BarChart3 size={20} /></div><div><h2 className="text-xl font-black text-gray-900 leading-tight">Analytics Setup</h2><p className="text-[10px] font-black text-blue-600 uppercase tracking-widest mt-0.5">Demographics Filter</p></div></div><p className="text-sm text-gray-600 leading-relaxed bg-white/50 p-4 rounded-2xl border border-blue-100/50">Request demographic info to enhance analytics.</p></div>
              <div className="space-y-3"><label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] px-1">Attributes</label><div className="flex flex-wrap gap-2">{DEMOGRAPHIC_OPTIONS.map((opt) => { const isSelected = selectedDemographics.includes(opt.id); return <button key={opt.id} onClick={() => handleDemographicToggle(opt.id)} className={`px-4 py-3 rounded-2xl border text-left transition-all max-w-[calc(50%-4px)] flex-1 min-w-[160px] ${isSelected ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-200' : 'bg-white text-gray-600 border-gray-100 hover:border-gray-200'}`}><div className="flex items-center justify-between mb-1"><span className={`text-[12px] font-bold ${isSelected ? 'text-white' : 'text-gray-900'}`}>{opt.label}</span>{isSelected && <Check size={12} strokeWidth={4} />}</div><p className={`text-[9px] leading-tight font-medium ${isSelected ? 'text-blue-50' : 'text-gray-400'}`}>{opt.desc}</p></button> })}</div></div>
              <button onClick={handleSubmit} className="w-full py-5 bg-blue-600 text-white rounded-[2rem] font-black uppercase tracking-[0.2em] text-xs shadow-xl shadow-blue-500/20 active:scale-95 transition-all">Confirm & Publish</button>
            </div>
          )}
        </div>
      </div>

      {/* Visibility Bottom Sheet */}
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
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </BottomSheet>

      <BottomSheet
        isOpen={isAdvancedSheetOpen}
        onClose={() => setIsAdvancedSheetOpen(false)}
        title="Advanced Settings"
      >
        <div className="space-y-6 py-2 px-2">
          {/* Poll Duration Section */}
          <div className="space-y-3 pb-4 border-b border-gray-50">
            <label className="flex items-center gap-2 text-[10px] font-black text-gray-400 uppercase tracking-widest">
              <Calendar size={12} /> Poll Duration
            </label>
            <div className="flex flex-wrap gap-2">
              {DURATION_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDuration(opt.value)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all ${duration === opt.value ? 'bg-gray-900 text-white border-gray-900 shadow-md' : 'bg-gray-50 text-gray-400 border-transparent hover:bg-gray-100'
                    }`}
                >
                  {opt.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setDuration('custom')}
                className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all flex items-center gap-1 ${duration === 'custom' ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-gray-50 text-gray-400 border-transparent hover:bg-gray-100'
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
                  className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 shadow-sm"
                />
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-sm font-bold text-gray-800">Allow multiple selections</span>
              <span className="text-[10px] text-gray-400">Voters can pick more than one choice</span>
            </div>
            <button
              disabled={pollChoiceType === 'rating'}
              onClick={() => setAllowMultipleSelection(!allowMultipleSelection)}
              className={`w-10 h-5 rounded-full relative transition-colors ${allowMultipleSelection ? 'bg-blue-600' : 'bg-gray-200'} ${pollChoiceType === 'rating' ? 'opacity-30' : ''}`}
            >
              <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${allowMultipleSelection ? 'left-6' : 'left-1'}`} />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-sm font-bold text-gray-800">Voter-added options</span>
              <span className="text-[10px] text-gray-400">Allow users to suggest their own answers</span>
            </div>
            <button
              disabled={pollChoiceType === 'rating'}
              onClick={() => setAllowUserOptions(!allowUserOptions)}
              className={`w-10 h-5 rounded-full relative transition-colors ${allowUserOptions ? 'bg-blue-600' : 'bg-gray-200'} ${pollChoiceType === 'rating' ? 'opacity-30' : ''}`}
            >
              <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${allowUserOptions ? 'left-6' : 'left-1'}`} />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-sm font-bold text-gray-800">Allow comments</span>
              <span className="text-[10px] text-gray-400">Enable users to leave comments</span>
            </div>
            <button
              onClick={() => setAllowComments(!allowComments)}
              className={`w-10 h-5 rounded-full relative transition-colors ${allowComments ? 'bg-blue-600' : 'bg-gray-200'}`}
            >
              <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${allowComments ? 'left-6' : 'left-1'}`} />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-sm font-bold text-gray-800">Anonymous voting</span>
              <span className="text-[10px] text-gray-400">Participants can hide their identity</span>
            </div>
            <button
              onClick={() => setForceAnonymous(!forceAnonymous)}
              className={`w-10 h-5 rounded-full relative transition-colors ${forceAnonymous ? 'bg-blue-600' : 'bg-gray-200'}`}
            >
              <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${forceAnonymous ? 'left-6' : 'left-1'}`} />
            </button>
          </div>

          <div className="pt-4">
            <button
              onClick={() => setIsAdvancedSheetOpen(false)}
              className="w-full bg-gray-900 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-lg shadow-gray-200 active:scale-95 transition-all"
            >
              Done
            </button>
          </div>
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
