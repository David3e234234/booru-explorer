import { fetchPushPublicKey, apiPushSubscribe, apiPushUnsubscribe } from '../api.js';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

export async function getActivePushSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    return reg ? await reg.pushManager.getSubscription() : null;
  } catch {
    return null;
  }
}

export async function enablePushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, reason: 'Браузер не поддерживает push-уведомления' };
  }

  let permission = Notification.permission;
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }
  if (permission !== 'granted') {
    return { ok: false, reason: 'Разрешение на уведомления не выдано' };
  }

  try {
    const publicKey = await fetchPushPublicKey();
    if (!publicKey) {
      return { ok: false, reason: 'Сервер уведомлений недоступен' };
    }

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });
    }

    const res = await apiPushSubscribe(sub.toJSON());
    if (!res.success) {
      return { ok: false, reason: res.message || 'Не удалось сохранить подписку' };
    }
    return { ok: true };
  } catch (err) {
    console.warn('[Push] Ошибка включения уведомлений:', err);
    return { ok: false, reason: err.name === 'NotAllowedError' ? 'Уведомления заблокированы в браузере' : 'Не удалось включить уведомления' };
  }
}

export async function disablePushNotifications() {
  try {
    const sub = await getActivePushSubscription();
    if (sub) {
      await apiPushUnsubscribe(sub.endpoint).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'Не удалось отключить уведомления' };
  }
}
