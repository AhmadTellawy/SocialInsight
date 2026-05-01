const fs = require('fs');
let content = fs.readFileSync('components/SurveyCard.tsx', 'utf8');

content = content.replace(
  /className=\	ext-sm font-bold transition-all/g,
  'className={	ext-xs font-bold transition-all'
);

content = content.replace(
  /text-\[15px\] cursor-pointer hover:underline/g,
  'text-sm cursor-pointer hover:underline'
);

content = content.replace(
  /text-base text-gray-900 leading-tight whitespace-pre-wrap/g,
  'text-[15px] text-gray-900 leading-snug whitespace-pre-wrap'
);

content = content.replace(
  /justify-between px-1 pt-1 pb-1/g,
  'justify-between px-5 pt-1 pb-1'
);

content = content.replace(
  /<MessageCircle size=\{18\}/g,
  '<MessageCircle size={16}'
);

content = content.replace(
  /<Repeat size=\{18\}/g,
  '<Repeat size={16}'
);

content = content.replace(
  /text-\[12px\] pr-1 font-bold/g,
  'text-[11px] pr-1 font-bold'
);

fs.writeFileSync('components/SurveyCard.tsx', content);
console.log('done');

