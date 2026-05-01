const fs = require('fs');
let content = fs.readFileSync('components/SurveyCard.tsx', 'utf8');

const regex = /<div className="bg-gray-50 px-4 py-3 border-b border-gray-100">[\s\S]*?<\/div>\s*<\/div>/m;

const replacement = `{survey.type === SurveyType.QUIZ && !survey.config?.timeLimit ? (
            <div className="bg-white px-4 py-4 border-b border-gray-100">
              {totalQuestions <= 7 ? (
                <div className="flex items-center justify-between relative w-full">
                  {/* Background connecting line */}
                  <div className="absolute left-0 right-0 top-1/2 h-0.5 bg-blue-100 -translate-y-1/2 z-0" />
                  
                  {Array.from({ length: totalQuestions }).map((_, i) => {
                    const isCompleted = i < currentQIndex;
                    const isCurrent = i === currentQIndex;
                    
                    return (
                      <div key={i} className="relative z-10 flex flex-col items-center gap-1.5 bg-white px-1">
                        <div className={\`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 \${
                          isCompleted ? 'bg-blue-500 text-white' : 
                          isCurrent ? 'border-2 border-blue-500 text-blue-500 shadow-[0_0_0_3px_white,0_0_0_4px_rgba(59,130,246,0.3)]' : 
                          'border-2 border-blue-200 text-blue-300 bg-white'
                        }\`}>
                          {isCompleted ? <Check size={16} strokeWidth={3} /> : <span className="text-sm font-bold">{i + 1}</span>}
                        </div>
                        <div className={\`w-6 h-1 rounded-full \${isCompleted || isCurrent ? 'bg-blue-500' : 'bg-transparent'}\`} />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center font-bold text-gray-500 text-sm py-2">
                  Question {currentQIndex + 1} of {totalQuestions}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-gray-50 px-4 py-3 border-b border-gray-100">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-bold text-blue-600 uppercase tracking-wider flex items-center gap-1">
                  <FileText size={10} /> {currentQuestion.sectionTitle}
                </span>
                <span className="text-xs font-medium text-gray-400 tabular-nums">
                  {currentQIndex + 1} / {totalQuestions}
                </span>
              </div>
              <div className="h-1.5 w-full bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-blue-600 rounded-full transition-all duration-500 ease-out" style={{ width: \`\${Math.max(5, progressPercentage)}%\` }} />
              </div>
            </div>
          )}`;

if (content.match(regex)) {
  content = content.replace(regex, replacement);
  fs.writeFileSync('components/SurveyCard.tsx', content);
  console.log('SurveyCard.tsx patched for QuizProgressBar.');
} else {
  console.log('Regex did not match.');
}
