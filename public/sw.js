// 스페이스 톡 서비스 워커: 웹 알림 표시와 알림을 눌렀을 때 대화방 열기
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let title = '스페이스 톡';
    let body = '새 메시지가 도착했습니다.';
    let url = '/chat';
    let tag = 'space-talk';
    let total = 0;
    try {
      // The push itself carries no content; read the unread summary with this device's login cookie.
      const response = await fetch('/api/chat/unread', { credentials: 'include', cache: 'no-store' });
      if (response.ok) {
        const data = await response.json();
        total = data.total || 0;
        if (data.latest) {
          title = data.latest.name;
          body = `${data.latest.unread > 1 ? `새 메시지 ${data.latest.unread}개 · ` : ''}${data.latest.preview || '새 메시지'}`;
          url = `/chat#room=${data.latest.roomId}`;
          tag = `room-${data.latest.roomId}`;
        } else if (total) {
          body = `읽지 않은 메시지 ${total}개가 있습니다.`;
        }
      }
    } catch (error) { /* offline: show the generic notice */ }
    if (self.navigator.setAppBadge) self.navigator.setAppBadge(total).catch(() => {});
    await self.registration.showNotification(title, { body, tag, renotify: true, icon: '/icons/icon-512.png', badge: '/icons/icon-512.png', data: { url } });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/chat', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const chat = windows.find(client => new URL(client.url).pathname === '/chat');
    if (chat) {
      await chat.focus();
      chat.postMessage({ type: 'open', url });
      return;
    }
    await self.clients.openWindow(url);
  })());
});
