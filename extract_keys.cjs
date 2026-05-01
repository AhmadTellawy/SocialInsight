const fs = require('fs');

const files = [];
function findFiles(dir) {
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = dir + '/' + item;
    if (fs.statSync(fullPath).isDirectory()) {
      findFiles(fullPath);
    } else if (fullPath.endsWith('.tsx') || fullPath.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
}
findFiles('./components');

const enPath = './locales/en/translation.json';
const enTranslations = JSON.parse(fs.readFileSync(enPath, 'utf8'));

let added = 0;
for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const regex = /t\(['"`]([\s\S]*?)['"`]\)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const key = match[1];
    if (!enTranslations[key]) {
      enTranslations[key] = key;
      added++;
    }
  }
}

fs.writeFileSync(enPath, JSON.stringify(enTranslations, null, 2));
console.log('Added ' + added + ' new keys to en/translation.json');
