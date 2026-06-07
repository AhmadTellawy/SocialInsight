import 'dotenv/config';
import http from 'http';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import app from '../src/app';
import prisma from '../src/prisma';
import { JWT_SECRET } from '../src/middleware/authMiddleware';
import { GROUP_ROLES, JOIN_POLICIES, MEMBERSHIP_STATUS, POST_STATUS, POSTING_PERMISSIONS } from '../src/utils/constants';

async function runTests() {
    console.log('[SECURITY TEST] Starting HTTP group security integration tests...');

    let server: http.Server | null = null;
    let baseUrl = '';
    let failed = false;

    const handles = [
        'owner_user_test',
        'admin_user_test',
        'member_user_test',
        'target_user_test',
        'banned_user_test',
        'kicked_user_test',
        'guest_user_test'
    ];
    const groupNames = [
        'Test Public Group',
        'Test Private Group',
        'Second Approval Group',
        'Deleted Group',
        'Profile Deleted Group',
        'Solo Owner Group'
    ];

    console.log('Performing pre-cleanup...');
    const existingUsers = await prisma.user.findMany({ where: { handle: { in: handles } } });
    const existingUserIds = existingUsers.map((user) => user.id);
    await prisma.groupMember.deleteMany({ where: { userId: { in: existingUserIds } } });
    await prisma.post.deleteMany({ where: { authorId: { in: existingUserIds } } });
    await prisma.group.deleteMany({ where: { name: { in: groupNames } } });
    await prisma.user.deleteMany({ where: { handle: { in: handles } } });
    console.log('Pre-cleanup complete.');

    const owner = await prisma.user.create({ data: { name: 'Owner User', handle: 'owner_user_test', email: 'owner@test.com' } });
    const admin = await prisma.user.create({ data: { name: 'Admin User', handle: 'admin_user_test', email: 'admin@test.com' } });
    const regularMember = await prisma.user.create({ data: { name: 'Regular Member', handle: 'member_user_test', email: 'member@test.com' } });
    const targetMember = await prisma.user.create({ data: { name: 'Target Member', handle: 'target_user_test', email: 'target@test.com' } });
    const bannedUser = await prisma.user.create({ data: { name: 'Banned User', handle: 'banned_user_test', email: 'banned@test.com' } });
    const kickedUser = await prisma.user.create({ data: { name: 'Kicked User', handle: 'kicked_user_test', email: 'kicked@test.com' } });
    const guestUser = await prisma.user.create({ data: { name: 'Guest User', handle: 'guest_user_test', email: 'guest@test.com' } });

    const ownerToken = jwt.sign({ userId: owner.id }, JWT_SECRET);
    const adminToken = jwt.sign({ userId: admin.id }, JWT_SECRET);
    const memberToken = jwt.sign({ userId: regularMember.id }, JWT_SECRET);
    const bannedToken = jwt.sign({ userId: bannedUser.id }, JWT_SECRET);
    const kickedToken = jwt.sign({ userId: kickedUser.id }, JWT_SECRET);
    const guestToken = jwt.sign({ userId: guestUser.id }, JWT_SECRET);

    const publicGroup = await prisma.group.create({
        data: {
            name: 'Test Public Group',
            description: 'Public group desc',
            category: 'Technology',
            isPublic: true,
            joinPolicy: JOIN_POLICIES.REQUEST,
            postingPermissions: POSTING_PERMISSIONS.APPROVAL_NEEDED,
            members: {
                create: [
                    { userId: owner.id, role: GROUP_ROLES.OWNER, status: MEMBERSHIP_STATUS.JOINED },
                    { userId: admin.id, role: GROUP_ROLES.ADMIN, status: MEMBERSHIP_STATUS.JOINED },
                    { userId: regularMember.id, role: GROUP_ROLES.MEMBER, status: MEMBERSHIP_STATUS.JOINED },
                    { userId: targetMember.id, role: GROUP_ROLES.MEMBER, status: MEMBERSHIP_STATUS.JOINED }
                ]
            }
        }
    });

    const privateGroup = await prisma.group.create({
        data: {
            name: 'Test Private Group',
            description: 'Private group desc',
            category: 'Technology',
            isPublic: false,
            joinPolicy: JOIN_POLICIES.REQUEST,
            members: {
                create: [
                    { userId: owner.id, role: GROUP_ROLES.OWNER, status: MEMBERSHIP_STATUS.JOINED },
                    { userId: regularMember.id, role: GROUP_ROLES.MEMBER, status: MEMBERSHIP_STATUS.PENDING }
                ]
            }
        }
    });

    const secondApprovalGroup = await prisma.group.create({
        data: {
            name: 'Second Approval Group',
            description: 'Second approval group desc',
            category: 'Technology',
            isPublic: false,
            joinPolicy: JOIN_POLICIES.REQUEST,
            postingPermissions: POSTING_PERMISSIONS.APPROVAL_NEEDED,
            members: {
                create: [
                    { userId: owner.id, role: GROUP_ROLES.OWNER, status: MEMBERSHIP_STATUS.JOINED },
                    { userId: regularMember.id, role: GROUP_ROLES.MEMBER, status: MEMBERSHIP_STATUS.JOINED }
                ]
            }
        }
    });

    const profileDeletedGroup = await prisma.group.create({
        data: {
            name: 'Profile Deleted Group',
            description: 'Deleted profile group',
            category: 'Other',
            isPublic: true,
            isDeleted: true,
            deletedAt: new Date(),
            members: { create: { userId: regularMember.id, role: GROUP_ROLES.MEMBER, status: MEMBERSHIP_STATUS.JOINED } }
        }
    });

    await prisma.groupMember.create({
        data: { userId: bannedUser.id, groupId: publicGroup.id, role: GROUP_ROLES.MEMBER, status: MEMBERSHIP_STATUS.BANNED }
    });
    await prisma.groupMember.create({
        data: { userId: bannedUser.id, groupId: privateGroup.id, role: GROUP_ROLES.MEMBER, status: MEMBERSHIP_STATUS.BANNED }
    });
    await prisma.groupMember.create({
        data: { userId: kickedUser.id, groupId: publicGroup.id, role: GROUP_ROLES.MEMBER, status: MEMBERSHIP_STATUS.REMOVED }
    });

    console.log('Precondition groups and memberships seeded.');

    server = http.createServer(app);
    await new Promise<void>((resolve) => {
        server!.listen(0, () => {
            const address = server!.address();
            const port = typeof address === 'object' && address ? address.port : 0;
            baseUrl = `http://localhost:${port}/api`;
            console.log(`Test Express server running at: ${baseUrl}`);
            resolve();
        });
    });

    const makeRequest = async (path: string, method = 'GET', token: string | null = null, body: any = null) => {
        const headers: Record<string, string> = {};
        if (token) headers.Authorization = `Bearer ${token}`;
        if (body) headers['Content-Type'] = 'application/json';
        const res = await fetch(`${baseUrl}${path}`, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined
        });
        let data: any = null;
        try {
            data = await res.json();
        } catch {
            data = null;
        }
        return { status: res.status, data };
    };

    const groupIdsToCleanup = [publicGroup.id, privateGroup.id, secondApprovalGroup.id, profileDeletedGroup.id];

    try {
        console.log('\n--- Test Case 1: Banned User Permissions ---');
        const viewPublic = await makeRequest(`/groups/${publicGroup.id}`, 'GET', bannedToken);
        if (viewPublic.status !== 200) throw new Error(`Banned user public group view failed: ${viewPublic.status}`);

        const viewPrivate = await makeRequest(`/groups/${privateGroup.id}`, 'GET', bannedToken);
        if (viewPrivate.status !== 403) throw new Error(`Banned user viewed private group: ${viewPrivate.status}`);

        const joinAttempt = await makeRequest(`/groups/${publicGroup.id}/join`, 'POST', bannedToken);
        if (joinAttempt.status !== 403) throw new Error(`Banned user joined/requested group: ${joinAttempt.status}`);

        console.log('\n--- Test Case 2: Kicked User Rejoin ---');
        const rejoinRequest = await makeRequest(`/groups/${publicGroup.id}/request-join`, 'POST', kickedToken);
        if (rejoinRequest.status !== 200 && rejoinRequest.status !== 201) throw new Error(`Kicked user request failed: ${rejoinRequest.status}`);
        if (rejoinRequest.data?.status !== MEMBERSHIP_STATUS.PENDING) throw new Error(`Kicked rejoin status was ${rejoinRequest.data?.status}`);

        const updatedKickedDb = await prisma.groupMember.findUnique({
            where: { userId_groupId: { userId: kickedUser.id, groupId: publicGroup.id } }
        });
        if (updatedKickedDb?.status !== MEMBERSHIP_STATUS.PENDING) throw new Error('Kicked user was not updated to PENDING');

        console.log('\n--- Test Case 3: Post Visibility Guard & Blocked Interactions ---');
        const pendingPost = await prisma.post.create({
            data: {
                title: 'Pending Post',
                description: 'Pending post body',
                type: 'Survey',
                authorId: regularMember.id,
                groupId: publicGroup.id,
                status: POST_STATUS.PENDING_APPROVAL,
                expiresAt: new Date(Date.now() + 86400000),
                targetedGroups: { connect: { id: publicGroup.id } }
            }
        });

        const authorView = await makeRequest(`/posts/${pendingPost.id}`, 'GET', memberToken);
        if (authorView.status !== 200) throw new Error(`Author could not view pending post: ${authorView.status}`);

        const ownerView = await makeRequest(`/posts/${pendingPost.id}`, 'GET', ownerToken);
        if (ownerView.status !== 200) throw new Error(`Owner could not view pending post: ${ownerView.status}`);

        const guestView = await makeRequest(`/posts/${pendingPost.id}`, 'GET', guestToken);
        if (guestView.status !== 403) throw new Error(`Unrelated user viewed pending post: ${guestView.status}`);

        const voteAttempt = await makeRequest(`/posts/${pendingPost.id}/vote`, 'POST', guestToken, { optionIds: ['x'] });
        if (voteAttempt.status !== 404) throw new Error(`Unrelated user voted on pending post: ${voteAttempt.status}`);

        const commentAttempt = await makeRequest(`/posts/${pendingPost.id}/comments`, 'POST', guestToken, { content: 'test comment' });
        if (commentAttempt.status !== 404) throw new Error(`Unrelated user commented on pending post: ${commentAttempt.status}`);

        const resultsAttempt = await makeRequest(`/posts/${pendingPost.id}/results`, 'GET', guestToken);
        if (resultsAttempt.status !== 404) throw new Error(`Unrelated user fetched pending results: ${resultsAttempt.status}`);

        console.log('\n--- Test Case 4: Soft-Deletion Cascade & Query Exclusion ---');
        const deletedGroup = await prisma.group.create({
            data: {
                name: 'Deleted Group',
                description: 'To be soft deleted',
                category: 'Other',
                isPublic: true,
                members: { create: { userId: owner.id, role: GROUP_ROLES.OWNER, status: MEMBERSHIP_STATUS.JOINED } }
            }
        });
        groupIdsToCleanup.push(deletedGroup.id);

        const deletedGroupPost = await prisma.post.create({
            data: {
                title: 'Deleted Group Post',
                description: 'Post in deleted group',
                type: 'Survey',
                authorId: regularMember.id,
                groupId: deletedGroup.id,
                status: POST_STATUS.PUBLISHED,
                expiresAt: new Date(Date.now() + 86400000),
                targetedGroups: { connect: { id: deletedGroup.id } }
            }
        });

        const deleteResp = await makeRequest(`/groups/${deletedGroup.id}`, 'DELETE', ownerToken);
        if (deleteResp.status !== 200) throw new Error(`Delete group failed: ${deleteResp.status}`);

        const groupsList = await makeRequest('/groups', 'GET', memberToken);
        const hasDeletedGroup = Array.isArray(groupsList.data) && groupsList.data.some((group: any) => group.id === deletedGroup.id);
        if (hasDeletedGroup) throw new Error('Soft-deleted group is still returned in active list');

        const postFetch = await makeRequest(`/posts/${deletedGroupPost.id}`, 'GET', memberToken);
        if (postFetch.status !== 403 && postFetch.status !== 404) throw new Error(`Deleted group post is accessible: ${postFetch.status}`);

        console.log('\n--- Test Case 5: Profile Groups Filtering ---');
        const profileGroups = await makeRequest(`/users/${regularMember.id}/groups`, 'GET', memberToken);
        if (profileGroups.status !== 200 || !Array.isArray(profileGroups.data)) throw new Error('Profile groups endpoint failed');
        const profileGroupIds = profileGroups.data.map((group: any) => group.id);
        if (!profileGroupIds.includes(publicGroup.id)) throw new Error('Joined public group missing from profile groups');
        if (profileGroupIds.includes(privateGroup.id)) throw new Error('Pending private group returned in profile groups');
        if (profileGroupIds.includes(profileDeletedGroup.id)) throw new Error('Deleted group returned in profile groups');
        const publicProfileGroup = profileGroups.data.find((group: any) => group.id === publicGroup.id);
        if (!publicProfileGroup?.permissions || publicProfileGroup.permissions.canManageRoles !== false) {
            throw new Error('Profile group permissions are not dynamically computed for regular member');
        }

        console.log('\n--- Test Case 6: View Tracking Security ---');
        const publicPost = await prisma.post.create({
            data: {
                title: 'View Count Public Post',
                description: 'View count body',
                type: 'Survey',
                authorId: owner.id,
                status: POST_STATUS.PUBLISHED,
                expiresAt: new Date(Date.now() + 86400000)
            }
        });

        const publicView = await makeRequest(`/posts/${publicPost.id}/views`, 'POST', ownerToken, {
            source: 'TEST',
            deviceType: 'WEB',
            guestSessionId: 'ignored-for-authenticated-user'
        });
        if (publicView.status !== 200 || publicView.data?.recorded !== true) throw new Error(`Authenticated view was not recorded: ${publicView.status}`);
        const authView = await prisma.postView.findFirst({ where: { postId: publicPost.id, viewerKey: `user:${owner.id}` } });
        if (!authView) throw new Error('Authenticated view was not stored with user viewerKey');

        const privatePost = await prisma.post.create({
            data: {
                title: 'Private Group Published Post',
                description: 'Private group post body',
                type: 'Survey',
                authorId: owner.id,
                groupId: privateGroup.id,
                status: POST_STATUS.PUBLISHED,
                expiresAt: new Date(Date.now() + 86400000),
                targetedGroups: { connect: { id: privateGroup.id } }
            }
        });
        const privateView = await makeRequest(`/posts/${privatePost.id}/views`, 'POST', guestToken, {
            source: 'TEST',
            deviceType: 'WEB',
            guestSessionId: 'private-view-attempt'
        });
        if (privateView.status !== 403) throw new Error(`Unauthorized private group view was recorded: ${privateView.status}`);

        console.log('\n--- Test Case 7: Multi-Group Approval Prevention ---');
        const multiGroupCreate = await makeRequest('/posts', 'POST', memberToken, {
            title: 'Multi-group approval post',
            description: 'Should be rejected',
            type: 'Post',
            targetAudience: 'Groups',
            targetGroups: [publicGroup.id, secondApprovalGroup.id]
        });
        if (multiGroupCreate.status !== 400) throw new Error(`Multi-group approval post was not rejected: ${multiGroupCreate.status}`);

        console.log('\n--- Test Case 8: Admin vs Owner Capabilities ---');
        const adminRoleAttempt = await makeRequest(`/groups/${publicGroup.id}/members/${regularMember.id}/role`, 'PUT', adminToken, { role: GROUP_ROLES.ADMIN });
        if (adminRoleAttempt.status !== 403) throw new Error(`Admin was allowed to change roles: ${adminRoleAttempt.status}`);

        const adminKickAttempt = await makeRequest(`/groups/${publicGroup.id}/members/${targetMember.id}/kick`, 'POST', adminToken);
        if (adminKickAttempt.status !== 200) throw new Error(`Admin could not kick member: ${adminKickAttempt.status}`);
        const kickedTarget = await prisma.groupMember.findUnique({
            where: { userId_groupId: { userId: targetMember.id, groupId: publicGroup.id } }
        });
        if (kickedTarget?.status !== MEMBERSHIP_STATUS.REMOVED) throw new Error('Admin kick did not set target member to REMOVED');

        const adminKickAdminAttempt = await makeRequest(`/groups/${publicGroup.id}/members/${admin.id}/kick`, 'POST', adminToken);
        if (adminKickAdminAttempt.status !== 403) throw new Error(`Admin was allowed to kick another admin: ${adminKickAdminAttempt.status}`);

        console.log('\n--- Test Case 9: Sole Owner Leave Cascade ---');
        const soloGroup = await prisma.group.create({
            data: {
                name: 'Solo Owner Group',
                description: 'Solo owner group',
                category: 'Other',
                isPublic: true,
                members: { create: { userId: owner.id, role: GROUP_ROLES.OWNER, status: MEMBERSHIP_STATUS.JOINED } }
            }
        });
        groupIdsToCleanup.push(soloGroup.id);
        const soloPost = await prisma.post.create({
            data: {
                title: 'Solo Group Post',
                description: 'Should be deleted when owner leaves',
                type: 'Survey',
                authorId: owner.id,
                groupId: soloGroup.id,
                status: POST_STATUS.PUBLISHED,
                expiresAt: new Date(Date.now() + 86400000),
                targetedGroups: { connect: { id: soloGroup.id } }
            }
        });

        const leaveSolo = await makeRequest(`/groups/${soloGroup.id}/leave`, 'POST', ownerToken);
        if (leaveSolo.status !== 200 || leaveSolo.data?.deleted !== true) throw new Error(`Sole owner leave did not delete group: ${leaveSolo.status}`);
        const soloGroupDb = await prisma.group.findUnique({ where: { id: soloGroup.id } });
        const soloPostDb = await prisma.post.findUnique({ where: { id: soloPost.id } });
        if (!soloGroupDb?.isDeleted || !soloPostDb?.isDeleted) throw new Error('Sole owner leave did not cascade soft-delete group content');

        console.log('\n[SECURITY TEST] ALL TESTS PASSED SUCCESSFULLY');
    } catch (error) {
        failed = true;
        console.error('\n[SECURITY TEST] A TEST CASE FAILED', error);
    } finally {
        console.log('\nCleaning up database test records...');
        if (server) {
            await new Promise<void>((resolve) => server!.close(() => resolve()));
        }

        const userIds = [owner.id, admin.id, regularMember.id, targetMember.id, bannedUser.id, kickedUser.id, guestUser.id];
        await prisma.groupMember.deleteMany({ where: { userId: { in: userIds } } });
        await prisma.post.deleteMany({ where: { authorId: { in: userIds } } });
        await prisma.group.deleteMany({ where: { id: { in: groupIdsToCleanup } } });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
        await prisma.$disconnect();
        console.log('Cleanup complete.');
    }

    if (failed) {
        process.exit(1);
    }
    process.exit(0);
}

runTests().catch(async (error) => {
    console.error('[SECURITY TEST] Unexpected failure', error);
    await prisma.$disconnect();
    process.exit(1);
});
