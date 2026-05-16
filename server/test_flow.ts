import { PrismaClient } from '@prisma/client';
import express, { Request, Response } from 'express';
import { createGroup, getGroupPosts, getGroupStats, getMembership } from './src/controllers/groupController';

const prisma = new PrismaClient({
    datasources: { db: { url: "file:./dev.db" } }
});

async function main() {
    try {
        // Mock request/response
        const reqMock = (opts: any) => opts as Request;
        const resMock = () => {
            const res: any = {};
            res.status = (code: number) => { res.statusCode = code; return res; };
            res.json = (data: any) => { res.data = data; return res; };
            return res as Response;
        };

        // 1. Create User
        const user = await prisma.user.create({
            data: {
                name: "Test User",
                handle: "testuser_" + Date.now(),
                email: "test_" + Date.now() + "@test.com",
            }
        });

        // 2. Create Group
        const reqCreate = reqMock({
            body: {
                name: "Test Group",
                creatorId: user.id
            }
        });
        const resCreate = resMock();
        await createGroup(reqCreate, resCreate);
        console.log("Create Group Response:", (resCreate as any).data);
        const group = (resCreate as any).data;

        // 3. Get Stats
        const reqStats = reqMock({
            params: { id: group.id }
        });
        const resStats = resMock();
        await getGroupStats(reqStats, resStats);
        console.log("Group Stats:", (resStats as any).data);

        // 4. Get Membership
        const reqMembership = reqMock({
            params: { id: group.id },
            query: { currentUserId: user.id }
        });
        const resMembership = resMock();
        await getMembership(reqMembership, resMembership);
        console.log("Membership:", (resMembership as any).data);

        // 5. Get Posts
        const reqPosts = reqMock({
            params: { id: group.id },
            query: { currentUserId: user.id, page: "1", limit: "10" }
        });
        const resPosts = resMock();
        await getGroupPosts(reqPosts, resPosts);
        console.log("Group Posts status:", (resPosts as any).statusCode);
        console.log("Group Posts error:", (resPosts as any).data?.error);

    } catch (e: any) {
        console.error("Test script FAILED:", e);
    }
}

main().finally(() => prisma.$disconnect());
