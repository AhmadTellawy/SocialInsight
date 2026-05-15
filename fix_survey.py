import sys

file_path = r'c:\Users\ABC\Downloads\socialinsight\components\SurveyCard.tsx'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Fix 1: handleSurveyAnswer timeout and removing onContentClick
old_handle_survey = '''      // Auto-advance for quizzes if no time limit
      if (isQuiz && !survey.config?.timeLimit) {
         if (!isDetailView && onContentClick) {
             onContentClick();
         }
         setTimeout(() => {
            if (currentQIndex < totalQuestions - 1) {
               // handleNext logic manually to avoid closure issues
               setSlideDirection('next');
               const newStack = [...historyStack, currentQIndex];
               setHistoryStack(newStack);
               setCurrentQIndex(currentQIndex + 1);
               if (onSurveyProgress) {
                 onSurveyProgress(sourceSurvey.id, {
                   index: currentQIndex + 1,
                   answers: newAnswers,
                   followUpAnswers,
                   historyStack: newStack,
                   isAnonymous: isCurrentlyAnonymous
                 });
               }
            } else {
               // submit if last question
               if (onSurveySubmit) {
                  onSurveySubmit(sourceSurvey.id, newAnswers, followUpAnswers);
               }
            }
         }, 0);
      }'''

new_handle_survey = '''      // Auto-advance for quizzes if no time limit
      if (isQuiz && !survey.config?.timeLimit) {
         setTimeout(() => {
            if (currentQIndex < totalQuestions - 1) {
               // handleNext logic manually to avoid closure issues
               setSlideDirection('next');
               const newStack = [...historyStack, currentQIndex];
               setHistoryStack(newStack);
               setCurrentQIndex(currentQIndex + 1);
               if (onSurveyProgress) {
                 onSurveyProgress(sourceSurvey.id, {
                   index: currentQIndex + 1,
                   answers: newAnswers,
                   followUpAnswers,
                   historyStack: newStack,
                   isAnonymous: isCurrentlyAnonymous
                 });
               }
            } else {
               // submit if last question
               if (onSurveySubmit) {
                  onSurveySubmit(sourceSurvey.id, newAnswers, followUpAnswers);
               }
            }
         }, 1500);
      }'''

content = content.replace(old_handle_survey, new_handle_survey)


# Fix 2: show colors in renderSurveyInteractive
old_render_interactive = '''                      const selectedIds = Array.isArray(answer) ? answer : (answer ? [answer] : []);
                      const isSelected = selectedIds.includes(opt.id);
                      const isMaxReached = !isTF && currentQuestion.maxSelection && (currentQuestion.maxSelection || 1) > 1 && selectedIds.length >= (currentQuestion.maxSelection || 1) && !isSelected;
                      const isPortrait = opt.image && portraitImages.has(opt.image);

                      return (
                        <div key={opt.id} className={`group ${isHorizontal && !isTF ? 'min-w-[51%] snap-center' : ''}`}>
                          <button onClick={() => handleSurveyAnswer(opt.id)} disabled={isMaxReached as boolean} className={`w-full text-left p-3 rounded-xl border transition-all duration-200 flex items-center justify-between active:scale-[0.99] h-auto ${isSelected ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm' : isMaxReached ? 'opacity-50 border-gray-100 bg-gray-50' : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50/30 active:scale-[0.99]'} ${isTF ? 'flex-col gap-2 items-center text-center justify-center py-6' : ''} ${isHorizontal && opt.image ? 'flex-col items-stretch p-1 pb-3' : ''}`}>'''

new_render_interactive = '''                      const selectedIds = Array.isArray(answer) ? answer : (answer ? [answer] : []);
                      const isSelected = selectedIds.includes(opt.id);
                      const hasVotedCurrent = selectedIds.length > 0;
                      const isCorrect = isQuiz && opt.isCorrect;
                      const isWrongSelection = isQuiz && isSelected && !isCorrect;
                      const isMaxReached = !isTF && currentQuestion.maxSelection && (currentQuestion.maxSelection || 1) > 1 && selectedIds.length >= (currentQuestion.maxSelection || 1) && !isSelected;
                      const isPortrait = opt.image && portraitImages.has(opt.image);

                      return (
                        <div key={opt.id} className={`group relative ${isHorizontal && !isTF ? 'min-w-[51%] snap-center' : ''}`}>
                          <button onClick={() => handleSurveyAnswer(opt.id)} disabled={(isMaxReached || (hasVotedCurrent && isQuiz)) as boolean} className={`w-full text-left p-3 rounded-xl border transition-all duration-200 flex items-center justify-between active:scale-[0.99] h-auto ${hasVotedCurrent && isQuiz ? (isCorrect ? 'border-green-500 bg-green-50 text-green-700 ring-1 ring-green-500/20 shadow-sm' : isWrongSelection ? 'border-red-500 bg-red-50 text-red-700 ring-1 ring-red-500/20 shadow-sm' : 'border-gray-100 bg-gray-50 opacity-50') : isSelected ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm' : isMaxReached ? 'opacity-50 border-gray-100 bg-gray-50' : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50/30 active:scale-[0.99]'} ${isTF ? 'flex-col gap-2 items-center text-center justify-center py-6' : ''} ${isHorizontal && opt.image ? 'flex-col items-stretch p-1 pb-3' : ''}`}>'''
content = content.replace(old_render_interactive, new_render_interactive)

# Fix 3: add checkmark for correct/wrong answers in renderSurveyInteractive
old_check = '''                              {opt.isRating ? ('''
new_check = '''                              {hasVotedCurrent && isQuiz && isCorrect && <CheckCircle2 size={18} className="text-green-600 shrink-0" />}
                              {hasVotedCurrent && isQuiz && isWrongSelection && <X size={18} className="text-red-600 shrink-0" />}
                              {opt.isRating ? ('''
content = content.replace(old_check, new_check)


with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print('Updated SurveyCard.tsx')
