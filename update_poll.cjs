const fs = require('fs');
let content = fs.readFileSync('components/SurveyCard.tsx', 'utf8');

// 1. Update initial localOptions state
content = content.replace(
  /const \[localOptions, setLocalOptions\] = useState<Option\[\]>\(sourceSurvey\.options \|\| \[\]\);/,
  `const [localOptions, setLocalOptions] = useState<Option[]>(sourceSurvey.options || (sourceSurvey.type === 'Quiz' && sourceSurvey.questions ? sourceSurvey.questions[0]?.options || [] : (sourceSurvey.type === 'Quiz' && sourceSurvey.sections ? sourceSurvey.sections.flatMap(s => s.questions || [])[0]?.options || [] : [])) || []);`
);

// 2. Update isSurveyMode and showQuizStartCard
content = content.replace(
  /const isSurveyMode = \(survey\.type === SurveyType\.SURVEY \|\| survey\.type === SurveyType\.QUIZ\) && \(survey\.sections \|\| survey\.sharedFrom\?\.sections\);/,
  `const isQuizNoTimeLimit = survey.type === SurveyType.QUIZ && !survey.config?.timeLimit;
  const isSurveyMode = (survey.type === SurveyType.SURVEY || (survey.type === SurveyType.QUIZ && !(isQuizNoTimeLimit && flatQuestions.length === 1))) && (survey.sections || survey.sharedFrom?.sections);`
);

content = content.replace(
  /const showQuizStartCard = survey\.type === SurveyType\.QUIZ && !quizStarted && !surveyCompleted && flatQuestions\.length > 0;/,
  `const showQuizStartCard = survey.type === SurveyType.QUIZ && !quizStarted && !surveyCompleted && flatQuestions.length > 0 && !!survey.config?.timeLimit;`
);

// 3. Update renderHorizontal and renderVertical inside renderPollStandard to show correct/incorrect
content = content.replace(
  /const isPortrait = option\.image && portraitImages\.has\(option\.image\);/g,
  `const isPortrait = option.image && portraitImages.has(option.image);
          const isQuiz = sourceSurvey.type === SurveyType.QUIZ;
          const isCorrect = isQuiz && option.isCorrect;
          const isWrongSelection = isQuiz && isSelected && !isCorrect;`
);

// We need to inject the icons into the option labels.
// In renderHorizontal:
content = content.replace(
  /<div className=\{\`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black\/80 via-black\/40 to-transparent p-4 flex flex-col justify-end transition-all duration-300 \$\{hasVoted \|\| isExpired \? 'h-full bg-black\/60' : 'h-1\/2'\}\`\}>\s*<div className="flex justify-between items-end gap-2">\s*<span className="font-bold text-white text-sm leading-tight drop-shadow-md truncate">\s*\{option\.text\}\s*<\/span>/m,
  `<div className={\`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-4 flex flex-col justify-end transition-all duration-300 \${hasVoted || isExpired ? 'h-full bg-black/60' : 'h-1/2'}\`}>
                  <div className="flex justify-between items-end gap-2">
                    <span className="font-bold text-white text-sm leading-tight drop-shadow-md truncate flex items-center gap-1">
                      {option.text}
                      {shouldShowResults && isQuiz && isCorrect && <CheckCircle2 size={16} className="text-green-400 shrink-0" />}
                      {shouldShowResults && isWrongSelection && <XCircle size={16} className="text-red-400 shrink-0" />}
                    </span>`
);

content = content.replace(
  /<span className="font-medium text-gray-900 leading-tight text-sm">\s*\{option\.text\}\s*<\/span>/m,
  `<span className="font-medium text-gray-900 leading-tight text-sm flex items-center gap-1.5">
                      {option.text}
                      {shouldShowResults && isQuiz && isCorrect && <CheckCircle2 size={16} className="text-green-500 shrink-0" />}
                      {shouldShowResults && isWrongSelection && <XCircle size={16} className="text-red-500 shrink-0" />}
                    </span>`
);

// In renderVertical:
content = content.replace(
  /<span className=\{\`font-medium text-sm leading-tight \$\{hasImages \? 'line-clamp-2' : ''\} \$\{isSelected \? 'text-blue-700 font-bold' : 'text-gray-700'\}\`\}>\s*\{option\.text\}\s*<\/span>/m,
  `<span className={\`font-medium text-sm leading-tight flex items-center gap-1.5 \${hasImages ? 'line-clamp-2' : ''} \${isSelected ? 'text-blue-700 font-bold' : 'text-gray-700'}\`}>
                      {option.text}
                      {shouldShowResults && isQuiz && isCorrect && <CheckCircle2 size={16} className="text-green-500 shrink-0" />}
                      {shouldShowResults && isWrongSelection && <XCircle size={16} className="text-red-500 shrink-0" />}
                    </span>`
);

fs.writeFileSync('components/SurveyCard.tsx', content);
console.log('SurveyCard.tsx patched for single-question quiz poll mode.');
