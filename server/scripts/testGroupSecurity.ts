import 'dotenv/config';
import prisma from '../src/prisma';
import { GROUP_ROLES, MEMBERSHIP_STATUS, JOIN_POLICIES, POSTING_PERMISSIONS, POST_STATUS } from '../src/utils/constants';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../src/middleware/authMiddleware';
import app from '../src/app';
import http from 'http';
import fetch from 'node-fetch';

async function runTests() {
    console.log('[SECURITY TEST] Starting HTTP group security integration tests...');

    let server: http.Server | null = null;
    let port = 0;
    let baseUrl = '';

    const handles = ['owner_user_test', 'member_user_test', 'banned_user_test', 'kicked_user_test', 'guest_user_test'];
    const groupNames = ['Test Public Group', 'Test Private Group', 'Deleted Group'];

    // Pre-cleanup to ensure idempotency
    console.log('Performing pre-cleanup...');
    const existingUsers = await prisma.user.findMany({
        where: { handle: { in: handles } }
    });
    const existingUserIds = existingUsers.map(u => u.id);

    await prisma.groupMember.deleteMany({
        where: { userId: { in: existingUserIds } }
    });
    await prisma.post.deleteMany({
        where: { authorId: { in: existingUserIds } }
    });
    await prisma.group.deleteMany({
        where: { name: { in: groupNames } }
    });
    await prisma.user.deleteMany({
        where: { handle: { in: handles } }
    });
    console.log('Pre-cleanup complete.');

    // 1. Create test users
    const owner = await prisma.user.create({
        data: { name: 'Owner User', handle: 'owner_user_test', email: 'owner@test.com' }
    });
    const regularMember = await prisma.user.create({
        data: { name: 'Regular Member', handle: 'member_user_test', email: 'member@test.com' }
    });
    const bannedUser = await prisma.user.create({
        data: { name: 'Banned User', handle: 'banned_user_test', email: 'banned@test.com' }
    });
    const kickedUser = await prisma.user.create({
        data: { name: 'Kicked User', handle: 'kicked_user_test', email: 'kicked@test.com' }
    });
    const guestUser = await prisma.user.create({
        data: { name: 'Guest User', handle: 'guest_user_test', email: 'guest@test.com' }
    });

    console.log('Test users created successfully.');

    // 2. Generate JWT tokens for test users
    const ownerToken = jwt.sign({ userId: owner.id }, JWT_SECRET);
    const memberToken = jwt.sign({ userId: regularMember.id }, JWT_SECRET);
    const bannedToken = jwt.sign({ userId: bannedUser.id }, JWT_SECRET);
    const kickedToken = jwt.sign({ userId: kickedUser.id }, JWT_SECRET);
    const guestToken = jwt.sign({ userId: guestUser.id }, JWT_SECRET);

    // 3. Setup groups and memberships via database direct seeding (preconditions)
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
                    { userId: regularMember.id, role: GROUP_ROLES.MEMBER, status: MEMBERSHIP_STATUS.JOINED }
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
                    { userId: owner.id, role: GROUP_ROLES.OWNER, status: MEMBERSHIP_STATUS.JOINED }
                ]
            }
        }
    });

    // Add banned memberships
    await prisma.groupMember.create({
        data: { userId: bannedUser.id, groupId: publicGroup.id, role: GROUP_ROLES.MEMBER, status: MEMBERSHIP_STATUS.BANNED }
    });
    await prisma.groupMember.create({
        data: { userId: bannedUser.id, groupId: privateGroup.id, role: GROUP_ROLES.MEMBER, status: MEMBERSHIP_STATUS.BANNED }
    });

    // Add kicked membership
    await prisma.groupMember.create({
        data: { userId: kickedUser.id, groupId: publicGroup.id, role: GROUP_ROLES.MEMBER, status: MEMBERSHIP_STATUS.REMOVED }
    });

    console.log('Precondition groups and memberships seeded.');

    // 4. Start HTTP Server on a free random port
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
        server!.listen(0, () => {
            port = (server!.address() as any).port;
            baseUrl = `http://localhost:${port}/api`;
            console.log(`Test Express server running at: ${baseUrl}`);
            resolve();
        });
    });

    // Helper to make HTTP requests
    const makeRequest = async (path: string, method = 'GET', token: string | null = null, body: any = null) => {
        const headers: Record<string, string> = {};
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        if (body) {
            headers['Content-Type'] = 'application/json';
        }
        const res = await fetch(`${baseUrl}${path}`, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined
        });
        const status = res.status;
        let data: any = null;
        try {
            data = await res.json();
        } catch (err) {
            // response was not JSON
        }
        return { status, data };
    };

    let deletedGroupId = '';

    try {
        // --- TEST CASE 1: Banned User Permissions ---
        console.log('\n--- Running Test Case 1: Banned User Permissions ---');
        
        // 1.1 Banned user can view public group
        const viewPublic = await makeRequest(`/groups/${publicGroup.id}`, 'GET', bannedToken);
        console.log(`Banned user view public group status: ${viewPublic.status} (Expected: 200)`);
        if (viewPublic.status !== 200) {
            throw new Error(`Banned user could not view public group! Status: ${viewPublic.status}`);
        }

        // 1.2 Banned user cannot view private group
        const viewPrivate = await makeRequest(`/groups/${privateGroup.id}`, 'GET', bannedToken);
        console.log(`Banned user view private group status: ${viewPrivate.status} (Expected: 403)`);
        if (viewPrivate.status !== 403) {
            throw new Error(`Banned user allowed to view private group! Status: ${viewPrivate.status}`);
        }

        // 1.3 Banned user cannot join/request to join the group
        const joinAttempt = await makeRequest(`/groups/${publicGroup.id}/join`, 'POST', bannedToken);
        console.log(`Banned user join group status: ${joinAttempt.status} (Expected: 403)`);
        if (joinAttempt.status !== 403) {
            throw new Error(`Banned user was allowed to join group! Status: ${joinAttempt.status}`);
        }

        // --- TEST CASE 2: Kicked User Rejoin (endpoint handles unique constraint) ---
        console.log('\n--- Running Test Case 2: Kicked User Rejoin ---');
        
        // Verify kicked user status is REMOVED in DB first
        const initKickedDb = await prisma.groupMember.findUnique({
            where: { userId_groupId: { userId: kickedUser.id, groupId: publicGroup.id } }
        });
        if (!initKickedDb || initKickedDb.status !== MEMBERSHIP_STATUS.REMOVED) {
            throw new Error('Kicked user initial membership is not REMOVED!');
        }

        // Request join via HTTP endpoint
        const rejoinRequest = await makeRequest(`/groups/${publicGroup.id}/request-join`, 'POST', kickedToken);
        console.log(`Kicked user request-join response status: ${rejoinRequest.status} (Expected: 200/201)`);
        console.log(`Kicked user rejoin returned status: ${rejoinRequest.data?.status} (Expected: PENDING)`);
        
        if (rejoinRequest.status !== 200 && rejoinRequest.status !== 201) {
            throw new Error(`Kicked user request-join failed! Status: ${rejoinRequest.status}, Error: ${JSON.stringify(rejoinRequest.data)}`);
        }
        if (rejoinRequest.data?.status !== MEMBERSHIP_STATUS.PENDING) {
            throw new Error(`Kicked user rejoin returned status was not PENDING! Got: ${rejoinRequest.data?.status}`);
        }

        // Verify database is updated to PENDING
        const updatedKickedDb = await prisma.groupMember.findUnique({
            where: { userId_groupId: { userId: kickedUser.id, groupId: publicGroup.id } }
        });
        if (!updatedKickedDb || updatedKickedDb.status !== MEMBERSHIP_STATUS.PENDING) {
            throw new Error(`Kicked user rejoin did not update DB! Status in DB: ${updatedKickedDb?.status}`);
        }

        // --- TEST CASE 3: Post Visibility Guard & Blocked Interactions ---
        console.log('\n--- Running Test Case 3: Post Visibility Guard ---');
        
        // Create a pending post in public group
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

        // 3.1 Author can view pending post
        const authorView = await makeRequest(`/posts/${pendingPost.id}`, 'GET', memberToken);
        console.log(`Author view pending post status: ${authorView.status} (Expected: 200)`);
        if (authorView.status !== 200) {
            throw new Error(`Author could not view own pending post! Status: ${authorView.status}`);
        }

        // 3.2 Group Owner can view pending post
        const ownerView = await makeRequest(`/posts/${pendingPost.id}`, 'GET', ownerToken);
        console.log(`Owner view pending post status: ${ownerView.status} (Expected: 200)`);
        if (ownerView.status !== 200) {
            throw new Error(`Group Owner could not view pending post! Status: ${ownerView.status}`);
        }

        // 3.3 Guest/Unrelated user cannot view pending post
        const guestView = await makeRequest(`/posts/${pendingPost.id}`, 'GET', guestToken);
        console.log(`Unrelated user view pending post status: ${guestView.status} (Expected: 403)`);
        if (guestView.status !== 403) {
            throw new Error(`Unrelated user was allowed to view pending post! Status: ${guestView.status}`);
        }

        // 3.4 Blocked interactions on pending post (voting, commenting, results)
        const voteAttempt = await makeRequest(`/posts/${pendingPost.id}/vote`, 'POST', guestToken, { answer: 'test' });
        console.log(`Unrelated user vote on pending post status: ${voteAttempt.status} (Expected: 404)`);
        if (voteAttempt.status !== 404) {
            throw new Error(`Unrelated user was allowed to vote on pending post! Status: ${voteAttempt.status}`);
        }

        const commentAttempt = await makeRequest(`/posts/${pendingPost.id}/comments`, 'POST', guestToken, { content: 'test comment' });
        console.log(`Unrelated user comment on pending post status: ${commentAttempt.status} (Expected: 404)`);
        if (commentAttempt.status !== 404) {
            throw new Error(`Unrelated user was allowed to comment on pending post! Status: ${commentAttempt.status}`);
        }

        const resultsAttempt = await makeRequest(`/posts/${pendingPost.id}/results`, 'GET', guestToken);
        console.log(`Unrelated user get results of pending post status: ${resultsAttempt.status} (Expected: 404)`);
        if (resultsAttempt.status !== 404) {
            throw new Error(`Unrelated user was allowed to fetch results of pending post! Status: ${resultsAttempt.status}`);
        }

        // --- TEST CASE 4: Soft-Deletion Cascade & Query Exclusion ---
        console.log('\n--- Running Test Case 4: Soft-Deletion Cascade & Exclusion ---');
        
        // Setup deleted group and its post (precondition)
        const deletedGroup = await prisma.group.create({
            data: {
                name: 'Deleted Group',
                description: 'To be soft deleted',
                category: 'Other',
                isDeleted: false,
                isPublic: true,
                members: {
                    create: { userId: owner.id, role: GROUP_ROLES.OWNER, status: MEMBERSHIP_STATUS.JOINED }
                }
            }
        });
        deletedGroupId = deletedGroup.id;

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

        // Delete group via HTTP endpoint as owner
        const deleteResp = await makeRequest(`/groups/${deletedGroup.id}`, 'DELETE', ownerToken);
        console.log(`Delete group response status: ${deleteResp.status} (Expected: 200)`);
        if (deleteResp.status !== 200) {
            throw new Error(`Failed to delete group via endpoint! Status: ${deleteResp.status}`);
        }

        // 4.1 Verify deleted group is excluded from groups list
        const groupsList = await makeRequest('/groups', 'GET', memberToken);
        const hasDeletedGroup = Array.isArray(groupsList.data) && groupsList.data.some((g: any) => g.id === deletedGroup.id);
        console.log(`Deleted group in active list: ${hasDeletedGroup} (Expected: false)`);
        if (hasDeletedGroup) {
            throw new Error('Soft-deleted group is still returned in active list!');
        }

        // 4.2 Verify deleted group posts are excluded from posts list and retrieve is blocked
        const postFetch = await makeRequest(`/posts/${deletedGroupPost.id}`, 'GET', memberToken);
        console.log(`Retrieve post in soft-deleted group status: ${postFetch.status} (Expected: 403/404)`);
        if (postFetch.status !== 403 && postFetch.status !== 404) {
            throw new Error(`Post in deleted group is still accessible! Status: ${postFetch.status}`);
        }

        console.log('\n[SECURITY TEST] ALL TESTS PASSED SUCCESSFULLY! ✅');
        process.exit(0);

    } catch (e: any) {
        console.error('\n[SECURITY TEST] A TEST CASE FAILED! ❌', e);
        process.exit(1);
    } finally {
        console.log('\nCleaning up database test records...');
        if (server) {
            server.close();
        }
        
        const userIds = [owner.id, regularMember.id, bannedUser.id, kickedUser.id, guestUser.id];
        
        await prisma.groupMember.deleteMany({
            where: { userId: { in: userIds } }
        });
        await prisma.post.deleteMany({
            where: { authorId: { in: userIds } }
        });
        
        const groupsToDelete = [publicGroup.id, privateGroup.id];
        if (deletedGroupId) groupsToDelete.push(deletedGroupId);
        await prisma.group.deleteMany({
            where: { id: { in: groupsToDelete } }
        });
        
        await prisma.user.deleteMany({
            where: { id: { in: userIds } }
        });
        console.log('Cleanup complete.');
        await prisma.$disconnect();
    }
}

runTests();
