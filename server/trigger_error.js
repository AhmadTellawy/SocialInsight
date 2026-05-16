const fetch = require('node-fetch');

async function main() {
    try {
        console.log("Fetching groups to find an ID...");
        const res = await fetch('http://127.0.0.1:3001/api/groups');
        const data = await res.json();
        
        if (!data || data.length === 0) {
            console.log("No groups found.");
            return;
        }

        const testGroupId = data[0].id;
        console.log(`Testing group ID: ${testGroupId}`);

        console.log("Triggering /posts...");
        const postRes = await fetch(`http://127.0.0.1:3001/api/groups/${testGroupId}/posts`);
        console.log("Posts status:", postRes.status);
        console.log(await postRes.text());

        console.log("Triggering /stats...");
        const statRes = await fetch(`http://127.0.0.1:3001/api/groups/${testGroupId}/stats`);
        console.log("Stats status:", statRes.status);
        console.log(await statRes.text());
        
        console.log("Triggering /membership...");
        const memRes = await fetch(`http://127.0.0.1:3001/api/groups/${testGroupId}/membership`);
        console.log("Membership status:", memRes.status);
        console.log(await memRes.text());

    } catch (e) {
        console.error("Fetch failed", e);
    }
}

main();
