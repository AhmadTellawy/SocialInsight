const fs = require('fs');
let content = fs.readFileSync('components/SurveyCard.tsx', 'utf8');

const regex = /if \(onSurveyProgress\) \{\s*onSurveyProgress\(sourceSurvey\.id, \{\s*index: currentQIndex,\s*answers: newAnswers,\s*followUpAnswers,\s*historyStack,\s*isAnonymous: isCurrentlyAnonymous\s*\}\);\s*\}/m;

const replacement = `if (onSurveyProgress) {
        onSurveyProgress(sourceSurvey.id, {
          index: currentQIndex,
          answers: newAnswers,
          followUpAnswers,
          historyStack,
          isAnonymous: isCurrentlyAnonymous
        });
      }
      
      // Auto-advance for quizzes if no time limit
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
               // Finish Quiz
               if (onVote) {
                 const allSelectedOptionIds = Object.values(newAnswers).flat().filter(Boolean);
                 onVote(sourceSurvey.id, allSelectedOptionIds, isCurrentlyAnonymous, undefined);
               }
               setSurveyCompleted(true);
            }
         }, 400); // slight delay
      }`;

if (content.match(regex)) {
  content = content.replace(regex, replacement);
  fs.writeFileSync('components/SurveyCard.tsx', content);
  console.log('SurveyCard.tsx patched for auto-advance.');
} else {
  console.log('Regex did not match.');
}
