import { PrismaClient } from '@prisma/client';

// Pass the correct URL dynamically for testing
const prisma = new PrismaClient({
    datasources: {
        db: {
            url: "file:./dev.db"
        }
    }
});

async function main() {
    try {
        const id = 'some-uuid';
        console.log("Testing count query...");
        const total = await prisma.post.count({
            where: {
                targetGroups: {
                    contains: id
                }
            }
        });
        
        console.log("Query success!", total);
    } catch (e: any) {
        console.error("Query FAILED:", e.message);
    }
}

main().finally(() => prisma.$disconnect());
