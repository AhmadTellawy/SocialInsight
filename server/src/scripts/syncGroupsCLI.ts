import prisma from '../prisma';
import { MEMBERSHIP_STATUS } from '../utils/constants';

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');

    console.log(`[SYNC GROUPS CLI] Starting group sync script... (Dry Run: ${dryRun})`);

    // 1. Recount members for all groups
    const groups = await prisma.group.findMany({
        where: { isDeleted: false }
    });

    console.log(`Found ${groups.length} active groups to check.`);

    let updatedGroupsCount = 0;
    for (const group of groups) {
        const actualCount = await prisma.groupMember.count({
            where: {
                groupId: group.id,
                status: MEMBERSHIP_STATUS.JOINED
            }
        });

        if (group.memberCount !== actualCount) {
            console.log(`Group "${group.name}" (${group.id}): memberCount is ${group.memberCount}, actual joined is ${actualCount}.`);
            if (!dryRun) {
                await prisma.group.update({
                    where: { id: group.id },
                    data: { memberCount: actualCount }
                });
            }
            updatedGroupsCount++;
        }
    }

    console.log(`Recount complete. Groups that ${dryRun ? 'would be' : 'were'} updated: ${updatedGroupsCount}`);

    // 2. Sync groupId on legacy posts (if groupId is null but targetedGroups has groups)
    const legacyPosts = await prisma.post.findMany({
        where: {
            groupId: null,
            isDeleted: false,
            targetedGroups: { some: {} }
        },
        include: {
            targetedGroups: true
        }
    });

    console.log(`Found ${legacyPosts.length} legacy posts without primary groupId but having targetedGroups.`);

    let updatedPostsCount = 0;
    for (const post of legacyPosts) {
        if (post.targetedGroups.length > 0) {
            const firstGroupId = post.targetedGroups[0].id;
            console.log(`Post "${post.title}" (${post.id}): setting primary groupId to "${firstGroupId}".`);
            if (!dryRun) {
                await prisma.post.update({
                    where: { id: post.id },
                    data: { groupId: firstGroupId }
                });
            }
            updatedPostsCount++;
        }
    }

    console.log(`Post sync complete. Posts that ${dryRun ? 'would be' : 'were'} updated: ${updatedPostsCount}`);
    console.log('[SYNC GROUPS CLI] Script finished.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
