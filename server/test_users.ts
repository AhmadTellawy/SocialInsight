import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const u1 = await prisma.user.findUnique({where: {id: '78685013-a414-42c6-ab78-248aae2c6496'}});
    const u2 = await prisma.user.findUnique({where: {id: '7d4e04c7-29f0-41d9-803c-fe648e2ef89c'}});
    console.log('User 1 (uId):', u1?.name, u1?.handle);
    console.log('User 2 (aId):', u2?.name, u2?.handle);
}

main().catch(console.error).finally(() => prisma.$disconnect());
