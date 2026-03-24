async function test() {
  try {
    const res = await fetch('http://localhost:3001/api/posts');
    const posts = await res.json();
    console.log("Got posts:", posts.length);
    if (posts.length > 0) {
      const p = posts[0];
      console.log("Fetching results for:", p.id);
      const res2 = await fetch(`http://localhost:3001/api/posts/${p.id}/results`);
      console.log("Status:", res2.status);
      const data = await res2.json();
      console.log("Data:", data);
    }
  } catch(e) { console.error(e); }
}
test();
