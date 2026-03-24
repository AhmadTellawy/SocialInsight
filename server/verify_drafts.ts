
import { PrismaClient } from '@prisma/client';
import fetch from 'node-fetch';

const prisma = new PrismaClient();
const API_URL = 'http://localhost:3001/api';

async function runTests() {
    console.log("Starting Verification...");

    // 1. Get a user
    const user = await prisma.user.findFirst();
    if (!user) {
        console.error("No user found in DB. Run the app to create one first.");
        return;
    }
    console.log(`Using user: ${user.name} (${user.id})`);

    // 2. Create a Draft via API
    console.log("\n1. Testing Create Draft API...");
    const draftData = {
        title: "Test Draft " + Date.now(),
        description: "This is a verification draft",
        type: "Survey",
        status: "DRAFT",
        authorId: user.id
    };

    const createRes = await fetch(`${API_URL}/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draftData)
    });
    const createdDraft: any = await createRes.json();

    // Check if we got an error object or a post
    if (createdDraft.error) {
        console.error("❌ API Error:", createdDraft.error);
        return;
    }

    if (createdDraft.status === 'DRAFT') {
        console.log("✅ Draft created via API successfully with status DRAFT");
    } else {
        console.error("❌ Failed: Status is " + createdDraft.status);
    }

    // 3. Verify in Database
    console.log("\n2. Verifying in Database...");
    const dbPost = await prisma.post.findUnique({ where: { id: createdDraft.id } });
    if (dbPost && dbPost.status === 'DRAFT') {
        console.log("✅ Database record confirmed with status DRAFT");
    } else {
        console.error("❌ DB Verification Failed", dbPost);
    }

    // 4. Verify getDrafts API
    console.log("\n3. Testing getDrafts API...");
    const draftsRes = await fetch(`${API_URL}/posts/drafts?userId=${user.id}`);
    const drafts: any = await draftsRes.json();

    if (Array.isArray(drafts)) {
        const foundInDrafts = drafts.find((d: any) => d.id === createdDraft.id);
        if (foundInDrafts) {
            console.log("✅ Created draft found in getDrafts response");
        } else {
            console.error("❌ Draft NOT found in getDrafts response");
        }
    } else {
        console.error("❌ getDrafts did not return an array", drafts);
    }

    // 5. Verify getPosts (Public Feed) - Should NOT contain draft
    console.log("\n4. Testing getPosts API (Public Feed)...");
    const postsRes = await fetch(`${API_URL}/posts`);
    const posts: any = await postsRes.json();

    if (Array.isArray(posts)) {
        const foundInPublic = posts.find((p: any) => p.id === createdDraft.id);
        if (!foundInPublic) {
            console.log("✅ Draft correctly EXCLUDED from public feed");
        } else {
            console.error("❌ Draft FOUND in public feed (Should be hidden)");
        }
    } else {
        console.error("❌ getPosts did not return an array", posts);
    }

    // 6. Test Publishing
    console.log("\n5. Testing Update/Publish API...");
    const updateRes = await fetch(`${API_URL}/posts/${createdDraft.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            status: 'PUBLISHED',
            title: createdDraft.title + " (Published)"
        })
    });
    const updatedPost: any = await updateRes.json();

    if (updatedPost.status === 'PUBLISHED') {
        console.log("✅ Post status updated to PUBLISHED via API");
    } else {
        console.error("❌ Failed to update status", updatedPost);
    }

    // 7. Verify it now appears in Public Feed
    const postsRes2 = await fetch(`${API_URL}/posts`);
    const posts2: any = await postsRes2.json();
    const foundInPublic2 = posts2.find((p: any) => p.id === createdDraft.id);

    if (foundInPublic2) {
        console.log("✅ Published post now APPEARS in public feed");
    } else {
        console.error("❌ Published post still NOT in public feed");
    }

    // Cleanup
    await prisma.post.delete({ where: { id: createdDraft.id } });
    console.log("\n✅ Test Cleaned up.");
}

runTests().catch(console.error).finally(() => prisma.$disconnect());
