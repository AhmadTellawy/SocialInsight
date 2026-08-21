type AnswerOptionInput = {
  text?: unknown;
  image?: unknown;
  imageMediaId?: unknown;
  isRating?: unknown;
};

type AnswerQuestionInput = {
  optionPresentation?: unknown;
  options?: unknown;
};

type AnswerSectionInput = {
  questions?: unknown;
};

const hasNonEmptyString = (value: unknown): boolean =>
  typeof value === 'string' && value.trim().length > 0;

const validateImageOptions = (options: unknown, context: string): string | null => {
  if (!Array.isArray(options) || options.length < 2) {
    return `${context} requires at least two image options.`;
  }

  const invalidOption = (options as AnswerOptionInput[]).find((option) =>
    !hasNonEmptyString(option?.text)
    || (!hasNonEmptyString(option?.imageMediaId) && !hasNonEmptyString(option?.image))
  );

  return invalidOption ? `${context} requires an image and a name for every option.` : null;
};

export const validatePublishedAnswerTypes = (payload: Record<string, unknown>): string | null => {
  if (payload.pollChoiceType !== 'rating' && payload.optionPresentation === 'image') {
    const error = validateImageOptions(payload.options, 'Image answer type');
    if (error) return error;
  }

  if (!Array.isArray(payload.sections)) return null;

  for (const [sectionIndex, section] of (payload.sections as AnswerSectionInput[]).entries()) {
    if (!Array.isArray(section?.questions)) continue;
    for (const [questionIndex, question] of (section.questions as AnswerQuestionInput[]).entries()) {
      const options = Array.isArray(question?.options) ? question.options as AnswerOptionInput[] : [];
      const isRating = options.some((option) => option?.isRating === true);
      if (!isRating && question?.optionPresentation === 'image') {
        const context = `Section ${sectionIndex + 1}, question ${questionIndex + 1}`;
        const error = validateImageOptions(options, context);
        if (error) return error;
      }
    }
  }

  return null;
};
