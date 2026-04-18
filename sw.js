/**
 * 运动记录App - Service Worker v2
 * 功能：离线缓存 + PWA自动更新提示
 */

const CACHE_NAME = 'exercise-tracker-v2';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/styles.css',
    '/app.js',
    '/manifest.json'
];

// 安装
self.addEventListener('install', event => {
    console.log('[SW] Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[SW] Caching assets');
                return cache.addAll(STATIC_ASSETS).catch(err => {
                    console.warn('[SW] Some assets failed to cache:', err);
                });
            })
            .then(() => {
                console.log('[SW] Skip waiting to activate immediately');
                return self.skipWaiting();
            })
    );
});

// 激活
self.addEventListener('activate', event => {
    console.log('[SW] Activating...');
    event.waitUntil(
        caches.keys()
            .then(cacheNames => {
                return Promise.all(
                    cacheNames
                        .filter(name => name !== CACHE_NAME)
                        .map(name => {
                            console.log('[SW] Deleting old cache:', name);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => {
                console.log('[SW] Claiming clients');
                return self.clients.claim();
            })
    );
});

// 请求拦截
self.addEventListener('fetch', event => {
    // 只缓存同源请求
    if (!event.request.url.startsWith(self.location.origin)) return;

    // 对于 HTML 页面，使用 network-first（确保获取最新版本）
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    if (response && response.status === 200) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    }
                    return response;
                })
                .catch(() => caches.match(event.request))
        );
        return;
    }

    // 其他资源使用 cache-first
    event.respondWith(
        caches.match(event.request)
            .then(cachedResponse => {
                if (cachedResponse) return cachedResponse;

                return fetch(event.request)
                    .then(response => {
                        if (!response || response.status !== 200 || response.type !== 'basic') {
                            // 对于跨域资源，也缓存 opaque 响应
                            if (response && response.type === 'opaque') {
                                const clone = response.clone();
                                caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                            }
                            return response;
                        }

                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                        return response;
                    })
                    .catch(err => {
                        console.warn('[SW] Fetch failed:', err);
                    });
            })
    );
});

// PWA 更新提示：通知主线程发现新版本
self.addEventListener('install', event => {
    // 当新的 SW 进入 waiting 状态时通知所有客户端
    self.addEventListener('statechange', event => {
        if (event.target.state === 'installed') {
            // 通知所有客户端
            self.clients.matchAll().then(clients => {
                clients.forEach(client => {
                    client.postMessage({
                        type: 'NEW_VERSION_AVAILABLE',
                        version: CACHE_NAME
                    });
                });
            });
        }
    });
});

// 监听来自主线程的消息
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        console.log('[SW] Skip waiting triggered');
        self.skipWaiting();
    }
});
