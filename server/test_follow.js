const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testQuery() {
    const defaultUsers = await prisma.user.findMany({
        select: { id: true, name: true, handle: true },
        take: 5
    });
    console.log('Sample Users:', JSON.stringify(defaultUsers, null, 2));
}

testQuery()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect()
    });
