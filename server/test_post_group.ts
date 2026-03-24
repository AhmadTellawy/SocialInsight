import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const post = await prisma.post.findUnique({
        where: { id: "fddef8ff-b9b1-41fd-82c6-e40a28dccd1f" }
    });
    console.log(JSON.stringify(post, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
