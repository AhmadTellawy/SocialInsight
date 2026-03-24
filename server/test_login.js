const http = require('http');

async function testFetch() {
    const url = 'http://127.0.0.1:3001/api/auth/register';
    const data = JSON.stringify({
        name: 'Test Setup User',
        handle: 'testsetup',
        email: 'testsetup@example.com',
        password: 'password123',
        authProvider: 'Email'
    });

    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
        }
    };

    const req = http.request(url, options, (res) => {
        let responseBody = '';
        res.on('data', (chunk) => {
            responseBody += chunk;
        });
        res.on('end', () => {
            console.log('Register Status:', res.statusCode);
            console.log('Register Response:', responseBody);

            const loginUrl = 'http://127.0.0.1:3001/api/auth/login';
            const loginData = JSON.stringify({
                identifier: 'testsetup@example.com',
                password: 'password123',
                authProvider: 'Email'
            });
            const loginOptions = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(loginData)
                }
            };
            const req2 = http.request(loginUrl, loginOptions, (res2) => {
                let resp2 = '';
                res2.on('data', (chunk) => { resp2 += chunk; });
                res2.on('end', () => {
                    console.log('Login Status:', res2.statusCode);
                    console.log('Login Response:', resp2);
                });
            });
            req2.write(loginData);
            req2.end();
        });
    });

    req.on('error', (e) => {
        console.error('Request error:', e.message);
    });

    req.write(data);
    req.end();
}

testFetch();
