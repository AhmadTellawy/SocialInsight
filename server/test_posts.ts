import { PrismaClient } from '@prisma/client';
import { SAFE_USER_SELECT, normalizePostType, parseJsonArray } from './src/controllers/postController';

const prisma = new PrismaClient();

async function testGetPosts() {
    const id = "f89c9cdb-3d9d-43d0-b305-d55ec810c5e2"; // some group ID
    try {
        const posts = await prisma.post.findMany({
            where: {
                targetGroups: {
                    contains: `"${id}"`
                }
            },
            take: 10,
            skip: 0,
            orderBy: { createdAt: 'desc' },
            include: {
                author: {
                    select: {
                        ...SAFE_USER_SELECT,
                        following: false
                    }
                },
                questions: { include: { options: true } },
                sections: { include: { questions: { include: { options: true } } } },
                responses: false,
                likes: false,
                savedBy: false
            }
        });
        console.log("Found posts:", posts.length);
    } catch (e) {
        console.error("Prisma error:", e);
    }
}

testGetPosts().finally(() => prisma.$disconnect());
