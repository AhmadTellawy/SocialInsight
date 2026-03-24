const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

p.post.findFirst({
  where: { title: 't' },
  include: { questions: { include: { options: true } } },
  orderBy: { createdAt: 'desc' }
}).then(p => {
  console.log(JSON.stringify(p, null, 2));
}).catch(e => {
  console.error(e);
}).finally(() => {
  p.$disconnect();
});
