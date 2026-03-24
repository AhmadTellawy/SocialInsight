const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const followerId = '5d61f365-5204-44da-9c7b-bbff49aec985'; // Ahmad
    const followingId = '902abe07-b51e-4fa4-a3f6-f3c3a15b3bb2'; // Target User

    console.log(`Checking posts for follower: ${followerId}`);

    // Simulate what the controller does
    const posts = await prisma.post.findMany({
        where: { authorId: followingId }, // Limit to target user for clarity
        include: {
            author: {
                include: {
                    following: {
                        where: { followerId: followerId },
                        select: { followerId: true }
                    }
                }
            }
        },
        take: 1
    });

    if (posts.length > 0) {
        const p = posts[0];
        console.log('Post ID:', p.id);
        console.log('Author ID:', p.author.id);
        console.log('Following:', JSON.stringify(p.author.following));

        const isFollowing = (p.author.following && p.author.following.length > 0);
        console.log('Calculated isFollowing:', isFollowing);
    } else {
        console.log('No posts found for this author.');
    }

}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
