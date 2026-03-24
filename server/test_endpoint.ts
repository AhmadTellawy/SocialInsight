import { getGroupPosts } from './src/controllers/groupController';

const req = {
    params: { id: "f89c9cdb-3d9d-43d0-b305-d55ec810c5e2" },
    query: {}
} as any;

const res = {
    json: (data: any) => console.log("Success:", JSON.stringify(data).substring(0, 100)),
    status: (code: number) => {
        console.log("Status:", code);
        return {
            json: (data: any) => console.log("Error JSON:", data)
        };
    }
} as any;

async function test() {
    await getGroupPosts(req, res);
}

test();
