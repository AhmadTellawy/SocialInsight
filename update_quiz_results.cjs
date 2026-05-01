const fs = require('fs');
let content = fs.readFileSync('components/SurveyCard.tsx', 'utf8');

const regex = /const renderQuizCompletion = \(\) => \{[\s\S]*?return null;\s*\};\s*const renderSurveyCompletion/m;

const replacement = `const renderQuizCompletion = () => {
      const correct = quizStats?.correct || 0;
      const total = quizStats?.total || 1;
      const percentage = (correct / total) * 100;
      
      let title = t('Good Effort!');
      let subtitle = t('Keep practicing, you will get better!');
      let bgColor = 'bg-blue-50';
      let iconColor = 'text-blue-500';
      let topPercent = 0;

      if (percentage === 100) {
        title = t('Perfect Score!');
        subtitle = t('You are an absolute expert!');
        bgColor = 'bg-yellow-50';
        iconColor = 'text-yellow-500';
        topPercent = 1;
      } else if (percentage >= 80) {
        title = t('Excellent Work!');
        subtitle = t('You did a fantastic job!');
        bgColor = 'bg-green-50';
        iconColor = 'text-green-500';
        topPercent = 15;
      } else if (percentage >= 50) {
        title = t('Well Done!');
        subtitle = t('You passed the quiz successfully.');
        bgColor = 'bg-blue-50';
        iconColor = 'text-blue-500';
        topPercent = Math.max(20, Math.round(100 - percentage));
      } else {
        topPercent = Math.max(50, Math.round(100 - percentage));
      }

      return (
        <div className="mt-4 animate-in fade-in duration-500 border border-gray-100 rounded-2xl overflow-hidden shadow-sm bg-white">
          <div className={\`p-8 text-center flex flex-col items-center justify-center \${bgColor}\`}>
            <div className={\`w-20 h-20 rounded-full flex items-center justify-center bg-white shadow-sm mb-4 \${iconColor}\`}>
              {percentage === 100 ? <Trophy size={40} /> : percentage >= 50 ? <CheckCircle2 size={40} /> : <Target size={40} />}
            </div>
            <h3 className="text-2xl font-black text-gray-900 mb-2">{title}</h3>
            <p className="text-gray-600 mb-6 font-medium">{subtitle}</p>
            
            <div className="flex items-center gap-6 bg-white px-6 py-4 rounded-2xl shadow-sm border border-gray-100 w-full max-w-sm">
              <div className="flex-1 text-center">
                <div className="text-3xl font-black text-gray-900">{correct}</div>
                <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t('Correct')}</div>
              </div>
              <div className="w-px h-12 bg-gray-100" />
              <div className="flex-1 text-center">
                <div className="text-3xl font-black text-gray-900">{total}</div>
                <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t('Questions')}</div>
              </div>
            </div>
          </div>
          
          <div className="p-6 bg-white text-center">
            <div className="inline-flex items-center gap-2 bg-blue-50 text-blue-700 px-4 py-2 rounded-lg text-sm font-bold border border-blue-100 mb-4">
              <TrendingUp size={16} />
              {t('You are in the top')} {topPercent}% {t('of participants so far!')}
            </div>
            <p className="text-xs text-gray-400 mb-0">
              {sourceSurvey.participants || 1} {t('people have taken this quiz.')}
            </p>
          </div>
        </div>
      );
    };

    const renderSurveyCompletion`;

if (content.match(regex)) {
  content = content.replace(regex, replacement);
  fs.writeFileSync('components/SurveyCard.tsx', content);
  console.log('SurveyCard.tsx patched for Quiz results.');
} else {
  console.log('Regex did not match.');
}
