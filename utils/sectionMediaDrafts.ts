import { MediaDraft, Option, SurveyQuestion, SurveySection } from '../types';
import { createPersistedMediaDraft, createPersistedMediaDraftFromId, readyMediaAssetIds } from './mediaDrafts';
import { resolveOptionPresentation } from './optionPresentation';

export type SurveyOptionDraft = Option & { mediaDrafts: MediaDraft[] };
export type SurveyQuestionDraft = Omit<SurveyQuestion, 'options'> & {
  mediaDrafts: MediaDraft[];
  options?: SurveyOptionDraft[];
  multipleChoiceDraft?: SurveyOptionDraft[];
};
export type SurveySectionDraft = Omit<SurveySection, 'questions'> & { questions: SurveyQuestionDraft[] };

export const hydrateSections = (sections: SurveySection[]): SurveySectionDraft[] => sections.map((section) => ({
  ...section,
  questions: section.questions.map((question) => ({
    ...question,
    mediaDrafts: question.imageMedia
      ? [createPersistedMediaDraft(question.imageMedia, 'QUESTION_IMAGE', question.image)]
      : question.imageMediaId
        ? [createPersistedMediaDraftFromId(question.imageMediaId, 'QUESTION_IMAGE', question.image, 1)]
        : [],
    options: question.options?.map((option) => ({
      ...option,
      mediaDrafts: option.imageMedia
        ? [createPersistedMediaDraft(option.imageMedia, 'OPTION_IMAGE', option.image)]
        : option.imageMediaId
          ? [createPersistedMediaDraftFromId(option.imageMediaId, 'OPTION_IMAGE', option.image, 1)]
          : []
    }))
  }))
}));

export const serializeSections = (sections: SurveySectionDraft[]): SurveySection[] => sections.map((section) => ({
  ...section,
  questions: section.questions.map((question) => {
    const { mediaDrafts, multipleChoiceDraft: _multipleChoiceDraft, ...questionData } = question;
    const isRating = question.options?.some((option) => option.isRating) || false;
    const includeOptionImages = !isRating && resolveOptionPresentation(question.optionPresentation, question.options) === 'image';
    return {
      ...questionData,
      optionPresentation: isRating ? 'text' : question.optionPresentation,
      showOptionNames: isRating ? true : question.showOptionNames,
      image: mediaDrafts.length > 0 ? undefined : question.image,
      imageMediaId: readyMediaAssetIds(mediaDrafts)[0],
      options: question.options?.map((option) => {
        const { mediaDrafts: optionMedia, ...optionData } = option;
        return {
          ...optionData,
          image: includeOptionImages && optionMedia.length === 0 ? option.image : undefined,
          imageMediaId: includeOptionImages ? readyMediaAssetIds(optionMedia)[0] : undefined
        };
      })
    };
  })
}));

export const collectSectionMedia = (sections: SurveySectionDraft[], includeInactive = false): MediaDraft[] => sections.flatMap((section) =>
  section.questions.flatMap((question) => [
    ...question.mediaDrafts,
    ...(includeInactive || resolveOptionPresentation(question.optionPresentation, question.options) === 'image'
      ? (question.options || []).flatMap((option) => option.mediaDrafts)
      : []),
    ...(includeInactive ? (question.multipleChoiceDraft || []).flatMap((option) => option.mediaDrafts) : [])
  ])
);

export const collectInactiveSectionMedia = (sections: SurveySectionDraft[]): MediaDraft[] => sections.flatMap((section) =>
  section.questions.flatMap((question) => [
    ...(question.multipleChoiceDraft || []).flatMap((option) => option.mediaDrafts),
    ...(resolveOptionPresentation(question.optionPresentation, question.options) === 'text'
      ? (question.options || []).flatMap((option) => option.mediaDrafts)
      : [])
  ])
);
