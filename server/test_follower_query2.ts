import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    // What if userId is undefined?
    const userId = undefined; 

    console.log("Testing Prisma query exactly as in getPosts with undefined userId:");
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
