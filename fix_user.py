import os

file_path = r'c:\Users\ABC\Downloads\socialinsight\server\src\controllers\userController.ts'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

target = """        res.json({
            ...safeUser,
            isFollowing,
            demographics: demographics || {},
            stats: {
                followers: user.followersCount,
                following: user.followingCount,
                responses: 0
            }
        });"""

replacement = """        const [postsCount, responsesCount] = await Promise.all([
            prisma.post.count({
                where: { authorId: user.id, isDeleted: false, status: 'PUBLISHED' }
            }),
            prisma.response.count({
                where: { post: { authorId: user.id } }
            })
        ]);

        res.json({
            ...safeUser,
            isFollowing,
            demographics: demographics || {},
            stats: {
                followers: user.followersCount,
                following: user.followingCount,
                posts: postsCount,
                responses: responsesCount
            }
        });"""

content = content.replace(target, replacement)
with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Done")
