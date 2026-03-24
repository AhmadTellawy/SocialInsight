import React, { useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';

interface Country {
    code: string;
    name: string;
    flag: string;
}

const COUNTRIES: Country[] = [
    { code: 'JO', name: 'Jordan', flag: '🇯🇴' },
    { code: 'SA', name: 'Saudi Arabia', flag: '🇸🇦' },
    { code: 'AE', name: 'United Arab Emirates', flag: '🇦🇪' },
    { code: 'EG', name: 'Egypt', flag: '🇪🇬' },
    { code: 'LB', name: 'Lebanon', flag: '🇱🇧' },
    { code: 'SY', name: 'Syria', flag: '🇸🇾' },
    { code: 'IQ', name: 'Iraq', flag: '🇮🇶' },
    { code: 'YE', name: 'Yemen', flag: '🇾🇪' },
    { code: 'KW', name: 'Kuwait', flag: '🇰🇼' },
    { code: 'QA', name: 'Qatar', flag: '🇶🇦' },
    { code: 'BH', name: 'Bahrain', flag: '🇧🇭' },
    { code: 'OM', name: 'Oman', flag: '🇴🇲' },
    { code: 'PS', name: 'Palestine', flag: '🇵🇸' },
    { code: 'MA', name: 'Morocco', flag: '🇲🇦' },
    { code: 'DZ', name: 'Algeria', flag: '🇩🇿' },
    { code: 'TN', name: 'Tunisia', flag: '🇹🇳' },
    { code: 'LY', name: 'Libya', flag: '🇱🇾' },
    { code: 'SD', name: 'Sudan', flag: '🇸🇩' },
    { code: 'US', name: 'United States', flag: '🇺🇸' },
    { code: 'GB', name: 'United Kingdom', flag: '🇬🇧' },
    { code: 'CA', name: 'Canada', flag: '🇨🇦' },
    { code: 'AU', name: 'Australia', flag: '🇦🇺' },
    { code: 'DE', name: 'Germany', flag: '🇩🇪' },
    { code: 'FR', name: 'France', flag: '🇫🇷' },
    { code: 'IT', name: 'Italy', flag: '🇮🇹' },
    { code: 'ES', name: 'Spain', flag: '🇪🇸' },
    { code: 'TR', name: 'Turkey', flag: '🇹🇷' },
    { code: 'IN', name: 'India', flag: '🇮🇳' },
    { code: 'PK', name: 'Pakistan', flag: '🇵🇰' },
    { code: 'BD', name: 'Bangladesh', flag: '🇧🇩' },
    { code: 'ID', name: 'Indonesia', flag: '🇮🇩' },
    { code: 'MY', name: 'Malaysia', flag: '🇲🇾' },
    { code: 'SG', name: 'Singapore', flag: '🇸🇬' },
    { code: 'PH', name: 'Philippines', flag: '🇵🇭' },
    { code: 'TH', name: 'Thailand', flag: '🇹🇭' },
    { code: 'CN', name: 'China', flag: '🇨🇳' },
    { code: 'JP', name: 'Japan', flag: '🇯🇵' },
    { code: 'KR', name: 'South Korea', flag: '🇰🇷' },
];

interface CountrySelectorProps {
    value: string;
    onChange: (country: string) => void;
    placeholder?: string;
}

export const CountrySelector: React.FC<CountrySelectorProps> = ({
    value,
    onChange,
    placeholder = 'Select your country'
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    const selectedCountry = COUNTRIES.find(c => c.name === value);

    const filteredCountries = COUNTRIES.filter(country =>
        country.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const handleSelect = (country: Country) => {
        onChange(country.name);
        setIsOpen(false);
        setSearchQuery('');
    };

    return (
        <>
            {/* Trigger Button */}
            <button
                type="button"
                onClick={() => setIsOpen(true)}
                className="w-full bg-gray-50 border border-transparent focus:border-blue-500 focus:bg-white rounded-2xl pl-12 pr-4 py-4 outline-none transition-all font-medium text-left flex items-center justify-between"
            >
                {selectedCountry ? (
                    <span className="flex items-center gap-2">
                        <span className="text-2xl">{selectedCountry.flag}</span>
                        <span>{selectedCountry.name}</span>
                    </span>
                ) : (
                    <span className="text-gray-400">{placeholder}</span>
                )}
                <ChevronDown size={20} className="text-gray-400" />
            </button>

            {/* Modal/Bottom Sheet */}
            {isOpen && (
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-t-[2rem] sm:rounded-[2rem] w-full sm:max-w-md max-h-[80vh] flex flex-col animate-in slide-in-from-bottom sm:zoom-in-95 duration-200">
                        {/* Header */}
                        <div className="flex items-center justify-between p-6 pb-4 border-b border-gray-100">
                            <h3 className="text-lg font-black text-gray-900">Select Country</h3>
                            <button
                                onClick={() => {
                                    setIsOpen(false);
                                    setSearchQuery('');
                                }}
                                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                            >
                                <X size={20} className="text-gray-400" />
                            </button>
                        </div>

                        {/* Search */}
                        <div className="p-4 border-b border-gray-100">
                            <div className="relative">
                                <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Search countries..."
                                    className="w-full pl-11 pr-4 py-3 bg-gray-50 rounded-xl border border-transparent focus:border-blue-500 focus:bg-white outline-none transition-all text-sm"
                                    autoFocus
                                />
                            </div>
                        </div>

                        {/* Countries List */}
                        <div className="flex-1 overflow-y-auto">
                            {filteredCountries.length > 0 ? (
                                <div className="p-2">
                                    {filteredCountries.map((country) => {
                                        const isSelected = value === country.name;
                                        return (
                                            <button
                                                key={country.code}
                                                onClick={() => handleSelect(country)}
                                                className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all text-left ${isSelected
                                                        ? 'bg-blue-50 text-blue-700'
                                                        : 'hover:bg-gray-50 text-gray-900'
                                                    }`}
                                            >
                                                <span className="text-2xl">{country.flag}</span>
                                                <span className="flex-1 font-medium">{country.name}</span>
                                                {isSelected && (
                                                    <Check size={20} className="text-blue-600" strokeWidth={3} />
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="p-12 text-center text-gray-400">
                                    <p className="text-sm">No countries found</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};
