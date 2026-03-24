
import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  X, Image as ImageIcon, Plus, Trash2, Globe, Users,
  AlertCircle, Clock, Calendar, ChevronDown, List, Info,
  Lock, Camera, Save, BarChart3, Check, ChevronRight,
  UserCircle, Target, Link2, Shuffle, Zap, MoreHorizontal,
  ArrowUp, ArrowDown, MessageSquare
} from 'lucide-react';
import { Survey, SurveyType, UserProfile, Option, Group } from '../types';
import { ImageCropper } from './ImageCropper';
import { BottomSheet } from './BottomSheet';
import { RichMentionInput } from './RichMentionInput';
import { api } from '../services/api';

interface CreateChallengeScreenProps {
  onClose: () => void;
  onSubmit: (surveyData: Partial<Survey>) => void;
  onSaveDraft?: (surveyData: Partial<Survey>) => void;
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
  { id: 'marital_status', label: 'Marital Status', desc: 'Identify trends based on marital status' },
  { id: 'age_group', label: 'Age Group', desc: 'Compare responses across age groups' },
  { id: 'nationality', label: 'Nationality', desc: 'Analyze by responses by Nationality' },
  { id: 'employment', label: 'Employment Type', desc: 'Analyze responses by employment type' },
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

export const CreateChallengeScreen: React.FC<CreateChallengeScreenProps> = ({ onClose, onSubmit, onSaveDraft, userProfile, draft, userGroups = [], initialGroupId }) => {
  const [step, setStep] = useState<1 | 2 | 3>((draft?.currentStep as 1 | 2 | 3) || 1);
  const [visibility, setVisibility] = useState<VisibilityType>(initialGroupId ? 'Groups' : 'Public');
  const [isVisibilitySheetOpen, setIsVisibilitySheetOpen] = useState(false);
  const [isResultVisibilitySheetOpen, setIsResultVisibilitySheetOpen] = useState(false);
  const [isCategorySheetOpen, setIsCategorySheetOpen] = useState(false);

  // Detailed Visibility
  const [resultsWho, setResultsWho] = useState<'Public' | 'Followers' | 'Participants' | 'OnlyMe'>('Public');
  const [resultsTiming, setResultsTiming] = useState<'AnyTime' | 'Immediately' | 'AfterEnd'>('AnyTime');

  const [category, setCategory] = useState<string>('');
  const [coverImage, setCoverImage] = useState<string | null>(null);
  const [croppingImage, setCroppingImage] = useState<string | null>(null);
  const [activeCropId, setActiveCropId] = useState<string | null>(null);
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  const handleExit = () => {
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

  const handleSaveDraft = () => {
    if (onSaveDraft) {
      const draftData: Partial<Survey> = {
        id: draft?.id,
        title,
        description,
        type: SurveyType.CHALLENGE,
        author: { id: userProfile.id || "", name: userProfile.name, avatar: userProfile.avatar },
        options: options.map(o => ({
          id: o.id,
          text: o.text,
          votes: 0,
          image: o.image || undefined,
          withFollowUp: o.withFollowUp,
          followUpLabel: o.followUpLabel
        })),
        coverImage: coverImage || undefined,
        targetAudience: visibility as any,
        targetGroups: visibility === 'Groups' ? selectedGroups : undefined,
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
        currentStep: step
      };
      onSaveDraft(draftData);
    }
    onClose();
  };

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [options, setOptions] = useState<{ id: string; text: string; image: string | null; withFollowUp?: boolean; followUpLabel?: string }[]>([
    { id: '1', text: '', image: null },
    { id: '2', text: '', image: null }
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

  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

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
      setRandomPairing(draft.randomPairing !== undefined ? draft.randomPairing : true);
      if (draft.options) setOptions(draft.options.map(o => ({ id: o.id, text: o.text, image: o.image || null, withFollowUp: o.withFollowUp, followUpLabel: o.followUpLabel })));
      if (draft.demographics) setSelectedDemographics(draft.demographics);
      if (draft.targetGroups) setSelectedGroups(draft.targetGroups);
    }
  }, [draft]);

  const canShowResultsAfterEnd = duration !== 'none';
  useEffect(() => { if (duration === 'none' && resultsTiming === 'AfterEnd') setResultsTiming('Immediately'); }, [duration]);

  const isVerified = (userProfile?.stats?.followers || 0) > 1000;

  const postableGroups = useMemo(() => {
    return userGroups.filter(group => {
      const isAdminOrOwner = group.role === 'Owner' || group.role === 'Admin';
      return isAdminOrOwner || group.postingPermissions === 'AllMembers' || group.postingPermissions === 'ApprovalNeeded';
    });
  }, [userGroups]);

  const visibilityOptions = [
    { id: 'Public', label: 'Public', desc: 'Visible to all users on the platform.', icon: Globe, allowed: true },
    { id: 'Followers', label: 'Followers', desc: 'Visible only to users who follow you.', icon: UserCircle, allowed: true },
    { id: 'Groups', label: 'Selected groups', desc: 'Visible only within selected groups.', icon: Users, allowed: true },
    { id: 'Custom Audience', label: 'Custom audience', desc: 'Specific targeted audience.', icon: Target, allowed: isVerified, premium: true },
    { id: 'Custom Domain', label: 'Custom domain', desc: 'Private branded link.', icon: Link2, allowed: false, premium: true },
  ];

  const handleAddOption = () => {
    setOptions([...options, { id: Date.now().toString(), text: '', image: null }]);
  };

  const handleRemoveOption = (id: string) => {
    if (options.length > 2) setOptions(options.filter(o => o.id !== id));
  };

  const handleOptionChange = (id: string, text: string) => {
    setOptions(options.map(o => id === o.id ? { ...o, text } : o));
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setCroppingImage(reader.result as string);
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

  const validateStep1 = () => {
    const newErrors: { [key: string]: boolean | string } = {};
    if (!title.trim()) newErrors.title = true;
    if (!category) newErrors.category = true;
    if (visibility === 'Groups' && selectedGroups.length === 0) newErrors.visibility = "Please select at least one group.";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateStep2 = () => {
    const filledOptions = options.filter(o => o.text.trim() !== '');
    if (filledOptions.length < 2) {
      setErrors(prev => ({ ...prev, options: "You need at least 2 items to compare." }));
      return false;
    }
    return true;
  };

  const getExpiresAt = () => {
    const now = new Date();
    if (duration === 'custom' && customEndDate) return new Date(customEndDate).toISOString();
    if (duration === 'none') return new Date(now.getFullYear() + 10, now.getMonth(), now.getDate()).toISOString();
    const map: Record<string, number> = { '1h': 60, '24h': 1440, '3d': 4320, '1w': 10080, '1m': 43200 };
    const mins = map[duration] || 10080;
    return new Date(now.getTime() + mins * 60000).toISOString();
  };

  const handleFinalPost = () => {
    if (!validateStep1() || !validateStep2()) return;
    onSubmit({
      title,
      description,
      type: SurveyType.CHALLENGE,
      author: { id: userProfile.id || "", name: userProfile.name, avatar: userProfile.avatar },
      options: options.map(o => ({
        id: o.id,
        text: o.text,
        votes: 0,
        image: o.image || undefined,
        withFollowUp: o.withFollowUp,
        followUpLabel: o.followUpLabel
      })),
      coverImage: coverImage || undefined,
      targetAudience: visibility as any,
      targetGroups: visibility === 'Groups' ? selectedGroups : undefined,
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

    // Close the creation screen and return to home
    onClose();
  };

  const selectedOptionForSettings = options.find(o => o.id === settingsOptionId);

  return (
    <div className="absolute inset-0 z-[60] bg-white flex flex-col animate-in slide-in-from-bottom duration-300">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-white/95 backdrop-blur-md sticky top-0 z-40 safe-top shrink-0">
        <button onClick={handleExit} className="p-2 -ml-2 hover:bg-gray-50 rounded-full text-gray-500"><X size={24} /></button>
        <div className="flex flex-col items-center flex-1 mx-2">
          <h1 className="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-0.5 flex items-center gap-1"><Zap size={10} fill="currentColor" /> Challenge Creation</h1>
          <div className="flex gap-1">
            {[1, 2, 3].map(s => <div key={s} className={`h-1 w-8 rounded-full transition-all duration-300 ${step >= s ? 'bg-amber-500' : 'bg-gray-100'}`} />)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {step < 3 ? (
            <button onClick={() => step === 1 ? validateStep1() && setStep(2) : validateStep2() && setStep(3)} className="text-amber-600 font-black text-[10px] px-5 py-2 rounded-full bg-amber-50 hover:bg-amber-100 transition-all uppercase tracking-widest">Next</button>
          ) : (
            <button onClick={handleFinalPost} className="text-white font-black text-[10px] px-5 py-2 rounded-full bg-amber-600 hover:bg-amber-700 transition-all uppercase tracking-widest shadow-lg shadow-amber-200">Start</button>
          )}
        </div>
      </div>

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto no-scrollbar bg-white">
        <div className="max-w-md mx-auto p-5 pb-32">
          {step === 1 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <section className="grid grid-cols-2 gap-4 pb-4 border-b border-gray-50">
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 flex items-center gap-1"><Globe size={10} /> Visibility</label>
                  <button onClick={() => setIsVisibilitySheetOpen(true)} className="w-full flex items-center justify-between bg-gray-50 text-gray-900 text-[11px] font-bold rounded-xl px-3 py-2.5 transition-colors text-left border border-gray-100">
                    <span className="truncate">{visibility === 'Groups' && selectedGroups.length > 0 ? `${selectedGroups.length} Groups` : visibility}</span>
                    <ChevronDown className="text-amber-500 shrink-0" size={14} />
                  </button>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 flex items-center gap-1"><Lock size={10} /> Results</label>
                  <button onClick={() => setIsResultVisibilitySheetOpen(true)} className="w-full flex items-center justify-between bg-gray-50 text-gray-900 text-[11px] font-bold rounded-xl px-3 py-2.5 transition-colors text-left border border-gray-100">
                    <span className="truncate">{resultsWho === 'OnlyMe' ? 'Only Me' : resultsWho}</span>
                    <ChevronDown className="text-amber-500 shrink-0" size={14} />
                  </button>
                </div>
              </section>

              <section className={`space-y-3 pb-4 border-b border-gray-50 relative transition-colors ${errors.title ? 'p-3 rounded-2xl bg-red-50' : ''}`}>
                <div className="flex items-center justify-between"><label className="block text-xs font-bold text-gray-400 uppercase tracking-wide">The Challenge <span className="text-red-500">*</span></label><button onClick={() => { setActiveCropId('cover'); fileInputRef.current?.click(); }} className={`p-1.5 rounded-full transition-colors ${coverImage ? 'text-amber-600 bg-amber-50' : 'text-gray-400 hover:text-amber-500 hover:bg-gray-50'}`}><ImageIcon size={20} /></button></div>
                {coverImage && <div className="mb-2"><div className="relative w-full aspect-video rounded-2xl overflow-hidden shadow-sm group animate-in zoom-in-95"><img src={coverImage} className="w-full h-full object-cover" alt="Cover" /><button onClick={() => setCoverImage(null)} className="absolute top-2 right-2 p-1.5 bg-black/50 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"><X size={14} /></button></div></div>}
                <RichMentionInput
                  value={title}
                  onChange={(val) => { setTitle(val); setErrors(prev => ({ ...prev, title: false })); }}
                  placeholder="e.g. Which logo looks better?"
                  className={`text-xl font-bold bg-transparent border-b border-gray-100 focus:outline-none focus:border-amber-500 transition-all p-0 pb-2 placeholder-gray-300 min-h-[60px] ${errors.title ? 'text-red-500 border-red-300' : 'text-gray-900'}`}
                  autoFocus
                />
                <RichMentionInput
                  value={description}
                  onChange={(val) => setDescription(val)}
                  placeholder="Describe the challenge rules or context..."
                  className="mt-2 text-sm text-gray-600 bg-transparent border-b border-gray-100 focus:outline-none focus:border-amber-500 transition-all p-0 pb-2 placeholder-gray-300 min-h-[40px]"
                />
              </section>

              <div className="space-y-3 pt-2">
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">Category <span className="text-red-500">*</span></label>
                <button onClick={() => setIsCategorySheetOpen(true)} className={`inline-flex px-4 py-2 rounded-full text-xs font-bold border transition-all active:scale-95 ${category ? 'bg-amber-50 border-amber-200 text-amber-600' : 'bg-white border-gray-200 text-gray-400 hover:bg-gray-50'}`}>
                  {category || 'Select Challenge Category'}
                </button>
              </div>

              <section className="p-2 space-y-3">
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-1"><Clock size={12} /> Duration</label>
                <div className="flex flex-wrap gap-2">
                  {DURATION_OPTIONS.map(opt => (
                    <button key={opt.value} onClick={() => setDuration(opt.value)} className={`px-4 py-1.5 rounded-full text-xs font-bold border transition-all ${duration === opt.value ? 'bg-gray-900 text-white border-gray-900 shadow-md' : 'bg-white text-gray-500 border-gray-100 hover:border-gray-300'}`}>
                      {opt.label}
                    </button>
                  ))}
                  <button onClick={() => setDuration('custom')} className={`px-4 py-1.5 rounded-full text-xs font-bold border transition-all flex items-center gap-1 ${duration === 'custom' ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-gray-500 border-gray-100'}`}>
                    <Calendar size={12} /> Custom
                  </button>
                </div>
              </section>

              <section className="space-y-4 pb-4 border-b border-gray-50">
                <button onClick={() => setAllowComments(!allowComments)} className="w-full flex items-center justify-between py-1 group"><div className="flex flex-col text-left"><span className="text-sm font-bold text-gray-800">Allow comments</span><span className="text-[10px] text-gray-400">Enable users to leave comments</span></div><div className={`w-10 h-5 rounded-full transition-colors relative ${allowComments ? 'bg-amber-600' : 'bg-gray-200'}`}><div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${allowComments ? 'left-6' : 'left-1'}`} /></div></button>
                <button onClick={() => setForceAnonymous(!forceAnonymous)} className="w-full flex items-center justify-between py-1 group"><div className="flex flex-col text-left"><span className="text-sm font-bold text-gray-800">Require Anonymous Responses</span><span className="text-[10px] text-gray-400">All participants will be forced to respond without identity</span></div><div className={`w-10 h-5 rounded-full transition-colors relative ${forceAnonymous ? 'bg-amber-600' : 'bg-gray-200'}`}><div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${forceAnonymous ? 'left-6' : 'left-1'}`} /></div></button>
                <button onClick={() => setRandomPairing(!randomPairing)} className="w-full flex items-center justify-between py-1 group"><div className="flex flex-col text-left"><span className="text-sm font-bold text-gray-800">Random matchups</span><span className="text-[10px] text-gray-400">Show items in different pairs to users</span></div><div className={`w-10 h-5 rounded-full transition-colors relative ${randomPairing ? 'bg-amber-600' : 'bg-gray-200'}`}><div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${randomPairing ? 'left-6' : 'left-1'}`} /></div></button>
              </section>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <section className="space-y-4">
                <div className="flex items-center justify-between px-1">
                  <h2 className="text-xl font-black text-gray-900 tracking-tight">Challenge Items</h2>
                  {errors.options && <span className="text-[10px] font-bold text-red-500 animate-pulse">{errors.options}</span>}
                </div>

                <div className="space-y-3">
                  {options.map((option, idx) => (
                    <div key={option.id} className="flex items-start gap-3 animate-in slide-in-from-bottom-2 duration-300">
                      <div className="flex flex-col items-center pt-3 gap-1">
                        <span className="text-[10px] font-black text-gray-300 uppercase tracking-tighter">#{idx + 1}</span>
                      </div>
                      <div className="flex-1 flex flex-col gap-2">
                        <div className="flex items-center bg-gray-50 rounded-2xl p-1.5 border border-transparent focus-within:border-amber-200 focus-within:bg-white transition-all shadow-sm">
                          <button
                            onClick={() => { setActiveCropId(option.id); fileInputRef.current?.click(); }}
                            className={`w-14 h-14 rounded-xl flex items-center justify-center shrink-0 overflow-hidden border border-dashed transition-all ${option.image ? 'border-amber-500' : 'border-gray-200 text-gray-400 hover:text-amber-500'
                              }`}
                          >
                            {option.image ? <img src={option.image} className="w-full h-full object-cover" alt="" /> : <Camera size={20} />}
                          </button>
                          <input
                            type="text"
                            value={option.text}
                            onChange={(e) => handleOptionChange(option.id, e.target.value)}
                            placeholder={`Item ${idx + 1} Name`}
                            className="flex-1 px-4 py-2 bg-transparent text-sm font-bold focus:outline-none text-gray-900 placeholder-gray-300"
                          />
                          <div className="flex items-center gap-1 shrink-0 px-1">
                            {option.image && (
                              <button onClick={() => setOptions(options.map(o => o.id === option.id ? { ...o, image: null } : o))} className="p-1.5 text-gray-300 hover:text-red-500"><X size={14} strokeWidth={3} /></button>
                            )}
                            <button onClick={() => setSettingsOptionId(option.id)} className="p-1.5 text-gray-400 hover:text-gray-600"><MoreHorizontal size={18} /></button>
                          </div>
                        </div>
                        {option.withFollowUp && (
                          <div className="px-3 py-1.5 bg-amber-50 border border-amber-100 rounded-xl text-[10px] flex items-center gap-2 animate-in zoom-in-95">
                            <MessageSquare size={10} className="text-amber-500" />
                            <span className="font-bold text-amber-700 truncate">Feedback: {option.followUpLabel || "Why?"}</span>
                          </div>
                        )}
                      </div>
                      {options.length > 2 && (
                        <button onClick={() => handleRemoveOption(option.id)} className="text-gray-300 hover:text-red-500 p-2 mt-2 transition-colors"><Trash2 size={18} /></button>
                      )}
                    </div>
                  ))}
                  <button onClick={handleAddOption} className="w-full py-4 border-2 border-dashed border-gray-100 rounded-2xl text-gray-400 font-black text-xs uppercase tracking-widest hover:border-amber-300 hover:text-amber-600 transition-all flex items-center justify-center gap-2">
                    <Plus size={18} strokeWidth={3} /> Add item to compare
                  </button>
                </div>
              </section>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="bg-amber-50 rounded-[2.5rem] p-6 border border-amber-100 shadow-sm relative overflow-hidden">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-amber-600 text-white rounded-2xl flex items-center justify-center shadow-md">
                    <BarChart3 size={20} />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-gray-900 leading-tight">Insight Filters</h2>
                    <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest mt-0.5">Demographics Setup</p>
                  </div>
                </div>
                <p className="text-sm text-gray-700 leading-relaxed bg-white/50 p-4 rounded-2xl border border-amber-100/50">
                  See how different groups prefer your items. Choose which details you'd like participants to provide.
                </p>
              </div>

              <div className="space-y-3">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] px-1">Available Attributes</label>
                <div className="flex flex-wrap gap-2">
                  {DEMOGRAPHIC_OPTIONS.map((opt) => {
                    const isSelected = selectedDemographics.includes(opt.id);
                    return (
                      <button key={opt.id} onClick={() => setSelectedDemographics(prev => isSelected ? prev.filter(d => d !== opt.id) : [...prev, opt.id])} className={`px-4 py-3 rounded-2xl border text-left transition-all max-w-[calc(50%-4px)] flex-1 min-w-[160px] ${isSelected ? 'bg-amber-600 text-white border-amber-600 shadow-md shadow-amber-200' : 'bg-white text-gray-600 border-gray-100 hover:border-gray-200'}`}>
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-[12px] font-bold ${isSelected ? 'text-white' : 'text-gray-900'}`}>{opt.label}</span>
                          {isSelected && <Check size={12} strokeWidth={4} />}
                        </div>
                        <p className={`text-[9px] leading-tight font-medium ${isSelected ? 'text-amber-50' : 'text-gray-400'}`}>{opt.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-col gap-3 pt-6">
                <button onClick={handleFinalPost} className="w-full py-5 bg-amber-600 text-white rounded-[2rem] font-black uppercase tracking-[0.2em] text-xs shadow-xl shadow-amber-500/20 active:scale-95 transition-all flex items-center justify-center gap-2">Confirm & Start Challenge <ChevronRight size={18} /></button>
                <button onClick={() => setStep(2)} className="w-full py-4 bg-gray-50 text-gray-400 rounded-[2rem] font-black uppercase tracking-[0.2em] text-[10px] active:scale-95 transition-all">Back</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Visibility Bottom Sheets */}
      <BottomSheet isOpen={isVisibilitySheetOpen} onClose={() => setIsVisibilitySheetOpen(false)} title="Post visibility">
        <div className="space-y-2 py-2">
          {visibilityOptions.map((option) => {
            const Icon = option.icon;
            const isSelected = visibility === option.id;
            return (
              <button key={option.id} disabled={!option.allowed} onClick={() => { setVisibility(option.id as VisibilityType); if (option.id !== 'Groups') setIsVisibilitySheetOpen(false); }} className={`w-full flex items-center gap-4 p-4 rounded-2xl border transition-all text-left group ${!option.allowed ? 'opacity-40 cursor-not-allowed grayscale' : isSelected ? 'border-amber-500 bg-amber-50/50' : 'border-transparent hover:bg-gray-50'}`}>
                <div className={`p-2.5 rounded-xl ${isSelected ? 'bg-amber-600 text-white shadow-md' : 'bg-gray-100 text-gray-500'}`}><Icon size={20} /></div>
                <div className="flex-1"><h4 className={`font-bold text-sm ${isSelected ? 'text-amber-700' : 'text-gray-900'}`}>{option.label}</h4><p className="text-[10px] text-gray-500 mt-0.5">{option.desc}</p></div>
                {isSelected && <div className="w-6 h-6 bg-amber-600 text-white rounded-full flex items-center justify-center"><Check size={14} strokeWidth={3} /></div>}
              </button>
            );
          })}
        </div>
      </BottomSheet>

      <BottomSheet isOpen={isResultVisibilitySheetOpen} onClose={() => setIsResultVisibilitySheetOpen(false)} title="Result Visibility" customLayout={true}>
        <div className="flex flex-col h-full bg-white px-5 py-4 space-y-8 overflow-y-auto no-scrollbar">
          <div className="space-y-4">
            <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Section 1: Who Can See the Results</h3>
            <div className="space-y-2">
              {['Public', 'Followers', 'Participants', 'OnlyMe'].map((opt) => (
                <button key={opt} onClick={() => setResultsWho(opt as any)} className="w-full flex items-center justify-between p-4 rounded-2xl border transition-all" style={{ borderColor: resultsWho === opt ? '#d97706' : '#f3f4f6', backgroundColor: resultsWho === opt ? '#fffbeb' : 'white' }}>
                  <span className="text-sm font-bold text-gray-700">{opt === 'Participants' ? 'Participants Only' : opt === 'OnlyMe' ? 'Only Me' : opt}</span>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${resultsWho === opt ? 'border-amber-600 bg-amber-600' : 'border-gray-200'}`}>{resultsWho === opt && <div className="w-1.5 h-1.5 bg-white rounded-full" />}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Section 3: When Results Are Visible</h3>
            <div className="space-y-2">
              <button onClick={() => setResultsTiming('AnyTime')} className="w-full flex items-center justify-between p-4 rounded-2xl border transition-all" style={{ borderColor: resultsTiming === 'AnyTime' ? '#d97706' : '#f3f4f6', backgroundColor: resultsTiming === 'AnyTime' ? '#fffbeb' : 'white' }}><span className="text-sm font-bold text-gray-700">Any time</span></button>
              <button onClick={() => setResultsTiming('Immediately')} className="w-full flex items-center justify-between p-4 rounded-2xl border transition-all" style={{ borderColor: resultsTiming === 'Immediately' ? '#d97706' : '#f3f4f6', backgroundColor: resultsTiming === 'Immediately' ? '#fffbeb' : 'white' }}><span className="text-sm font-bold text-gray-700">Immediately after participation</span></button>
              <button disabled={!canShowResultsAfterEnd} onClick={() => setResultsTiming('AfterEnd')} className="w-full flex items-center justify-between p-4 rounded-2xl border disabled:opacity-40" style={{ borderColor: resultsTiming === 'AfterEnd' ? '#d97706' : '#f3f4f6', backgroundColor: resultsTiming === 'AfterEnd' ? '#fffbeb' : 'white' }}><span className="text-sm font-bold text-gray-700">After post ends</span></button>
            </div>
          </div>
          <button onClick={() => setIsResultVisibilitySheetOpen(false)} className="w-full py-4 bg-gray-900 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl">Done</button>
        </div>
      </BottomSheet>

      <BottomSheet isOpen={isCategorySheetOpen} onClose={() => setIsCategorySheetOpen(false)} title="Select Category">
        <div className="flex flex-wrap gap-2 py-2">
          {CHALLENGE_CATEGORIES.map(cat => (
            <button key={cat} onClick={() => { setCategory(cat); setIsCategorySheetOpen(false); }} className={`px-4 py-2 rounded-full text-xs font-bold border transition-all ${category === cat ? 'bg-amber-600 text-white border-amber-600 shadow-md' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>{cat}</button>
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
                  <input
                    type="text"
                    value={selectedOptionForSettings.followUpLabel}
                    onChange={(e) => setOptions(options.map(o => o.id === selectedOptionForSettings.id ? { ...o, followUpLabel: e.target.value } : o))}
                    placeholder="e.g. Why did you pick this?"
                    className="w-full bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-sm focus:outline-none focus:bg-white focus:border-amber-500 transition-all font-bold shadow-inner"
                    autoFocus
                  />
                </div>
              )}
            </div>

            <button onClick={() => setSettingsOptionId(null)} className="w-full py-4 bg-gray-900 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-lg active:scale-95">Done</button>
          </div>
        )}
      </BottomSheet>

      {croppingImage && <ImageCropper imageSrc={croppingImage} onCrop={handleCropComplete} onCancel={() => { setCroppingImage(null); setActiveCropId(null); }} />}
      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload} />

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
