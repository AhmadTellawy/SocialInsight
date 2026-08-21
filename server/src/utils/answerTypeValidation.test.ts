import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePublishedAnswerTypes } from './answerTypeValidation';

const imageOption = (text: string, imageMediaId?: string) => ({ text, imageMediaId });

test('accepts named image options backed by Media Platform asset IDs', () => {
  assert.equal(validatePublishedAnswerTypes({
    optionPresentation: 'image',
    options: [imageOption('One', 'media-1'), imageOption('Two', 'media-2')]
  }), null);
});

test('rejects image options without both an image and a name', () => {
  assert.match(validatePublishedAnswerTypes({
    optionPresentation: 'image',
    options: [imageOption('One', 'media-1'), imageOption('', 'media-2')]
  }) || '', /image and a name/i);

  assert.match(validatePublishedAnswerTypes({
    optionPresentation: 'image',
    options: [imageOption('One', 'media-1'), imageOption('Two')]
  }) || '', /image and a name/i);
});

test('does not apply multiple-choice image validation to rating payloads', () => {
  assert.equal(validatePublishedAnswerTypes({
    pollChoiceType: 'rating',
    optionPresentation: 'image',
    options: []
  }), null);
});

test('validates image answer types inside survey and quiz questions', () => {
  assert.match(validatePublishedAnswerTypes({
    sections: [{ questions: [{
      optionPresentation: 'image',
      options: [imageOption('One', 'media-1')]
    }] }]
  }) || '', /at least two image options/i);
});
