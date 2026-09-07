import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSettingsChanges, requireProfileVersion, validateDemographics } from './accountSettingsValidation';

test('settings reject mixed unknown fields, string booleans and unrecognized enum values', () => {
  for (const input of [{ searchVisibility: 'false' }, { groupPrivacy: 'Nobody' }, { theme: 'auto' }, { language: 'AR' }, { allowSharing: false, role: 'ADMIN' }, {}, []]) assert.throws(() => parseSettingsChanges(input));
  assert.deepEqual(parseSettingsChanges({ searchVisibility: false, theme: 'system', groupPrivacy: 'Off', language: 'ar' }), { searchVisibility: false, theme: 'system', groupPrivacy: 'Off', language: 'ar' });
});
test('profile writes require a parseable explicit version', () => {
  for (const input of [undefined, null, 0, '', 'not a date']) assert.throws(() => requireProfileVersion(input));
  assert.equal(requireProfileVersion('2026-09-07T12:00:00.000Z').toISOString(), '2026-09-07T12:00:00.000Z');
});
test('demographic aliases preserve intentional clearing without accepting derived age or arbitrary categories', () => {
  assert.deepEqual(validateDemographics({ education: '', industry: null, gender: 'Female' }), { educationLevel: null, industry: null, gender: 'Female' });
  for (const input of [{ ageGroup: '18-24' }, { gender: '<script>' }, { sector: 'made up' }, { education: '', educationLevel: 'Diploma' }]) assert.throws(() => validateDemographics(input));
});

test('full account editor payload preserves canonical values and validates private nationality', () => {
  assert.deepEqual(validateDemographics({ gender: 'Female', maritalStatus: '', education: 'Diploma', employment: 'Employed', industry: 'Government', sector: 'Services', nationality: 'Jordan' }), {
    gender: 'Female', maritalStatus: null, educationLevel: 'Diploma', employmentType: 'Employed', industry: 'Government', employmentSector: 'Services', nationality: 'Jordan'
  });
  assert.deepEqual(validateDemographics({ nationality: '' }), { nationality: null });
  for (const nationality of ['Unknown nation', 'الأردن', 1, {}, '<script>']) assert.throws(() => validateDemographics({ nationality }));
});
