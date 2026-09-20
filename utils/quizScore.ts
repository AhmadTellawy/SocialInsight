export interface QuizScoreOption {
  id: string;
  isCorrect?: boolean;
}

export interface QuizScoreQuestion {
  id: string;
  correctOptionId?: string | null;
  options?: QuizScoreOption[] | null;
}

export interface QuizScore {
  correct: number;
  total: number;
}

export const getCorrectOptionIds = (question: QuizScoreQuestion): string[] => {
  const ids = new Set<string>();
  if (question.correctOptionId) ids.add(question.correctOptionId);
  question.options?.forEach(option => {
    if (option.isCorrect === true) ids.add(option.id);
  });
  return [...ids];
};

const selectedAnswerIds = (answers: Record<string, unknown>, questionId: string): string[] => {
  if (!Object.prototype.hasOwnProperty.call(answers, questionId)) return [];
  const answer = answers[questionId];
  if (answer === null || answer === undefined || answer === '') return [];
  return (Array.isArray(answer) ? answer : [answer])
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
};

export const calculateQuizScore = (
  questions: readonly QuizScoreQuestion[] | null | undefined,
  answers: Record<string, unknown> | null | undefined
): QuizScore | null => {
  if (!questions?.length || !answers) return null;

  let correct = 0;
  for (const question of questions) {
    const correctIds = new Set(getCorrectOptionIds(question));

    if (correctIds.size === 0) return null;

    // An explicit progress object is authoritative for a completed quiz.
    // Questions skipped by branching or timeout are real incorrect answers.
    const selectedIds = selectedAnswerIds(answers, question.id);

    const isCorrect = correctIds.size > 1
      ? correctIds.size === selectedIds.length && selectedIds.every(id => correctIds.has(id))
      : selectedIds.some(id => correctIds.has(id));
    if (isCorrect) correct += 1;
  }

  return { correct, total: questions.length };
};
