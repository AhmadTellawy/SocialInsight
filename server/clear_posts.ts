import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    try {
        console.log('🧹 Starting cleanup...');

        // 1. Delete Responses
        const deletedResponses = await prisma.response.deleteMany({});
        console.log(`✅ Deleted ${deletedResponses.count} Responses`);

        // 2. Delete dependencies (Saved/Hidden/Reports)
        await prisma.savedPost.deleteMany({});
        await prisma.hiddenPost.deleteMany({});
        await prisma.report.deleteMany({ where: { targetType: 'POST' } });
        console.log('✅ Deleted Post dependencies (Saved, Hidden, Reports)');

        // 3. Delete Options & Questions (if cascade delete is not set at DB level, safer to do explicit)
        await prisma.option.deleteMany({});
        await prisma.question.deleteMany({});
        console.log('✅ Deleted Questions & Options');

        // 4. Delete Posts
        const deletedPosts = await prisma.post.deleteMany({});
        console.log(`✅ Deleted ${deletedPosts.count} Posts`);

        console.log('✨ Database cleaned successfully!');
    } catch (e) {
        console.error('❌ Error cleaning database:', e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
