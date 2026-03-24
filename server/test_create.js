async function main() {
    try {
        const userId = "7d4e04c7-29f0-41d9-803c-fe648e2ef89c"; // a15 user ID
        
        const payload = {
            title: "Analysis Test Post",
            type: "Poll",
            pollChoiceType: "multiple",
            author: { id: userId, name: "a15" },
            options: [
                { text: "Option A", votes: 0 },
                { text: "Option B", votes: 0 }
            ],
            targetAudience: "Followers",
            resultsWho: "Public",
            resultsDetail: "Overall",
            resultsTiming: "Immediately",
            category: "General",
            allowComments: true,
            allowAnonymous: false
        };

        const response = await fetch(`http://localhost:3001/api/posts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        console.log("Created Post ID:", data.id);
        console.log("Created Post Author ID:", data.author.id);
        console.log("Does it match a15?:", data.author.id === userId);
    } catch (err) {
        console.error(err);
    }
}

main();
