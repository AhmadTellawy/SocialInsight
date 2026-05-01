const fs = require('fs');
let content = fs.readFileSync('App.tsx', 'utf8');

const regex = /const applyVote = \(target: Survey\): Survey => \{\s*\/\/\s*1\) Completion path \(Survey\/Quiz\) => no option votes, only mark participated \+ store anon\s*if \(optionIds\.length === 0\) \{[\s\S]*?\/\/\s*2\) Poll\/Challenge vote path\s*let updatedOptions = \[\.\.\.\(target\.options \|\| \[\]\)\];\s*if \(newOption && !updatedOptions\.some\(o => o\.id === newOption\.id\)\) \{\s*updatedOptions\.push\(\{ \.\.\.newOption, votes: 0 \}\);\s*\}\s*const newOptions = updatedOptions\.map\(opt =>\s*optionIds\.includes\(opt\.id\)\s*\? \{ \.\.\.opt, votes: opt\.votes \+ 1 \}\s*: opt\s*\);\s*return \{\s*\.\.\.target,\s*options: newOptions,\s*hasParticipated: true,\s*userSelectedOptions: optionIds,\s*participants: target\.hasParticipated \? target\.participants : target\.participants \+ 1,\s*userProgress: \{\s*currentQuestionIndex: target\.userProgress\?\.currentQuestionIndex \|\| 0,\s*answers: target\.userProgress\?\.answers \|\| \{\},\s*followUpAnswers: target\.userProgress\?\.followUpAnswers \|\| \{\},\s*historyStack: target\.userProgress\?\.historyStack \|\| \[\],\s*isAnonymous: !!isAnonymous\s*\}\s*\};\s*\};\s*if \(isDirect\)/m;

const newText = `const applyVote = (target: Survey): Survey => {
          // 1) Completion path (Survey without questions/options) => no option votes, only mark participated + store anon
          if (optionIds.length === 0) {
            return {
              ...target,
              hasParticipated: true,
              participants: target.hasParticipated ? target.participants : target.participants + 1,
              userProgress: {
                currentQuestionIndex: target.userProgress?.currentQuestionIndex || 0,
                answers: target.userProgress?.answers || {},
                followUpAnswers: target.userProgress?.followUpAnswers || {},
                historyStack: target.userProgress?.historyStack || [],
                isAnonymous: !!isAnonymous
              }
            };
          }

          // 2) Quiz vote path (update options within questions)
          if (target.type === 'Quiz' || target.type === 'Survey') {
            const updatedQuestions = target.questions?.map(q => ({
              ...q,
              options: q.options?.map(opt => 
                optionIds.includes(opt.id)
                  ? { ...opt, votes: (opt.votes || 0) + 1 }
                  : opt
              )
            }));

            return {
              ...target,
              questions: updatedQuestions,
              hasParticipated: true,
              userSelectedOptions: optionIds,
              participants: target.hasParticipated ? target.participants : target.participants + 1,
              userProgress: {
                currentQuestionIndex: target.userProgress?.currentQuestionIndex || 0,
                answers: target.userProgress?.answers || {},
                followUpAnswers: target.userProgress?.followUpAnswers || {},
                historyStack: target.userProgress?.historyStack || [],
                isAnonymous: !!isAnonymous
              }
            };
          }

          // 3) Poll/Challenge vote path
          let updatedOptions = [...(target.options || [])];

          if (newOption && !updatedOptions.some(o => o.id === newOption.id)) {
            updatedOptions.push({ ...newOption, votes: 0 });
          }

          const newOptions = updatedOptions.map(opt =>
            optionIds.includes(opt.id)
              ? { ...opt, votes: (opt.votes || 0) + 1 }
              : opt
          );

          return {
            ...target,
            options: newOptions,
            hasParticipated: true,
            userSelectedOptions: optionIds,
            participants: target.hasParticipated ? target.participants : target.participants + 1,
            userProgress: {
              currentQuestionIndex: target.userProgress?.currentQuestionIndex || 0,
              answers: target.userProgress?.answers || {},
              followUpAnswers: target.userProgress?.followUpAnswers || {},
              historyStack: target.userProgress?.historyStack || [],
              isAnonymous: !!isAnonymous
            }
          };
        };

        if (isDirect)`;

if (content.match(regex)) {
  content = content.replace(regex, newText);
  fs.writeFileSync('App.tsx', content);
  console.log('App.tsx successfully updated.');
} else {
  console.log('Regex did not match.');
}
