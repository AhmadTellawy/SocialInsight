import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const posts = await prisma.post.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
            id: true,
            title: true,
            targetAudience: true,
            authorId: true,
            author: { select: { name: true, handle: true } }
        }
    });
    console.log(JSON.stringify(posts, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
