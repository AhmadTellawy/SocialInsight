const fs = require('fs');
let content = fs.readFileSync('components/SurveyCard.tsx', 'utf8');

// 1. Fix the useEffect that resets localOptions
const effectRegex = /let opts = \[\.\.\.\(s\.options \|\| \[\]\)\];/;
const effectReplacement = `let opts = [...(s.options || (s.type === SurveyType.QUIZ && s.questions ? s.questions[0]?.options || [] : (s.type === SurveyType.QUIZ && s.sections ? s.sections.flatMap(sec => sec.questions || [])[0]?.options || [] : [])) || [])];`;

if (content.match(effectRegex)) {
  content = content.replace(effectRegex, effectReplacement);
} else {
  console.log('Effect regex failed');
}

// 2. Add question image and description to renderPollStandard if it's a quiz
const pollRegex = /const renderPollStandard = \(\) => \{\s*const isHorizontal = sourceSurvey\.imageLayout === 'horizontal';/;
const pollReplacement = `const renderPollStandard = () => {
    const isHorizontal = sourceSurvey.imageLayout === 'horizontal';
    const isQuiz = sourceSurvey.type === SurveyType.QUIZ;
    const firstQuestion = flatQuestions?.[0];`;

if (content.match(pollRegex)) {
  content = content.replace(pollRegex, pollReplacement);
} else {
  console.log('Poll regex failed');
}

const renderReturnRegex = /return \(\s*<div className="mt-2">\s*\{hasAddedCustomOption/;
const renderReturnReplacement = `return (
      <div className="mt-2">
        {isQuiz && firstQuestion?.image && (
          <div className="w-full aspect-square rounded-xl overflow-hidden mb-4 border border-gray-100 shadow-sm">
            <img src={firstQuestion.image} crossOrigin="anonymous" className="w-full h-full object-cover" alt="Question context" />
          </div>
        )}
        {hasAddedCustomOption`;

if (content.match(renderReturnRegex)) {
  content = content.replace(renderReturnRegex, renderReturnReplacement);
} else {
  console.log('Render return regex failed');
}

fs.writeFileSync('components/SurveyCard.tsx', content);
console.log('SurveyCard.tsx patched to fix 1-question quiz poll mode rendering.');
