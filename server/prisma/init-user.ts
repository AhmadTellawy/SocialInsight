import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const user = await prisma.user.upsert({
        where: { handle: 'owner' },
        update: {},
        create: {
            name: 'Application Owner',
            handle: 'owner',
            email: 'owner@example.com',
            avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&h=200&fit=crop',
            bio: 'Owner of Social Insight.',
            location: 'Remote',
        },
    });
    console.log(`Created initial user: ${user.name}`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
