const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.userLike.findMany({ include: { user: true } }).then(async (likes: any[]) => {
    if (likes.length > 0) {
        const like = likes[0];
        const resp = await fetch(`http://localhost:3001/api/posts/${like.postId}/likes`);
        const data = await resp.json();
        console.log("Likers JSON:", JSON.stringify(data, null, 2));
    }
}).finally(() => p.$disconnect());
