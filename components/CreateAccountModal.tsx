
import React, { useState, useEffect } from 'react';
import { X, Users, Building2, ChevronRight, Globe as GlobeIcon, Plus, Shield, MapPin, Briefcase, Info, ArrowLeft, Camera, LayoutGrid, Check, Lock } from 'lucide-react';
import { BottomSheet } from './BottomSheet';
import { Group, UserProfile } from '../types';
import { api } from '../services/api';

interface CreateAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialType?: 'group' | 'company' | null;
  onGroupCreated?: (group: Group) => void;
  userProfile?: UserProfile | null;
}

type AccountType = 'group' | 'company' | null;

export const CreateAccountModal: React.FC<CreateAccountModalProps> = ({ isOpen, onClose, initialType, onGroupCreated, userProfile }) => {
  const [step, setStep] = useState<1 | 2>(1);
  const [type, setType] = useState<AccountType>(null);
  const [formData, setFormData] = useState<any>({
    name: '',
    category: 'Hobby & Interests',
    description: '',
    isPublic: true,
    website: '',
    industry: 'Technology'
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (initialType) {
        setType(initialType);
        setStep(2);
      } else {
        setType(null);
        setStep(1);
      }
      setIsSuccess(false);
      setIsSubmitting(false);
      setFormData({
        name: '',
        category: 'Hobby & Interests',
        description: '',
        isPublic: true,
        website: '',
        industry: 'Technology'
      });
    }
  }, [isOpen, initialType]);

  const handleSelectType = (selectedType: AccountType) => {
    setType(selectedType);
    setStep(2);
  };

  const handleBack = () => {
    if (step === 2 && !initialType) {
      setStep(1);
      setType(null);
    } else {
      onClose();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile?.id) {
      alert("Please log in to create a group");
      return;
    }
    setIsSubmitting(true);

    try {
      if (onGroupCreated) {
        const newEntity = await api.createGroup({
          name: formData.name,
          description: formData.description || (type === 'company' ? `Official page for ${formData.name}` : ''),
          category: type === 'company' ? formData.industry : formData.category,
          isPublic: type === 'company' ? true : formData.isPublic,
          image: `https://picsum.photos/200/200?random=${Date.now()}`,
          creatorId: userProfile.id
        });

        onGroupCreated({
          ...newEntity,
          memberCount: 1, // Instantly set to 1 for creator
          permissions: {
            canViewMembers: true,
            canManageSettings: true,
            canPost: true
          }
        });
      }

      setIsSuccess(true);
      setTimeout(() => {
        setIsSuccess(false);
        setStep(1);
        setType(null);
        onClose();
      }, 1500);
    } catch (error) {
      console.error("Failed to create entity", error);
      alert("An error occurred while creating. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderStep1 = () => (
    <div className="space-y-6 pt-2 pb-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="flex justify-center mb-2">
        <img src="logo.png" alt="" className="w-16 h-16 object-contain" />
      </div>
      <div className="text-center px-4">
        <h2 className="text-xl font-black text-gray-900 mb-2">Grow your Presence</h2>
        <p className="text-sm text-gray-500">Choose the type of managed entity you want to create on SocialInsight.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 px-2">
        <button
          onClick={() => handleSelectType('group')}
          className="group relative flex items-center gap-4 p-5 rounded-2xl bg-white border border-gray-200 hover:border-blue-500 hover:shadow-lg hover:shadow-blue-500/5 transition-all active:scale-[0.98] text-left"
        >
          <div className="w-14 h-14 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 group-hover:bg-blue-600 group-hover:text-white transition-colors">
            <Users size={28} />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-gray-900 group-hover:text-blue-600 transition-colors">Community Group</h3>
            <p className="text-xs text-gray-500 leading-relaxed">Perfect for clubs, hobbies, research circles, or social neighborhoods.</p>
          </div>
          <ChevronRight size={20} className="text-gray-300 group-hover:text-blue-500 group-hover:translate-x-1 transition-all" />
        </button>

        <button
          onClick={() => handleSelectType('company')}
          className="group relative flex items-center gap-4 p-5 rounded-2xl bg-white border border-gray-200 hover:border-indigo-500 hover:shadow-lg hover:shadow-indigo-500/5 transition-all active:scale-[0.98] text-left"
        >
          <div className="w-14 h-14 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
            <Building2 size={28} />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-gray-900 group-hover:text-indigo-600 transition-colors">Business Page</h3>
            <p className="text-xs text-gray-500 leading-relaxed">Professional profile for organizations, startups, or established brands.</p>
          </div>
          <ChevronRight size={20} className="text-gray-300 group-hover:text-indigo-500 group-hover:translate-x-1 transition-all" />
        </button>
      </div>

      <div className="bg-gray-50 p-4 rounded-2xl mx-2 border border-gray-100 flex items-start gap-3">
        <Info size={16} className="text-blue-500 mt-0.5 shrink-0" />
        <p className="text-[10px] font-medium text-gray-500 leading-relaxed uppercase tracking-wide">
          Managed entities allow you to collaborate on surveys with teammates and maintain a unified brand identity.
        </p>
      </div>
    </div>
  );

  const renderGroupForm = () => (
    <form onSubmit={handleSubmit} className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-300 pb-10">
      <div className="flex flex-col items-center mb-6">
        <div className="relative group cursor-pointer">
          <div className="w-20 h-20 rounded-[2rem] bg-gray-100 flex items-center justify-center text-gray-400 border-2 border-dashed border-gray-300 group-hover:border-blue-500 transition-colors">
            <Camera size={24} />
          </div>
          <div className="absolute -bottom-1 -right-1 bg-white p-1.5 rounded-full shadow-sm border border-gray-100">
            <Plus size={12} className="text-blue-600" />
          </div>
        </div>
        <span className="text-[10px] font-bold text-gray-400 uppercase mt-2">Group Avatar</span>
      </div>

      <div className="space-y-4 px-2">
        <div>
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 px-1">Group Name</label>
          <input
            required
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="e.g. Vintage Camera Enthusiasts"
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 focus:bg-white transition-all shadow-sm focus:shadow-blue-500/5"
          />
        </div>

        <div>
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 px-1">Category</label>
          <div className="relative">
            <select
              value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value })}
              className="w-full appearance-none bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 focus:bg-white transition-all shadow-sm pr-10"
            >
              <option>Hobby & Interests</option>
              <option>Education & Study</option>
              <option>Non-Profit & Community</option>
              <option>Gaming & Esports</option>
              <option>Health & Wellness</option>
              <option>Professional Networking</option>
            </select>
            <LayoutGrid size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 px-1">Description</label>
          <textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="Tell potential members what this group is about..."
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 focus:bg-white transition-all shadow-sm resize-none min-h-[80px]"
          />
        </div>

        <div className="space-y-3">
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 px-1">Privacy Level</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setFormData({ ...formData, isPublic: true })}
              className={`p-4 rounded-2xl border text-left transition-all ${formData.isPublic ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500/20' : 'border-gray-200 bg-white hover:border-gray-300'}`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <div className={`p-1.5 rounded-lg ${formData.isPublic ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
                  <GlobeIcon size={14} />
                </div>
                <span className={`text-sm font-bold ${formData.isPublic ? 'text-blue-700' : 'text-gray-700'}`}>Public</span>
              </div>
              <p className="text-[10px] text-gray-500 leading-relaxed">Anyone can find the group and see its surveys.</p>
            </button>

            <button
              type="button"
              onClick={() => setFormData({ ...formData, isPublic: false })}
              className={`p-4 rounded-2xl border text-left transition-all ${!formData.isPublic ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500/20' : 'border-gray-200 bg-white hover:border-gray-300'}`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <div className={`p-1.5 rounded-lg ${!formData.isPublic ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
                  <Lock size={14} />
                </div>
                <span className={`text-sm font-bold ${!formData.isPublic ? 'text-blue-700' : 'text-gray-700'}`}>Private</span>
              </div>
              <p className="text-[10px] text-gray-500 leading-relaxed">Only members can find the group and see content.</p>
            </button>
          </div>
        </div>
      </div>

      <div className="px-2 pt-4">
        <button
          type="submit"
          disabled={isSubmitting || !formData.name}
          className="w-full bg-blue-600 text-white py-4 rounded-2xl font-bold text-sm shadow-xl shadow-blue-500/20 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {isSubmitting ? (
            <span className="flex items-center gap-2"><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Finalizing...</span>
          ) : 'Create Group'}
        </button>
      </div>
    </form>
  );

  const renderCompanyForm = () => (
    <form onSubmit={handleSubmit} className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-300 pb-10">
      <div className="flex flex-col items-center mb-6">
        <div className="relative group cursor-pointer">
          <div className="w-24 h-16 rounded-xl bg-gray-100 flex items-center justify-center text-gray-400 border-2 border-dashed border-gray-300 group-hover:border-indigo-500 transition-colors">
            <Building2 size={28} />
          </div>
          <div className="absolute -bottom-1 -right-1 bg-white p-1.5 rounded-full shadow-sm border border-gray-100">
            <Plus size={12} className="text-indigo-600" />
          </div>
        </div>
        <span className="text-[10px] font-bold text-gray-400 uppercase mt-2">Business Page Logo</span>
      </div>

      <div className="space-y-4 px-2">
        <div>
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 px-1">Business Name</label>
          <input
            required
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="e.g. Lumina Digital Inc."
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-500 focus:bg-white transition-all shadow-sm"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 px-1">Industry</label>
            <div className="relative">
              <select
                value={formData.industry}
                onChange={(e) => setFormData({ ...formData, industry: e.target.value })}
                className="w-full appearance-none bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-500 focus:bg-white transition-all shadow-sm pr-8"
              >
                <option>Technology</option>
                <option>Marketing</option>
                <option>Finance</option>
                <option>Consumer Goods</option>
                <option>Retail</option>
                <option>Other</option>
              </select>
              <Briefcase size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 px-1">Headquarters</label>
            <div className="relative">
              <input type="text" placeholder="City" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-500 focus:bg-white transition-all shadow-sm pr-8" />
              <MapPin size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 px-1">Official Website</label>
          <div className="relative">
            <input
              type="url"
              value={formData.website}
              onChange={(e) => setFormData({ ...formData, website: e.target.value })}
              placeholder="https://www.company.com"
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-500 focus:bg-white transition-all shadow-sm pl-4 pr-10"
            />
            <GlobeIcon size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 px-1">Team Size</label>
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
            {['1-10', '11-50', '51-200', '201-500', '500+'].map(size => (
              <button
                type="button"
                key={size}
                onClick={() => setFormData({ ...formData, teamSize: size })}
                className={`px-4 py-2 rounded-xl text-xs font-bold border whitespace-nowrap transition-all ${formData.teamSize === size ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-100' : 'bg-white text-gray-500 border-gray-100 hover:border-gray-200'}`}
              >
                {size}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-2 pt-4">
        <button
          type="submit"
          disabled={isSubmitting || !formData.name}
          className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold text-sm shadow-xl shadow-indigo-500/20 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {isSubmitting ? (
            <span className="flex items-center gap-2"><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Processing...</span>
          ) : 'Setup Business Page'}
        </button>
      </div>
    </form>
  );

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={handleBack}
      customLayout={true}
      title={step === 1 ? "Organization Setup" : type === 'group' ? "New Community" : "Business Page"}
    >
      <div className="flex-1 flex flex-col h-full bg-white relative">
        {step === 2 && !initialType && (
          <button
            onClick={handleBack}
            className="absolute top-[-38px] left-4 p-1.5 text-gray-400 hover:text-gray-600 rounded-full transition-colors z-20"
          >
            <ArrowLeft size={20} />
          </button>
        )}

        <div className="flex-1 overflow-y-auto no-scrollbar px-4 pt-4">
          {isSuccess ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-6 py-12 animate-in zoom-in duration-300">
              <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-6">
                <Check size={40} strokeWidth={3} />
              </div>
              <h3 className="text-2xl font-black text-gray-900 mb-2">Success!</h3>
              <p className="text-gray-500 text-sm leading-relaxed">
                Your {type === 'group' ? 'group' : 'business page'} has been established. You can now start managing insights under this brand.
              </p>
            </div>
          ) : (
            step === 1 ? renderStep1() : (type === 'group' ? renderGroupForm() : renderCompanyForm())
          )}
        </div>
      </div>
    </BottomSheet>
  );
};
