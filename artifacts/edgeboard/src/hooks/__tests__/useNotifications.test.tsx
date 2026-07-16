// @vitest-environment jsdom
//
// Push subscription rotation recovery. Browsers can silently rotate a push
// endpoint (service-worker update, browser upgrade) — the server then only
// knows the dead endpoint and the bettor stops getting alerts with no error
// anywhere. The hook must re-register the browser's CURRENT subscription on
// every load. If the server answers 409 (endpoint owned by another account,
// e.g. a shared browser profile), the hook must not lie: it drops the browser
// subscription and reports "not subscribed" so the UI offers re-enabling.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useNotifications } from "../useNotifications";

// ── Browser push API fakes ───────────────────────────────────────────────────

const unsubscribeMock = vi.fn(async () => true);

function makeFakeSub(endpoint: string) {
  return {
    endpoint,
    getKey: (_name: string) => new Uint8Array([1, 2, 3]).buffer,
    unsubscribe: unsubscribeMock,
  };
}

let currentBrowserSub: ReturnType<typeof makeFakeSub> | null = null;

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  currentBrowserSub = makeFakeSub("https://push.example.com/rotated-endpoint");

  Object.defineProperty(globalThis.navigator, "serviceWorker", {
    configurable: true,
    value: {
      ready: Promise.resolve({
        pushManager: {
          getSubscription: async () => currentBrowserSub,
          subscribe: async () => currentBrowserSub,
        },
      }),
    },
  });
  (globalThis as Record<string, unknown>).PushManager = function PushManager() {};
  (globalThis as Record<string, unknown>).Notification = { permission: "granted" };
  (globalThis as Record<string, unknown>).fetch = fetchMock;
});

function respond(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("useNotifications mount re-sync", () => {
  it("re-registers the browser's current endpoint with the server on load", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/preferences") && (!init || !init.method || init.method === "GET"))
        return respond(200, { notifyOverdue: false, notifyTilt: true, notifyCrewActivity: true });
      if (url.includes("/subscribe")) return respond(200, { notifyOverdue: false, notifyTilt: true, notifyCrewActivity: true });
      return respond(404, {});
    });

    const { result } = renderHook(() => useNotifications());

    await waitFor(() => {
      const subscribeCall = fetchMock.mock.calls.find(([u]) => String(u).includes("/subscribe"));
      expect(subscribeCall).toBeTruthy();
    });
    const [, init] = fetchMock.mock.calls.find(([u]) => String(u).includes("/subscribe"))!;
    const body = JSON.parse((init as RequestInit).body as string);
    // The CURRENT (possibly rotated) endpoint is what gets registered…
    expect(body.endpoint).toBe("https://push.example.com/rotated-endpoint");
    // …and saved server prefs ride along so toggles are never clobbered.
    expect(body.notifyOverdue).toBe(false);
    expect(body.notifyCrewActivity).toBe(true);
    await waitFor(() => expect(result.current.subscribed).toBe(true));
    expect(unsubscribeMock).not.toHaveBeenCalled();
  });

  it("on 409 (endpoint owned by another account) drops the browser sub and reports not-subscribed", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/preferences") && (!init || !init.method || init.method === "GET"))
        return respond(200, { notifyOverdue: true, notifyTilt: true, notifyCrewActivity: false });
      if (url.includes("/subscribe")) return respond(409, { error: "subscription_owned_by_another_user" });
      return respond(404, {});
    });

    const { result } = renderHook(() => useNotifications());

    await waitFor(() => expect(unsubscribeMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.subscribed).toBe(false));
  });
});
