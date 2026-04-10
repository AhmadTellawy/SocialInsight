import * as dotenv from 'dotenv';
dotenv.config();
import prisma from './src/prisma';
async function main() {
    const users = await prisma.user.findMany({ where: { name: { contains: 'Ahmad' } } });
    for (const u of users) {
        console.log(`Name: ${u.name}`);
        console.log(`Avatar: ${u.avatar}`);
    }
}
main().catch(console.error).finally(() => prisma.$disconnect());
