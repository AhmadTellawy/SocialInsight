const fs = require('fs');
let content = fs.readFileSync('components/SurveyCard.tsx', 'utf8');

// 1. Fix the useEffect that resets localOptions
const effectRegex = /let opts = \[\.\.\.\(s\.options \|\| \(s\.type === SurveyType\.QUIZ && s\.questions \? s\.questions\[0\]\?\.options \|\| \[\] : \(s\.type === SurveyType\.QUIZ && s\.sections \? s\.sections\.flatMap\(sec => sec\.questions \|\| \[\]\)\[0\]\?\.options \|\| \[\] : \[\]\)\) \|\| \[\]\)\];/;
const effectReplacement = `const fQuestions = s.sections ? s.sections.flatMap(section => section.questions || []) : [];
      let opts = [...(s.options && s.options.length > 0 ? s.options : (s.type === SurveyType.QUIZ && fQuestions.length > 0 ? fQuestions[0]?.options || [] : []))];`;
if (content.match(effectRegex)) {
  content = content.replace(effectRegex, effectReplacement);
  console.log('Effect replaced');
} else {
  console.log('Effect regex NOT matched');
}

// 2. Fix the duplicate consts in renderPollStandard
const dupRegex = /const renderPollStandard = \(\) => \{\s*const isHorizontal = sourceSurvey\.imageLayout === 'horizontal';\s*const isQuiz = sourceSurvey\.type === SurveyType\.QUIZ;\s*const firstQuestion = flatQuestions\?\.\[0\];\s*const isQuiz = sourceSurvey\.type === SurveyType\.QUIZ;\s*const firstQuestion = flatQuestions\?\.\[0\];\s*const allowUserOptions = sourceSurvey\.allowUserOptions \|\| false;/;
const dupReplacement = `const renderPollStandard = () => {
      const isHorizontal = sourceSurvey.imageLayout === 'horizontal';
      const isQuiz = sourceSurvey.type === SurveyType.QUIZ;
      const firstQuestion = flatQuestions?.[0];
      const allowUserOptions = sourceSurvey.allowUserOptions || false;`;

if (content.match(dupRegex)) {
  content = content.replace(dupRegex, dupReplacement);
  console.log('Dup variables replaced');
} else {
  console.log('Dup regex NOT matched');
}

// 3. Add the question image inside return
const returnRegex = /return \(\s*<div className="mt-2">\s*\{hasAddedCustomOption/;
const returnReplacement = `return (
      <div className="mt-2">
        {isQuiz && firstQuestion?.image && (
          <div className="w-full aspect-square rounded-xl overflow-hidden mb-4 border border-gray-100 shadow-sm">
            <img src={firstQuestion.image} crossOrigin="anonymous" className="w-full h-full object-cover" alt="Question context" />
          </div>
        )}
        {hasAddedCustomOption`;

if (content.match(returnRegex)) {
  content = content.replace(returnRegex, returnReplacement);
  console.log('Return replaced');
} else {
  console.log('Return regex NOT matched');
}

fs.writeFileSync('components/SurveyCard.tsx', content);
