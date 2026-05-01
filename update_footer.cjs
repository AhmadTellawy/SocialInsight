const fs = require('fs');
let content = fs.readFileSync('components/SurveyCard.tsx', 'utf8');

const regex = /<div className="px-5 py-4 border-t border-gray-50 flex items-center justify-between bg-white relative z-10">[\s\S]*?<\/div>\s*<\/div>\s*\);\s*\};\s*const renderPollStandard =/m;

const replacement = `{!isQuizNoTimeLimit && (
            <div className="px-5 py-4 border-t border-gray-50 flex items-center justify-between bg-white relative z-10">
              <button onClick={handlePrevQuestion} disabled={currentQIndex === 0 && historyStack.length === 0} className={\`flex items-center gap-1 text-sm font-medium transition-colors \${(currentQIndex === 0 && historyStack.length === 0) ? 'text-gray-300 cursor-not-allowed' : 'text-gray-500 hover:text-gray-800'}\`}>
                <ChevronLeft size={18} /> {/*t('Back')*/}Back
              </button>
              <button onClick={() => handleNextQuestion()} disabled={(!answer || (Array.isArray(answer) && answer.length === 0) || (typeof answer === 'string' && !answer.trim())) || (currentQuestion.minSelection && (Array.isArray(answer) ? answer.length : 1) < currentQuestion.minSelection)} className={\`px-6 py-2 rounded-full text-sm font-bold text-white transition-all shadow-md flex items-center gap-2 \${(!answer || (Array.isArray(answer) && answer.length === 0) || (typeof answer === 'string' && !answer.trim())) || (currentQuestion.minSelection && (Array.isArray(answer) ? answer.length : 1) < currentQuestion.minSelection) ? 'bg-gray-300 cursor-not-allowed' : 'bg-gray-900 hover:bg-gray-800 active:scale-[0.99]'}\`}>{currentQIndex >= totalQuestions - 1 ? /*t('Finish')*/'Finish' : /*t('Next')*/'Next'} <ArrowRight size={14} /></button>
            </div>
          )}
        </div>
      );
    };

    const renderPollStandard =`;

if (content.match(regex)) {
  content = content.replace(regex, replacement);
  fs.writeFileSync('components/SurveyCard.tsx', content);
  console.log('SurveyCard.tsx patched to hide footer for no-timer quizzes.');
} else {
  console.log('Regex did not match.');
}
