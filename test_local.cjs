const fs = require('fs'); let c = fs.readFileSync('components/SurveyCard.tsx', 'utf8'); console.log(c.match(/useEffect\(\(\) => \{\n\s*const s = survey\.sharedFrom \|\| survey;[\s\S]{0,500}/)[0]);
