import { ProfileValidationError } from './profileValidation';

// Same stable region choices as the account editor. Store the English region
// name; localize its label in the UI. Never infer nationality from residence.
const REGION_CODES = 'AF AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BY BE BZ BJ BT BO BA BW BR BN BG BF BI CV KH CM CA CF TD CL CN CO KM CG CD CR CI HR CU CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FJ FI FR GA GM GE DE GH GR GD GT GN GW GY HT HN HU IS IN ID IR IQ IE IL IT JM JP JO KZ KE KI KW KG LA LV LB LS LR LY LI LT LU MG MW MY MV ML MT MH MR MU MX FM MD MC MN ME MA MZ MM NA NR NP NL NZ NI NE NG KP MK NO OM PK PW PS PA PG PY PE PH PL PT QA RO RU RW KN LC VC WS SM ST SA SN RS SC SL SG SK SI SB SO ZA KR SS ES LK SD SR SE CH SY TW TJ TZ TH TL TG TO TT TN TR TM TV UG UA AE GB US UY UZ VU VA VE VN YE ZM ZW'.split(' ');
const englishRegions = new Intl.DisplayNames(['en'], { type: 'region' });

export const DEMOGRAPHIC_OPTIONS: Record<string, readonly string[]> = {
  nationality: REGION_CODES.map(code => englishRegions.of(code) || code),
  gender: ['Male', 'Female', 'Prefer not to say'],
  maritalStatus: ['Single', 'Engaged', 'Married', 'Widowed', 'Divorced', 'Separated', 'Prefer not to say'],
  educationLevel: ['Primary Education', 'Preparatory / Middle School', 'Secondary Education (High School)', 'Diploma', 'Higher Diploma / Postgraduate Diploma', 'Bachelor’s Degree', 'Professional Diploma', 'Master’s Degree', 'Doctorate (PhD)', 'Prefer not to say'],
  employmentType: ['Employed', 'Unemployed', 'Student', 'Retired', 'Homemaker', 'prefer not to specify'],
  industry: ['Government', 'Private Sector', 'Non-profit / NGO', 'Self-employed / Freelancer', 'Not Applicable', 'Prefer not to say'],
  employmentSector: ['Agriculture, Forestry, And Fishing', 'Mining', 'Construction', 'Manufacturing', 'Transportation, Communications, Electric, Gas, And Sanitary Services', 'Wholesale Trade', 'Retail Trade', 'Finance, Insurance, And Real Estate', 'Services', 'Public Administration', 'Not Applicable', 'Prefer Not To Specify']
};

const invalid = (message: string): never => { throw new ProfileValidationError('INVALID_SETTINGS', message); };
export const parseSettingsChanges = (value: unknown): Record<string, boolean | string> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('Changes must be an object.');
  const entries = Object.entries(value);
  if (!entries.length) return invalid('No settings changes were provided.');
  const output: Record<string, boolean | string> = {};
  for (const [key, input] of entries) {
    if (['searchVisibility', 'allowSharing', 'groupInvites'].includes(key)) {
      if (typeof input !== 'boolean') return invalid(`${key} must be a boolean.`);
      output[key] = input;
    } else {
      const choices: Record<string, string[]> = { theme: ['system', 'light', 'dark'], language: ['en', 'ar'], groupPrivacy: ['Public', 'Followers', 'Off'] };
      if (typeof input !== 'string' || !choices[key]?.includes(input)) return invalid(`Invalid setting: ${key}.`);
      output[key] = input;
    }
  }
  return output;
};

export const requireProfileVersion = (value: unknown): Date => {
  if (typeof value !== 'string' || !value) throw new ProfileValidationError('PROFILE_VERSION_REQUIRED', 'The current profile version is required.', 428);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new ProfileValidationError('INVALID_PROFILE_VERSION', 'The profile version is invalid.');
  return parsed;
};

export const validateDemographics = (value: Record<string, unknown>): Record<string, string | null> => {
  const aliases: Record<string, string> = { education: 'educationLevel', employment: 'employmentType', sector: 'employmentSector' };
  const output: Record<string, string | null> = {};
  for (const [key, input] of Object.entries(value)) {
    const field = aliases[key] || key;
    if (!(field in DEMOGRAPHIC_OPTIONS)) throw new ProfileValidationError('INVALID_DEMOGRAPHICS', `Unsupported demographic field: ${key}.`);
    if (field in output) throw new ProfileValidationError('INVALID_DEMOGRAPHICS', `Duplicate demographic field: ${field}.`);
    if (input === null || input === '') output[field] = null;
    else if (typeof input === 'string' && DEMOGRAPHIC_OPTIONS[field].includes(input)) output[field] = input;
    else throw new ProfileValidationError('INVALID_DEMOGRAPHICS', `Invalid demographic value: ${field}.`);
  }
  return output;
};
