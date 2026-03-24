import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    // Author of the post: "7d4e04c7-29f0-41d9-803c-fe648e2ef89c" (a15)
    // Non-follower user: Test Setup User "a0fa82a4-9763-41b2-8a2d-603885c4e24b"
    const userId = "a0fa82a4-9763-41b2-8a2d-603885c4e24b"; 

    console.log("Testing Prisma query exactly as in getPosts:");
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
        }
    });
    
    const post6 = posts.find(p => p.title === "followers only test 6");
    if (post6) {
        console.log("POST WAS RETURNED! (BUG)");
    } else {
        console.log("Post correctly filtered.");
    }

    console.log("Total posts returned:", posts.length);
}

main().catch(console.error).finally(() => prisma.$disconnect());
