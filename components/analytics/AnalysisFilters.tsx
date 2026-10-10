import React, { useMemo, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { BottomSheet } from '../BottomSheet';
import { DEMOGRAPHIC_OPTIONS, demographicCountries } from '../../utils/demographicSettings';
import { analysisDimensions, type AnalysisDimension, type AnalysisFilters } from '../../utils/analysis';

type Props = {
  open: boolean; onClose: () => void; onApply: (filters: AnalysisFilters) => void;
  draft: AnalysisFilters; setDraft: React.Dispatch<React.SetStateAction<AnalysisFilters>>;
  dimensions: Record<AnalysisDimension, string>; label: (value: string) => string;
  available: Partial<Record<AnalysisDimension, string[]>>; protectedDetails: boolean; ar: boolean;
};

export function AnalysisFilters({ open, onClose, onApply, draft, setDraft, dimensions, label, available, protectedDetails, ar }: Props) {
  const copy = (arabic: string, english: string) => ar ? arabic : english;
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<AnalysisDimension | null>(null);
  const countries = useMemo(() => demographicCountries(ar ? 'ar' : 'en').map(country => country.value), [ar]);
  // Public taxonomy, independent of who participated. Never infer small-group membership.
  const catalog: Record<AnalysisDimension, string[]> = {
    country: countries, nationality: countries, gender: DEMOGRAPHIC_OPTIONS.gender,
    age: ['Under 18', '18-24', '25-34', '35-44', '45-54', '55+'],
    marital: DEMOGRAPHIC_OPTIONS.maritalStatus, education: DEMOGRAPHIC_OPTIONS.education,
    employment: DEMOGRAPHIC_OPTIONS.employment, industry: DEMOGRAPHIC_OPTIONS.industry,
    sector: DEMOGRAPHIC_OPTIONS.sector
  };
  const count = Object.values(draft).reduce((sum, values) => sum + (values?.length || 0), 0);
  return <BottomSheet isOpen={open} onClose={onClose} title={copy('تصفية المشاركين', 'Filter respondents')} customLayout dragHandleOnly height="85dvh" showCloseButton closeLabel={copy('إغلاق', 'Close')}>
    <div className="an-root an-filter-layout" dir={ar ? 'rtl' : 'ltr'}>
      <div className="an-filter-intro"><p>{copy('اختر القيم ثم طبّق الفلاتر معًا.', 'Choose values, then apply the filters together.')}</p>
        {protectedDetails && <p className="an-hint">{copy('هذه خيارات عامة؛ قد تُحجب النتائج المفلترة لحماية المجموعات الصغيرة.', 'These are general options. Filtered results may be withheld to protect small groups.')}</p>}</div>
      <div className="an-filter-scroll">
        {analysisDimensions.map(key => {
          const values = [...new Set([...catalog[key], 'Unknown', ...(available[key] || []), ...(draft[key] || [])])];
          const visible = values.filter(value => (label(value) + ' ' + value).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
          const isOpen = expanded === key;
          const selected = draft[key] || [];
          return <section className="an-filter-group" key={key}>
            <button className="an-filter-heading" aria-expanded={isOpen} aria-controls={'an-options-' + key} onClick={() => { setExpanded(isOpen ? null : key); setSearch(''); }}>
              <strong>{dimensions[key]}</strong><span>{selected.length ? selected.map(label).join(ar ? '، ' : ', ') : copy('الكل', 'All')}</span><ChevronDown size={18} className={isOpen ? 'an-rotated' : ''} />
            </button>
            {isOpen && <div id={'an-options-' + key}>
              {values.length > 12 && <label className="an-filter-search"><Search size={16} /><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={copy('ابحث عن خيار', 'Search options')} aria-label={copy('ابحث في ', 'Search ') + dimensions[key]} /></label>}
              <div className="an-filter-options">{visible.map(value => <label key={value}><input type="checkbox" checked={selected.includes(value)} disabled={selected.length >= 30 && !selected.includes(value)} onChange={event => setDraft(current => ({ ...current, [key]: event.target.checked ? [...(current[key] || []), value] : current[key]?.filter(item => item !== value) }))} /><span>{label(value)}</span></label>)}</div>
              {!visible.length && <p className="an-hint">{copy('لا توجد خيارات مطابقة.', 'No matching options.')}</p>}
              {selected.length >= 30 && <p className="an-hint">{copy('الحد الأقصى 30 قيمة لكل محدد.', 'Up to 30 values per dimension.')}</p>}
            </div>}
          </section>;
        })}
      </div>
      <div className="an-filter-footer"><div><span>{count ? copy('قيم محددة: ', 'Selected values: ') + count : copy('جميع المشاركين', 'All respondents')}</span><button className="an-text-button" disabled={!count} onClick={() => setDraft({})}>{copy('مسح الاختيارات', 'Clear selection')}</button></div>
        <button className="an-primary" onClick={() => onApply(draft)}>{copy('تطبيق الفلاتر', 'Apply filters')}</button>
      </div>
    </div>
  </BottomSheet>;
}
