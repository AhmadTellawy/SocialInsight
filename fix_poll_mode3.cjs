const fs = require('fs');
let content = fs.readFileSync('components/SurveyCard.tsx', 'utf8');

// 1. Fix the useEffect that resets localOptions
const effectRegex = /let opts = \[\.\.\.\(s\.options \|\| \(s\.type === SurveyType\.QUIZ && s\.questions \? s\.questions\[0\]\?\.options \|\| \[\] : \(s\.type === SurveyType\.QUIZ && s\.sections \? s\.sections\.flatMap\(sec => sec\.questions \|\| \[\]\)\[0\]\?\.options \|\| \[\] : \[\]\)\) \|\| \[\]\)\];/;
const effectReplacement = `const fQuestions = s.sections ? s.sections.flatMap(section => section.questions || []) : [];
      let opts = [...(s.options && s.options.length > 0 ? s.options : (s.type === SurveyType.QUIZ && fQuestions.length > 0 ? fQuestions[0]?.options || [] : []))];`;

if (content.match(effectRegex)) {
  content = content.replace(effectRegex, effectReplacement);
} else {
  console.log('Effect regex failed');
}

// 2. Add question image and description to renderPollStandard if it's a quiz
const pollRegex = /const renderPollStandard = \(\) => \{\s*const isHorizontal = sourceSurvey\.imageLayout === 'horizontal';\s*const isQuiz = sourceSurvey\.type === SurveyType\.QUIZ;\s*const firstQuestion = flatQuestions\?\.\[0\];\s*const allowUserOptions = sourceSurvey\.allowUserOptions \|\| false;/;

if (content.match(pollRegex)) {
  // It's already there
  console.log('poll is already patched');
} else {
  const pollRegex2 = /const renderPollStandard = \(\) => \{\s*const isHorizontal = sourceSurvey\.imageLayout === 'horizontal';\s*const allowUserOptions = sourceSurvey\.allowUserOptions \|\| false;/;
  const pollReplacement2 = `const renderPollStandard = () => {
      const isHorizontal = sourceSurvey.imageLayout === 'horizontal';
      const isQuiz = sourceSurvey.type === SurveyType.QUIZ;
      const firstQuestion = flatQuestions?.[0];
      const allowUserOptions = sourceSurvey.allowUserOptions || false;`;
  if (content.match(pollRegex2)) {
    content = content.replace(pollRegex2, pollReplacement2);
  } else {
    console.log('poll regex2 failed');
  }
}


const renderReturnRegex = /return \(\s*<div className="mt-2">\s*\{isQuiz && firstQuestion\?\.image/;
if (content.match(renderReturnRegex)) {
    console.log('already patched return');
} else {
  const renderReturnRegex2 = /return \(\s*<div className="mt-2">\s*\{hasAddedCustomOption/;
  const renderReturnReplacement2 = `return (
      <div className="mt-2">
        {isQuiz && firstQuestion?.image && (
          <div className="w-full aspect-square rounded-xl overflow-hidden mb-4 border border-gray-100 shadow-sm">
            <img src={firstQuestion.image} crossOrigin="anonymous" className="w-full h-full object-cover" alt="Question context" />
          </div>
        )}
        {hasAddedCustomOption`;

  if (content.match(renderReturnRegex2)) {
    content = content.replace(renderReturnRegex2, renderReturnReplacement2);
  } else {
    console.log('Render return regex 2 failed');
  }
}

fs.writeFileSync('components/SurveyCard.tsx', content);
console.log('SurveyCard.tsx patched to fix 1-question quiz poll mode rendering.');
