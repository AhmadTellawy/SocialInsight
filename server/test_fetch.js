async function main() {
    try {
        const userId = "7d4e04c7-29f0-41d9-803c-fe648e2ef89c"; // a15 user ID
        const response = await fetch(`http://localhost:3001/api/posts?userId=${userId}`);
        const data = await response.json();
        
        const testPost = data.find(p => p.title === "followers only test 6");
        
        if (testPost) {
            console.log("Post found:");
            console.log("Post ID:", testPost.id);
            console.log("Author ID from API:", testPost.author.id);
            console.log("User ID:", userId);
            console.log("Are they equal?:", testPost.author.id === userId);
            console.log("Are types the same?:", typeof testPost.author.id, "vs", typeof userId);
        } else {
            console.log("Post not found in feed!");
        }
    } catch (err) {
        console.error(err);
    }
}

main();
