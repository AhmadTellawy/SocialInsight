import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Cleaning up InteractionEvent table...');
    const deleted = await prisma.interactionEvent.deleteMany({});
    console.log(`Deleted ${deleted.count} records.`);
    console.log('Cleanup complete.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
