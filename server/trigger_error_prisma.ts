import { PrismaClient } from '@prisma/client';
import fetch from 'node-fetch';

const prisma = new PrismaClient();

async function main() {
    try {
        const groups = await prisma.group.findMany();
        console.log(`Found ${groups.length} groups.`);
        
        if (groups.length > 0) {
            const testGroupId = groups[0].id;
            console.log(`Testing group ID: ${testGroupId}`);
            
            const postRes = await fetch(`http://127.0.0.1:3001/api/groups/${testGroupId}/posts`);
            console.log("Posts status:", postRes.status);
            console.log(await postRes.text());
        }
    } catch (e) {
        console.error("Script failed:", e);
    }
}

main().finally(() => prisma.$disconnect());
