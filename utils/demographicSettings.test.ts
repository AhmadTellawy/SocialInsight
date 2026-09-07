import assert from 'node:assert/strict';
import test from 'node:test';
import { changeDemographic, demographicCountries, demographicHasChanges, demographicSnapshot, searchDemographicCountries } from './demographicSettings.ts';

test('demographics compare net editable changes and exclude derived age', () => {
  const saved = demographicSnapshot({ gender: 'Female', ageGroup: '25-34' });
  assert.equal(demographicHasChanges(saved, demographicSnapshot({ gender: 'Female', ageGroup: '35-44' })), false);
  const changed = changeDemographic(saved, 'gender', 'Male');
  assert.equal(demographicHasChanges(changed, saved), true);
  assert.equal(demographicHasChanges(changeDemographic(changed, 'gender', 'Female'), saved), false);
  assert.equal(Object.hasOwn(saved, 'ageGroup'), false);
});

test('employment dependency values clear consistently on change and reset', () => {
  const saved = demographicSnapshot({ employment: 'Employed', industry: 'Government', sector: 'Services' });
  const unemployed = changeDemographic(saved, 'employment', 'Unemployed');
  assert.equal(unemployed.industry, 'Not Applicable');
  assert.equal(unemployed.sector, 'Not Applicable');
  const employed = changeDemographic(unemployed, 'employment', 'Employed');
  assert.equal(employed.industry, '');
  assert.equal(employed.sector, '');
  assert.deepEqual(demographicSnapshot(), { gender: '', maritalStatus: '', education: '', employment: '', industry: '', sector: '', nationality: '' });
});

test('canonical server fields survive an unrelated demographic edit and respect explicit clearing', () => {
  const saved = demographicSnapshot({ gender: 'Female', educationLevel: 'Bachelor’s Degree', employmentType: 'Employed', employmentSector: 'Services' });
  const changed = changeDemographic(saved, 'gender', 'Male');
  assert.equal(changed.education, 'Bachelor’s Degree');
  assert.equal(changed.employment, 'Employed');
  assert.equal(changed.sector, 'Services');
  assert.equal(demographicSnapshot({ educationLevel: null, education: 'Diploma' }).education, '');
  assert.equal(demographicSnapshot({ education: 'Diploma' }).education, 'Diploma');
});

test('nationality supports Arabic display and stable English storage without short preview', () => {
  const arabic = demographicCountries('ar');
  const english = demographicCountries('en');
  assert.ok(arabic.length > 190);
  assert.deepEqual(arabic.find((item) => item.value === 'Jordan'), { value: 'Jordan', label: 'الأردن' });
  assert.deepEqual(english.find((item) => item.value === 'Jordan'), { value: 'Jordan', label: 'Jordan' });
});

test('nationality search accepts Arabic and English regardless of interface language', () => {
  assert.equal(searchDemographicCountries('en', 'الأردن')[0]?.value, 'Jordan');
  assert.equal(searchDemographicCountries('ar', 'Jordan')[0]?.label, 'الأردن');
  assert.equal(searchDemographicCountries('en', 'no-country-matches').length, 0);
});
