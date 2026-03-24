import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const authorId = "7d4e04c7-29f0-41d9-803c-fe648e2ef89c"; // a15

    const followers = await prisma.follow.findMany({
        where: { followingId: authorId },
        include: { follower: { select: { id: true, handle: true } } }
    });

    console.log(`Followers of a15: ${followers.length}`);
    console.log(JSON.stringify(followers, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
