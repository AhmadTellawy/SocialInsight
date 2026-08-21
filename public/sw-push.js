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
    var targetUrl = new URL(event.notification.data.url || '/', self.location.origin).href;
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            for (var i = 0; i < windowClients.length; i++) {
                var client = windowClients[i];
                if (client.url === targetUrl && 'focus' in client) {
                    return client.focus();
                }
            }

            for (var j = 0; j < windowClients.length; j++) {
                var appClient = windowClients[j];
                if (new URL(appClient.url).origin === self.location.origin && 'navigate' in appClient) {
                    return appClient.navigate(targetUrl).then(function (navigatedClient) {
                        return navigatedClient && 'focus' in navigatedClient ? navigatedClient.focus() : navigatedClient;
                    });
                }
            }

            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});
