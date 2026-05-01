const fs = require('fs');
let content = fs.readFileSync('components/SurveyCard.tsx', 'utf8');

const target = `    return (
      <div className="mb-4">
        {isHorizontal ? renderHorizontal() : renderVertical()}
`;
const replacement = `    return (
      <div className="mb-4">
        {isQuiz && firstQuestion?.image && (
          <div className="w-full aspect-square rounded-xl overflow-hidden mb-4 border border-gray-100 shadow-sm">
            <img src={firstQuestion.image} crossOrigin="anonymous" className="w-full h-full object-cover" alt="Question context" />
          </div>
        )}
        {isHorizontal ? renderHorizontal() : renderVertical()}
`;

if (content.includes(target)) {
  content = content.replace(target, replacement);
  fs.writeFileSync('components/SurveyCard.tsx', content);
  console.log('Return replaced perfectly');
} else {
  console.log('Target string NOT found');
}
