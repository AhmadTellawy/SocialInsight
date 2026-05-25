const http = require('https');
http.get('https://socialinsightapp.com/assets/index-BpB5s8Ch.js', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        const matches = data.match(/onrender\.com[a-zA-Z0-9_\-\/]*/g);
        console.log(matches);
    });
});
