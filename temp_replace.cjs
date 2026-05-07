const fs = require('fs');
let content = fs.readFileSync('server/src/controllers/postController.ts', 'utf-8');
content = content.replace(/orderBy: \{ id: 'asc' \}/g, "orderBy: { order: 'asc' }");
fs.writeFileSync('server/src/controllers/postController.ts', content);
