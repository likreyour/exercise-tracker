/**
 * 运动记录App - Service Worker v3
 * 功能：离线缓存 + PWA自动更新提示 + 更好的缓存策略
 */

const CACHE_NAME = 'exercise-tracker-v5';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/styles.css',
    '/app.js',
    '/manifest.json',
    '/icon-192.svg',
    '/icon-512.svg'
];

const CACHE_STRATEGIES = {
    // 导航请求：network-first，确保获取最新页面
    navigate: 'network-first',
    // 静态资源：cache-first，加速加载
    static: 'cache-first',
    // 高德地图等外部资源：stale-while-revalidate
    external: 'stale-while-revalidate'
};

// 安装
self.addEventListener('install', event => {
    console.log('[SW-v3] Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[SW-v3] Caching assets');
                return cache.addAll(STATIC_ASSETS).catch(err => {
                    console.warn('[SW-v3] Some assets failed to cache:', err);
                });
            })
            .then(() => {
                console.log('[SW-v3] Skip waiting to activate immediately');
                return self.skipWaiting();
            })
    );
});

// 激活
self.addEventListener('activate', event => {
    console.log('[SW-v3] Activating...');
    event.waitUntil(
        caches.keys()
            .then(cacheNames => {
                return Promise.all(
                    cacheNames
                        .filter(name => name !== CACHE_NAME)
                        .map(name => {
                            console.log('[SW-v3] Deleting old cache:', name);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => {
                console.log('[SW-v3] Claiming clients');
                return self.clients.claim();
            })
    );
});

// 获取请求类型
function getRequestStrategy(request) {
    const url = new URL(request.url);

    // 同源导航请求
    if (url.origin === self.location.origin && request.mode === 'navigate') {
        return CACHE_STRATEGIES.navigate;
    }

    // 同源静态资源
    if (url.origin === self.location.origin) {
        return CACHE_STRATEGIES.static;
    }

    // 外部资源（高德地图等）
    return CACHE_STRATEGIES.external;
}

// 网络优先策略（适合导航）
async function networkFirst(request) {
    try {
        const response = await fetch(request);
        // Cache successful responses regardless of status code (for CORS)
        if (response && response.status >= 200 && response.status < 400) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
        }
        return response;
    } catch (error) {
        const cachedResponse = await caches.match(request);
        if (cachedResponse) return cachedResponse;
        throw error;
    }
}

// 缓存优先策略（适合静态资源）
async function cacheFirst(request) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) return cachedResponse;

    try {
        const response = await fetch(request);
        if (response && response.status === 200) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
        }
        return response;
    } catch (error) {
        throw error;
    }
}

// Stale-while-revalidate（适合外部资源）
async function staleWhileRevalidate(request) {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(request);

    const fetchPromise = fetch(request)
        .then(response => {
            if (response && response.status === 200) {
                cache.put(request, response.clone());
            }
            return response;
        })
        .catch(() => null);

    return cachedResponse || fetchPromise;
}

// 主 fetch 处理器
self.addEventListener('fetch', event => {
    // 只处理同源请求和明确允许的跨域请求
    const url = new URL(event.request.url);

    // 跳过非 GET 请求
    if (event.request.method !== 'GET') return;

    // 跳过 chrome-extension 和其他特殊协议
    if (!url.protocol.startsWith('http')) return;

    // 强制网络优先：始终从网络获取最新内容
    // 这是 SPA，index.html 必须始终获取最新版本
    if (url.origin === self.location.origin && (url.pathname === '/' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('.html'))) {
        event.respondWith(networkFirst(event.request));
        return;
    }

    const strategy = getRequestStrategy(event.request);

    switch (strategy) {
        case 'network-first':
            event.respondWith(networkFirst(event.request));
            break;
        case 'cache-first':
            event.respondWith(cacheFirst(event.request));
            break;
        case 'stale-while-revalidate':
            event.respondWith(staleWhileRevalidate(event.request));
            break;
    }
});

// 监听来自主线程的消息
self.addEventListener('message', event => {
    if (!event.data) return;

    if (event.data.type === 'SKIP_WAITING') {
        console.log('[SW-v3] Skip waiting triggered');
        self.skipWaiting();
    }

    if (event.data.type === 'GET_VERSION') {
        event.ports[0].postMessage({ version: CACHE_NAME });
    }
});

// 后台同步（预留）
self.addEventListener('sync', event => {
    console.log('[SW-v3] Background sync:', event.tag);
});
