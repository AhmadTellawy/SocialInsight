import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const userId = "a0fa82a4-9763-41b2-8a2d-603885c4e24b"; // Test Setup User

    const posts = await prisma.post.findMany({
        where: {
            OR: [
                { targetAudience: { not: 'Followers' } },
                { authorId: userId },
                {
                    author: {
                        following: {
                            some: { followerId: userId }
                        }
                    }
                }
            ]
        },
        select: {
            id: true,
            title: true,
            targetAudience: true,
            authorId: true,
            author: {
                select: {
                    id: true,
                    handle: true,
                    following: {
                        where: { followerId: userId },
                        select: { followerId: true }
                    }
                }
            }
        }
    });
    console.log(JSON.stringify(posts, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
