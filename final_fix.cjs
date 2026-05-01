const fs = require('fs');
let content = fs.readFileSync('components/SurveyCard.tsx', 'utf8');

// 1. Fix flatQuestions useMemo
const flatQRegex = /const flatQuestions: FlatQuestion\[\] = useMemo\(\(\) => \{\s*const source = survey\.sharedFrom \|\| survey;\s*if \(\!source\.sections\) return \[\];\s*return source\.sections\.flatMap/;
const flatQReplacement = `const flatQuestions: FlatQuestion[] = useMemo(() => {
    const source = survey.sharedFrom || survey;
    if (source.questions && source.questions.length > 0) {
      return source.questions.map(q => ({ ...q }));
    }
    if (!source.sections) return [];
    return source.sections.flatMap`;

if (content.match(flatQRegex)) {
  content = content.replace(flatQRegex, flatQReplacement);
  console.log('Fixed flatQuestions');
} else {
  console.log('flatQuestions regex NOT matched');
}

// 2. Fix isSurveyMode
const surveyModeRegex = /const isSurveyMode = \(survey\.type === SurveyType\.SURVEY \|\| \(survey\.type === SurveyType\.QUIZ && \!\(isQuizNoTimeLimit && flatQuestions\.length === 1\)\)\) && \(survey\.sections \|\| survey\.sharedFrom\?\.sections\);/;
const surveyModeReplacement = `const isSurveyMode = (survey.type === SurveyType.SURVEY || (survey.type === SurveyType.QUIZ && !(isQuizNoTimeLimit && flatQuestions.length === 1))) && (survey.sections || survey.questions || survey.sharedFrom?.sections || survey.sharedFrom?.questions);`;

if (content.match(surveyModeRegex)) {
  content = content.replace(surveyModeRegex, surveyModeReplacement);
  console.log('Fixed isSurveyMode');
} else {
  console.log('isSurveyMode regex NOT matched');
}

// 3. Fix useEffect localOptions
const effectRegex = /let opts = \[\.\.\.\(s\.options \|\| \[\]\)\];/;
const effectReplacement = `let opts = [...(s.options || (s.type === SurveyType.QUIZ && s.questions ? s.questions[0]?.options || [] : (s.type === SurveyType.QUIZ && s.sections ? s.sections.flatMap(sec => sec.questions || [])[0]?.options || [] : [])) || [])];`;

if (content.match(effectRegex)) {
  content = content.replace(effectRegex, effectReplacement);
  console.log('Fixed useEffect');
} else {
  console.log('useEffect regex NOT matched');
}

// 4. Fix duplicate consts in renderPollStandard
const dupRegex = /const renderPollStandard = \(\) => \{\s*const isHorizontal = sourceSurvey\.imageLayout === 'horizontal';\s*const isQuiz = sourceSurvey\.type === SurveyType\.QUIZ;\s*const firstQuestion = flatQuestions\?\.\[0\];\s*const isQuiz = sourceSurvey\.type === SurveyType\.QUIZ;\s*const firstQuestion = flatQuestions\?\.\[0\];\s*const allowUserOptions = sourceSurvey\.allowUserOptions \|\| false;/;
const dupReplacement = `const renderPollStandard = () => {
    const isHorizontal = sourceSurvey.imageLayout === 'horizontal';
    const isQuiz = sourceSurvey.type === SurveyType.QUIZ;
    const firstQuestion = flatQuestions?.[0];
    const allowUserOptions = sourceSurvey.allowUserOptions || false;`;

if (content.match(dupRegex)) {
  content = content.replace(dupRegex, dupReplacement);
  console.log('Fixed dupes');
} else {
  console.log('Dupes regex NOT matched');
  
  // Try fixing if it doesn't have dupes yet
  const singleRegex = /const renderPollStandard = \(\) => \{\s*const isHorizontal = sourceSurvey\.imageLayout === 'horizontal';\s*const allowUserOptions = sourceSurvey\.allowUserOptions \|\| false;/;
  const singleReplacement = `const renderPollStandard = () => {
      const isHorizontal = sourceSurvey.imageLayout === 'horizontal';
      const isQuiz = sourceSurvey.type === SurveyType.QUIZ;
      const firstQuestion = flatQuestions?.[0];
      const allowUserOptions = sourceSurvey.allowUserOptions || false;`;
      
  if (content.match(singleRegex)) {
    content = content.replace(singleRegex, singleReplacement);
    console.log('Fixed single to include isQuiz');
  }
}

// 5. Fix return in renderPollStandard
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
  console.log('Fixed return');
} else {
  console.log('Return regex NOT matched');
}

fs.writeFileSync('components/SurveyCard.tsx', content);
