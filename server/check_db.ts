import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    try {
        const userCount = await prisma.user.count();
        console.log(`✅ Database Connected successfully.`);
        console.log(`👥 Total Users: ${userCount}`);

        if (userCount > 0) {
            const users = await prisma.user.findMany({
                take: 3,
                select: { id: true, handle: true, email: true, createdAt: true }
            });
            console.table(users);
        } else {
            console.log("ℹ️ No users found.");
        }

    } catch (e) {
        console.error('❌ Database Connection Error:', e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
