import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const models = [
        'user',
        'userDemographics',
        'follow',
        'group',
        'groupMember',
        'post',
        'section',
        'question',
        'option',
        'response',
        'answer',
        'comment',
        'notificationSettings',
        'notification',
        'userLike',
        'oTPCode',
        'pendingRegistration',
        'savedPost',
        'hiddenPost',
        'report',
        'interactionEvent',
        'commentLike',
    ];

    for (const model of models) {
        console.log(`Checking ${model}...`);
        try {
            // @ts-ignore
            const records = await prisma[model].findMany();
            console.log(`  OK: Found ${records.length} records in ${model}.`);
        } catch (e) {
            console.error(`  ERROR reading ${model}:`, e.message);
        }
    }
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
