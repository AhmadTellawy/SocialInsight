import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Seeding database... (Mock data removed per request)');

    // Optional: Only create a default root admin if realistically necessary, else left blank
    // await prisma.user.upsert({ ... })

    console.log('Seeding finished.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
