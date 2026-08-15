import { MediaDraft, Option, SurveyQuestion, SurveySection } from '../types';
import { createPersistedMediaDraft, createPersistedMediaDraftFromId, readyMediaAssetIds } from './mediaDrafts';

export type SurveyOptionDraft = Option & { mediaDrafts: MediaDraft[] };
export type SurveyQuestionDraft = Omit<SurveyQuestion, 'options'> & {
  mediaDrafts: MediaDraft[];
  options?: SurveyOptionDraft[];
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
    const { mediaDrafts, ...questionData } = question;
    return {
      ...questionData,
      image: mediaDrafts.length > 0 ? undefined : question.image,
      imageMediaId: readyMediaAssetIds(mediaDrafts)[0],
      options: question.options?.map((option) => {
        const { mediaDrafts: optionMedia, ...optionData } = option;
        return {
          ...optionData,
          image: optionMedia.length > 0 ? undefined : option.image,
          imageMediaId: readyMediaAssetIds(optionMedia)[0]
        };
      })
    };
  })
}));

export const collectSectionMedia = (sections: SurveySectionDraft[]): MediaDraft[] => sections.flatMap((section) =>
  section.questions.flatMap((question) => [
    ...question.mediaDrafts,
    ...(question.options || []).flatMap((option) => option.mediaDrafts)
  ])
);
