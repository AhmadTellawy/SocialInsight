const fs = require('fs');
let content = fs.readFileSync('components/ProfileSettingsScreen.tsx', 'utf8');

const newText = `            <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm m-5 mb-6">
              <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">{t('Why we ask?')}</h4>
              <div className="text-sm text-gray-600 leading-relaxed space-y-4">
                <p>{t('Sharing demographic information helps you and post creators get more relevant and meaningful insights.')}</p>
                <p>{t('It also improves your experience and helps us keep the platform safe and fair.')}</p>
                <p>{t('Your data is anonymized and used in aggregate — never shared in a way that identifies you.')}</p>
                <p>
                  <button onClick={() => navigate('/privacy')} className="text-blue-600 hover:underline font-medium">
                    {t('Learn more in our Privacy Policy.')}
                  </button>
                </p>
              </div>
            </div>`;

const regex = /<div className=\"bg-white rounded-2xl border border-gray-100 p-5 shadow-sm m-5 mb-6\">\s*<h4 className=\"text-xs font-black text-gray-400 uppercase tracking-widest mb-4\">Why we ask\?<\/h4>\s*<p className=\"text-sm text-gray-600 leading-relaxed\">[\s\S]*?<\/p>\s*<\/div>/g;

if(regex.test(content)) {
    content = content.replace(regex, newText);
    fs.writeFileSync('components/ProfileSettingsScreen.tsx', content);
    console.log('Successfully replaced text via regex.');
} else {
    console.log('Could not find text to replace.');
}
