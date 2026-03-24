import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const user = await prisma.user.findFirst();
    if (!user) {
        console.log("No user found.");
        return;
    }

    console.log("Creating group for user:", user.email);

    try {
        const newGroup = await prisma.group.create({
            data: {
                name: "Test Group " + Date.now(),
                description: "Test description",
                category: "General",
                memberCount: 1,
                members: {
                    create: {
                        userId: user.id,
                        role: 'Owner'
                    }
                }
            },
            include: { members: true }
        });

        console.log("Successfully created group:", newGroup.id, "Members:", newGroup.members.length);
    } catch (e) {
        console.error("Failed to create group:", e);
    }
}

main().finally(() => prisma.$disconnect());
