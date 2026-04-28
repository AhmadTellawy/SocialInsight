self.addEventListener('push', function (event) {
    if (event.data) {
        try {
            const data = event.data.json();
            const title = data.title || 'New Notification';
            const options = {
                body: data.body || 'You have a new update.',
                icon: data.icon || '/logo.png', // Assuming a logo.png exists in public/
                badge: '/logo.png',
                data: {
                    url: data.url || '/'
                }
            };

            event.waitUntil(self.registration.showNotification(title, options));
        } catch (e) {
            console.error('Error parsing push data', e);
        }
    }
});

self.addEventListener('notificationclick', function (event) {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then(windowClients => {
            // Check if there is already a window/tab open with the target URL
            for (var i = 0; i < windowClients.length; i++) {
                var client = windowClients[i];
                // If so, just focus it.
                if (client.url === event.notification.data.url && 'focus' in client) {
                    return client.focus();
                }
            }
            // If not, then open the target URL in a new window/tab.
            if (clients.openWindow) {
                return clients.openWindow(event.notification.data.url);
            }
        })
    );
});
