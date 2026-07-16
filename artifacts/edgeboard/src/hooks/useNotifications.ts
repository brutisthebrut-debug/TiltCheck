/**
 * useNotifications — manages the full push notification lifecycle on the
 * client. Returns permission state, subscription helpers, and preference
 * toggles so the Account page only needs to wire up UI.
 *
 * Preference state is always loaded from the server on mount (for subscribed
 * users) so the UI reflects the true saved state, not hardcoded defaults.
 * Individual toggle updates use PATCH (partial) only — never re-subscribe
 * with local state, which would risk overwriting other saved toggles.
 */

import { useState, useEffect, useCallback, useRef } from "react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Fetchers ─────────────────────────────────────────────────────────────────

async function fetchVapidKey(): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/api/notifications/vapid-public-key`, {
      credentials: "include",
    });
    if (!res.ok) return null;
    const { publicKey } = await res.json();
    return publicKey ?? null;
  } catch {
    return null;
  }
}

async function fetchServerPrefs(): Promise<NotificationPrefs | null> {
  try {
    const res = await fetch(`${API_BASE}/api/notifications/preferences`, {
      credentials: "include",
    });
    if (!res.ok) return null;
    return (await res.json()) as NotificationPrefs;
  } catch {
    return null;
  }
}

async function serverSubscribe(
  sub: PushSubscription,
  prefs: NotificationPrefs
): Promise<boolean> {
  const key = sub.getKey("p256dh");
  const auth = sub.getKey("auth");
  if (!key || !auth) return false;
  const p256dhKey = btoa(String.fromCharCode(...new Uint8Array(key)));
  const authKey = btoa(String.fromCharCode(...new Uint8Array(auth)));
  const res = await fetch(`${API_BASE}/api/notifications/subscribe`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: sub.endpoint, p256dhKey, authKey, ...prefs }),
  });
  return res.ok;
}

async function serverUnsubscribe(endpoint: string): Promise<void> {
  await fetch(`${API_BASE}/api/notifications/unsubscribe`, {
    method: "DELETE",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
}

/** Partial PATCH — never touches keys not included in the payload. */
async function serverPatchPref(key: keyof NotificationPrefs, value: boolean): Promise<boolean> {
  const res = await fetch(`${API_BASE}/api/notifications/preferences`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ [key]: value }),
  });
  return res.ok;
}

// ── URL-safe base64 → Uint8Array (for VAPID public key) ─────────────────────

function urlB64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface NotificationPrefs {
  notifyOverdue: boolean;
  notifyTilt: boolean;
  notifyCrewActivity: boolean;
}

export interface UseNotificationsReturn {
  supported: boolean;
  permission: NotificationPermission | "unknown";
  subscribed: boolean;
  prefs: NotificationPrefs;
  loading: boolean;
  requestAndSubscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
  updatePref: (key: keyof NotificationPrefs, value: boolean) => Promise<void>;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

const DEFAULT_PREFS: NotificationPrefs = {
  notifyOverdue: true,
  notifyTilt: true,
  notifyCrewActivity: false,
};

export function useNotifications(): UseNotificationsReturn {
  const supported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;

  const [permission, setPermission] = useState<NotificationPermission | "unknown">(
    supported ? Notification.permission : "unknown"
  );
  const [subscribed, setSubscribed] = useState(false);
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [loading, setLoading] = useState(false);

  // Track whether we've already hydrated from the server so we don't repeat it.
  const hydratedRef = useRef(false);

  // On mount: check for an existing browser subscription and, if found, load
  // the authoritative preferences from the server instead of using defaults.
  useEffect(() => {
    if (!supported || hydratedRef.current) return;
    hydratedRef.current = true;

    navigator.serviceWorker.ready
      .then(async (reg) => {
        const sub = await reg.pushManager.getSubscription();
        if (!sub) return; // not subscribed — defaults are fine
        setSubscribed(true);
        // Load server-side truth so the toggles reflect what was actually saved.
        const serverPrefs = await fetchServerPrefs();
        if (serverPrefs) setPrefs(serverPrefs);
      })
      .catch(() => {});
  }, [supported]);

  const requestAndSubscribe = useCallback(async () => {
    if (!supported) return;
    setLoading(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") return;

      const vapidKey = await fetchVapidKey();
      if (!vapidKey) return;

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // Cast: TS strict mode narrows Uint8Array to Uint8Array<ArrayBuffer>
        // but the generated array is Uint8Array<ArrayBufferLike>; both work at runtime.
        applicationServerKey: urlB64ToUint8Array(vapidKey) as unknown as BufferSource,
      });

      // Load server-side prefs first so we don't clobber existing saved
      // preferences when re-subscribing from a new browser tab.
      const serverPrefs = await fetchServerPrefs();
      const effectivePrefs = serverPrefs ?? prefs;
      if (serverPrefs) setPrefs(serverPrefs);

      const ok = await serverSubscribe(sub, effectivePrefs);
      if (ok) setSubscribed(true);
    } finally {
      setLoading(false);
    }
  }, [supported, prefs]);

  const unsubscribe = useCallback(async () => {
    if (!supported) return;
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await serverUnsubscribe(sub.endpoint);
        await sub.unsubscribe();
        setSubscribed(false);
        setPrefs(DEFAULT_PREFS);
      }
    } finally {
      setLoading(false);
    }
  }, [supported]);

  /**
   * Update a single preference toggle.
   * Uses PATCH (partial update) so only the named key is sent — other server-
   * side prefs are never touched. Does NOT re-subscribe, which would risk
   * overwriting other toggles with stale local state.
   */
  const updatePref = useCallback(
    async (key: keyof NotificationPrefs, value: boolean) => {
      setPrefs((prev) => ({ ...prev, [key]: value }));
      await serverPatchPref(key, value);
    },
    []
  );

  return { supported, permission, subscribed, prefs, loading, requestAndSubscribe, unsubscribe, updatePref };
}
