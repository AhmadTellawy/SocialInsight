
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const posts = await prisma.post.findMany({
        select: { id: true, title: true, status: true }
    });
    console.log('Posts in DB:');
    posts.forEach(p => console.log(`- ${p.title} [${p.id}]: status=${p.status}`));

    const count = await prisma.post.count({ where: { status: 'PUBLISHED' } });
    console.log('\nPublished count:', count);
}
main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
