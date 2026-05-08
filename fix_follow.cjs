const fs = require('fs');
const file = 'server/src/controllers/userController.ts';
let content = fs.readFileSync(file, 'utf8');

const injection = `        let isFollowing = false;
        if (req.user?.userId && req.user.userId !== user.id) {
            const follow = await prisma.follow.findUnique({
                where: { followerId_followingId: { followerId: req.user.userId, followingId: user.id } }
            });
            isFollowing = !!follow;
        }

        res.json({
            ...safeUser,
            isFollowing,`;

content = content.replace(/res\.json\(\{\s*\.\.\.safeUser,/g, injection);
fs.writeFileSync(file, content);
