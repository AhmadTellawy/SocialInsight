import React, { useState, useMemo } from 'react';
import { Search, Globe, ChevronDown, Check } from 'lucide-react';

export const COUNTRY_CODES = [
    { country: 'Jordan', code: '+962', flag: '🇯🇴' },
    { country: 'Saudi Arabia', code: '+966', flag: '🇸🇦' },
    { country: 'United Arab Emirates', code: '+971', flag: '🇦🇪' },
    { country: 'Egypt', code: '+20', flag: '🇪🇬' },
    { country: 'Qatar', code: '+974', flag: '🇶🇦' },
    { country: 'Kuwait', code: '+965', flag: '🇰🇼' },
    { country: 'Oman', code: '+968', flag: '🇴🇲' },
    { country: 'Bahrain', code: '+973', flag: '🇧🇭' },
    { country: 'Lebanon', code: '+961', flag: '🇱🇧' },
    { country: 'Palestine', code: '+970', flag: '🇵🇸' },
    { country: 'Iraq', code: '+964', flag: '🇮🇶' },
    { country: 'USA', code: '+1', flag: '🇺🇸' },
    { country: 'UK', code: '+44', flag: '🇬🇧' },
    { country: 'Canada', code: '+1', flag: '🇨🇦' },
    { country: 'Germany', code: '+49', flag: '🇩🇪' },
    { country: 'France', code: '+33', flag: '🇫🇷' },
    { country: 'Turkey', code: '+90', flag: '🇹🇷' },
];

interface PhoneInputProps {
    value: string;
    onChange: (fullNumber: string) => void;
    placeholder?: string;
    required?: boolean;
}

export const PhoneInput: React.FC<PhoneInputProps> = ({ value, onChange, placeholder = "Phone Number", required = false }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [selectedCountry, setSelectedCountry] = useState(COUNTRY_CODES[0]);
    const [localNumber, setLocalNumber] = useState('');

    const filteredCountries = useMemo(() => {
        return COUNTRY_CODES.filter(c =>
            c.country.toLowerCase().includes(search.toLowerCase()) ||
            c.code.includes(search)
        );
    }, [search]);

    const handleLocalNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value.replace(/\D/g, ''); // Numeric only
        setLocalNumber(val);
        onChange(`${selectedCountry.code}${val}`);
    };

    const handleCountrySelect = (country: typeof COUNTRY_CODES[0]) => {
        setSelectedCountry(country);
        onChange(`${country.code}${localNumber}`);
        setIsOpen(false);
        setSearch('');
    };

    return (
        <div className="relative group">
            <div className="flex gap-2">
                {/* Country Selector */}
                <button
                    type="button"
                    onClick={() => setIsOpen(!isOpen)}
                    className="flex items-center gap-2 px-4 py-4 bg-gray-50 border border-transparent focus:border-blue-500 rounded-2xl transition-all hover:bg-white hover:border-gray-200"
                >
                    <span className="text-xl">{selectedCountry.flag}</span>
                    <span className="text-sm font-bold text-gray-900">{selectedCountry.code}</span>
                    <ChevronDown size={14} className={`text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>

                {/* Number Input */}
                <div className="flex-1 relative">
                    <input
                        type="tel"
                        required={required}
                        value={localNumber}
                        onChange={handleLocalNumberChange}
                        placeholder={placeholder}
                        className="w-full bg-gray-50 border border-transparent focus:border-blue-500 focus:bg-white rounded-2xl px-6 py-4 outline-none transition-all font-medium"
                    />
                </div>
            </div>

            {/* Dropdown Menu */}
            {isOpen && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
                    <div className="absolute top-full left-0 mt-2 w-72 bg-white border border-gray-100 rounded-3xl shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                        <div className="p-3 border-b border-gray-50">
                            <div className="relative">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                <input
                                    autoFocus
                                    type="text"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder="Search country or code..."
                                    className="w-full bg-gray-50 border-none rounded-xl pl-9 pr-4 py-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500/10"
                                />
                            </div>
                        </div>
                        <div className="max-h-64 overflow-y-auto no-scrollbar py-2">
                            {filteredCountries.map((c) => (
                                <button
                                    key={c.country}
                                    type="button"
                                    onClick={() => handleCountrySelect(c)}
                                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-blue-50 transition-colors"
                                >
                                    <div className="flex items-center gap-3">
                                        <span className="text-xl">{c.flag}</span>
                                        <div className="text-left">
                                            <div className="text-sm font-bold text-gray-900">{c.country}</div>
                                            <div className="text-[10px] text-gray-400 font-black uppercase tracking-widest">{c.code}</div>
                                        </div>
                                    </div>
                                    {selectedCountry.country === c.country && (
                                        <Check size={16} className="text-blue-600" strokeWidth={3} />
                                    )}
                                </button>
                            ))}
                            {filteredCountries.length === 0 && (
                                <div className="p-8 text-center text-gray-400">
                                    <Globe size={32} className="mx-auto mb-2 opacity-10" />
                                    <p className="text-[10px] font-black uppercase tracking-widest">No matching countries</p>
                                </div>
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};
