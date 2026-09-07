import type { UserProfile } from '../types';

export const DEMOGRAPHIC_FIELDS = ['gender', 'maritalStatus', 'education', 'employment', 'industry', 'sector', 'nationality'] as const;
export type DemographicField = typeof DEMOGRAPHIC_FIELDS[number];
export type DemographicDraft = Record<DemographicField, string>;

// Only user-editable fields belong to this transaction. Age is derived on the server.
type StoredDemographics = UserProfile['demographics'] & {
  educationLevel?: string | null;
  employmentType?: string | null;
  employmentSector?: string | null;
};
export const demographicSnapshot = (value?: StoredDemographics): DemographicDraft => {
  const aliases = { education: 'educationLevel', employment: 'employmentType', sector: 'employmentSector' } as const;
  return Object.fromEntries(DEMOGRAPHIC_FIELDS.map((field) => {
    const canonical = aliases[field as keyof typeof aliases];
    const stored = canonical && value && Object.prototype.hasOwnProperty.call(value, canonical)
      ? value[canonical] : value?.[field];
    return [field, stored || ''];
  })) as DemographicDraft;
};

export const demographicHasChanges = (draft: DemographicDraft, saved: DemographicDraft): boolean =>
  DEMOGRAPHIC_FIELDS.some((field) => draft[field] !== saved[field]);

export const changeDemographic = (draft: DemographicDraft, field: DemographicField, value: string): DemographicDraft => {
  const next = { ...draft, [field]: value };
  if (field === 'employment') {
    if (value === 'Unemployed' || value === 'Homemaker') {
      next.industry = 'Not Applicable';
      next.sector = 'Not Applicable';
    } else if (draft.employment === 'Unemployed' || draft.employment === 'Homemaker') {
      if (next.industry === 'Not Applicable') next.industry = '';
      if (next.sector === 'Not Applicable') next.sector = '';
    }
  }
  return next;
};

export const DEMOGRAPHIC_OPTIONS: Record<Exclude<DemographicField, 'nationality'>, string[]> = {
  gender: ['Male', 'Female', 'Prefer not to say'],
  maritalStatus: ['Single', 'Engaged', 'Married', 'Widowed', 'Divorced', 'Separated', 'Prefer not to say'],
  education: ['Primary Education', 'Preparatory / Middle School', 'Secondary Education (High School)', 'Diploma', 'Higher Diploma / Postgraduate Diploma', 'Bachelor’s Degree', 'Professional Diploma', 'Master’s Degree', 'Doctorate (PhD)', 'Prefer not to say'],
  employment: ['Employed', 'Unemployed', 'Student', 'Retired', 'Homemaker', 'prefer not to specify'],
  industry: ['Government', 'Private Sector', 'Non-profit / NGO', 'Self-employed / Freelancer', 'Not Applicable', 'Prefer not to say'],
  sector: ['Agriculture, Forestry, And Fishing', 'Mining', 'Construction', 'Manufacturing', 'Transportation, Communications, Electric, Gas, And Sanitary Services', 'Wholesale Trade', 'Retail Trade', 'Finance, Insurance, And Real Estate', 'Services', 'Public Administration', 'Not Applicable', 'Prefer Not To Specify']
};

const REGION_CODES = 'AF AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BY BE BZ BJ BT BO BA BW BR BN BG BF BI CV KH CM CA CF TD CL CN CO KM CG CD CR CI HR CU CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FJ FI FR GA GM GE DE GH GR GD GT GN GW GY HT HN HU IS IN ID IR IQ IE IL IT JM JP JO KZ KE KI KW KG LA LV LB LS LR LY LI LT LU MG MW MY MV ML MT MH MR MU MX FM MD MC MN ME MA MZ MM NA NR NP NL NZ NI NE NG KP MK NO OM PK PW PS PA PG PY PE PH PL PT QA RO RU RW KN LC VC WS SM ST SA SN RS SC SL SG SK SI SB SO ZA KR SS ES LK SD SR SE CH SY TW TJ TZ TH TL TG TO TT TN TR TM TV UG UA AE GB US UY UZ VU VA VE VN YE ZM ZW'.split(' ');

export const demographicCountries = (language: string): Array<{ value: string; label: string }> => {
  const english = new Intl.DisplayNames(['en'], { type: 'region' });
  const localized = new Intl.DisplayNames([language], { type: 'region' });
  return REGION_CODES.map((code) => ({ value: english.of(code) || code, label: localized.of(code) || code }))
    .sort((a, b) => a.label.localeCompare(b.label, language));
};

export const searchDemographicCountries = (language: string, query: string): Array<{ value: string; label: string }> => {
  const localized = demographicCountries(language);
  const arabic = new Map(demographicCountries('ar').map((country) => [country.value, country.label]));
  const normalized = query.trim().toLocaleLowerCase(language);
  return localized.filter(({ value, label }) => `${value} ${label} ${arabic.get(value) || ''}`.toLocaleLowerCase(language).includes(normalized));
};
