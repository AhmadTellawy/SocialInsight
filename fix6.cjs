const fs = require('fs');
let content = fs.readFileSync('components/SurveyCard.tsx', 'utf8');

const regex = /    return \(\s*<div className="mb-4">\s*\{isHorizontal \? renderHorizontal\(\) : renderVertical\(\)\}/;
const replacement = `    return (
      <div className="mb-4">
        {isQuiz && firstQuestion?.image && (
          <div className="w-full aspect-square rounded-xl overflow-hidden mb-4 border border-gray-100 shadow-sm">
            <img src={firstQuestion.image} crossOrigin="anonymous" className="w-full h-full object-cover" alt="Question context" />
          </div>
        )}
        {isHorizontal ? renderHorizontal() : renderVertical()}`;

if (content.match(regex)) {
  content = content.replace(regex, replacement);
  fs.writeFileSync('components/SurveyCard.tsx', content);
  console.log('Return replaced perfectly');
} else {
  console.log('Target regex NOT found');
}
