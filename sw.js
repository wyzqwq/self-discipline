// 自控台 Service Worker —— v1.4 阶段二：iOS 授权 + 本地测试通知 + Web Push 接收。
// 只适配苹果（iOS 16.4+ / 已加主屏幕的 PWA）。
const SW_VERSION = 'v1.5.3';

// 装完立即接管，不等旧页面全部关闭。
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

// 阶段一：页面通过 postMessage 触发一条本地测试通知，验证 showNotification 通道。
self.addEventListener('message', (e) => {
  const data = e.data || {};
  if (data.type === 'test-notification') {
    self.registration.showNotification(data.title || '自控台', {
      body: data.body || '通知已开启，到点我会提醒你确认定式。',
      tag: 'rsip-test',
      renotify: true,
    });
  }
});

// 阶段二预留：接收服务端 Web Push。
self.addEventListener('push', (e) => {
  let payload = {};
  try { payload = e.data ? e.data.json() : {}; } catch (_) { payload = { body: e.data && e.data.text() }; }
  const title = payload.title || '自控台';
  e.waitUntil(self.registration.showNotification(title, {
    body: payload.body || '有定式待确认',
    tag: payload.tag || 'rsip-push',
    data: payload.data || {},
    renotify: true,
  }));
});

// 点通知 → 聚焦已开的 App，没有就打开。
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) return c.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow('./');
  })());
});
