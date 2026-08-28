import { isReportableUrl } from "./exclusions.js";

const FLUSH_ALARM = "loomstate-flush";
const NOTIFY_PREFIX = "loomstate-approval-";
const MIN_DWELL_MS = 4000;
const MAX_BATCH = 50;

/** The page the user is looking at right now, and when it took focus. */
let current = null;
let queue = [];

async function settings() {
  const stored = await chrome.storage.local.get([
    "endpoint",
    "token",
    "paused",
    "extraBlocked",
  ]);
  return {
    endpoint: stored.endpoint ?? "",
    token: stored.token ?? "",
    paused: stored.paused === true,
    extraBlocked: stored.extraBlocked ?? [],
  };
}

/** Closes the open page and queues it when the user read it long enough. */
async function closeCurrent(now) {
  if (current === null) return;
  const dwellMs = now - current.startedAt;
  const finished = current;
  current = null;
  if (dwellMs < MIN_DWELL_MS) return;

  queue.push({
    url: finished.url,
    title: finished.title,
    kind: "visit",
    dwellMs,
    occurredAt: finished.startedAt,
  });
  if (queue.length >= MAX_BATCH) await flush();
}

async function openPage(url, title) {
  const { paused, extraBlocked } = await settings();
  if (paused) return;
  if (!isReportableUrl(url, extraBlocked)) return;
  current = { url, title: title ?? "", startedAt: Date.now() };
}

async function flush() {
  const { endpoint, token } = await settings();
  if (queue.length === 0 || endpoint === "" || token === "") return;

  const batch = queue.slice(0, 100);
  try {
    const response = await fetch(`${endpoint}/x/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ events: batch }),
    });
    if (response.ok) {
      queue = queue.slice(batch.length);
      await chrome.storage.local.set({ lastSentAt: Date.now() });
    } else if (response.status === 401) {
      // The owner stopped this browser. Hold the events and stop retrying hard.
      await chrome.storage.local.set({ lastError: "This browser is not paired." });
    }
  } catch (error) {
    await chrome.storage.local.set({ lastError: String(error) });
  }
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await closeCurrent(Date.now());
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab?.url) await openPage(tab.url, tab.title);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.active || !tab.url) return;
  if (current !== null && current.url === tab.url) {
    current.title = tab.title ?? current.title;
    return;
  }
  await closeCurrent(Date.now());
  await openPage(tab.url, tab.title);
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    await closeCurrent(Date.now());
    await flush();
  }
});

/**
 * Raises a browser notification for every action waiting on the person.
 * Loomstate decides what is worth telling them; this only shows it. The
 * service worker runs on its alarm, so this reaches them with every tab shut.
 */
async function pullNotifications() {
  const { endpoint, token } = await settings();
  if (endpoint === "" || token === "") return;

  let payload;
  try {
    const response = await fetch(`${endpoint}/x/notifications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" , Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      await note({ lastPullError: `server said ${response.status}` });
      return;
    }
    payload = await response.json();
  } catch (error) {
    await note({ lastPullError: String(error) });
    return;
  }

  const waiting = payload.notifications ?? [];
  await note({
    lastPullAt: Date.now(),
    lastPullCount: waiting.length,
    lastPullError: "",
    permission: await permissionLevel(),
  });

  // Only what the browser really showed is reported back, so an action is not
  // marked told when the notification never appeared.
  const raised = [];
  for (const item of waiting) {
    const id = `${NOTIFY_PREFIX}${item.id}`;

    // An action still waiting can be answered from the notification itself.
    // Anything else is only a link to open.
    const answerable = typeof item.approvalId === "string";
    const buttons = answerable
      ? [
          { title: item.stepUpRequired ? "Approve with passkey" : "Approve" },
          { title: "Reject" },
        ]
      : undefined;

    const shown = await show(id, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: item.title,
      message: item.body,
      priority: 2,
      requireInteraction: true,
      ...(buttons ? { buttons } : {}),
    });
    if (!shown) continue;
    raised.push(item.id);

    // Remember what this notification is about, so a click or a button press
    // knows which action to answer and where to send the person.
    await chrome.storage.local.set({
      [id]: {
        url: item.url,
        approvalId: item.approvalId ?? null,
        stepUpRequired: item.stepUpRequired === true,
      },
    });
  }

  if (raised.length > 0) {
    try {
      await fetch(`${endpoint}/x/notifications`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ raised }),
      });
      await note({ lastShownAt: Date.now(), lastShownCount: raised.length });
    } catch (error) {
      await note({ lastPullError: String(error) });
    }
  }
}

/**
 * Raises one notification and says whether it really appeared. Chrome reports
 * a refused notification through lastError rather than by throwing, so without
 * this a blocked notification looks exactly like a delivered one.
 */
function show(id, options) {
  return new Promise((resolve) => {
    try {
      chrome.notifications.create(id, options, () => {
        const failure = chrome.runtime.lastError;
        if (failure) {
          void note({ lastNotifyError: failure.message ?? "refused" });
          resolve(false);
          return;
        }
        resolve(true);
      });
    } catch (error) {
      void note({ lastNotifyError: String(error) });
      resolve(false);
    }
  });
}

/** What Chrome and the operating system allow this extension to show. */
function permissionLevel() {
  return new Promise((resolve) => {
    try {
      chrome.notifications.getPermissionLevel((level) => resolve(level));
    } catch {
      resolve("unknown");
    }
  });
}

/** Records how the last drain went, so the panel can show it. */
async function note(fields) {
  await chrome.storage.local.set(fields);
}

/** Answers one waiting action. Returns what the server said. */
async function decide(approvalId, decision, note) {
  const { endpoint, token } = await settings();
  if (endpoint === "" || token === "") {
    return { ok: false, detail: "This browser is not paired." };
  }
  try {
    const response = await fetch(`${endpoint}/x/decide`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ approvalId, decision, note: note ?? "" }),
    });
    return await response.json();
  } catch (error) {
    return { ok: false, detail: String(error) };
  }
}

/** Tells the person what happened, without another round trip. */
function report(text) {
  chrome.notifications.create(`${NOTIFY_PREFIX}result-${Date.now()}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title: "Loomstate",
    message: text,
    priority: 1,
  });
}

chrome.notifications.onButtonClicked.addListener(async (id, index) => {
  if (!id.startsWith(NOTIFY_PREFIX)) return;
  const stored = await chrome.storage.local.get(id);
  const meta = stored[id];
  if (!meta || !meta.approvalId) return;

  chrome.notifications.clear(id);
  const decision = index === 0 ? "approve" : "reject";
  const result = await decide(meta.approvalId, decision);

  // Releasing money needs the passkey, which only the app origin can ask for.
  if (result && result.needsStepUp && result.url) {
    await chrome.tabs.create({ url: result.url });
  } else {
    report(result?.detail ?? "Loomstate answered.");
  }
  await chrome.storage.local.remove(id);
});

chrome.notifications.onClicked.addListener(async (id) => {
  if (!id.startsWith(NOTIFY_PREFIX)) return;
  const stored = await chrome.storage.local.get(id);
  const meta = stored[id];
  const url = typeof meta === "string" ? meta : meta?.url;
  if (url) await chrome.tabs.create({ url });
  chrome.notifications.clear(id);
  await chrome.storage.local.remove(id);
});

/**
 * Keeps the repeating alarm alive without restarting it.
 *
 * This worker is woken by ordinary browsing, and every wake re-runs this file.
 * Creating the alarm again on each wake reset its countdown, so a person who
 * changed tab more often than the period never reached it and the alarm never
 * fired. Browsing events still went out, because the tab listeners send those
 * directly, but nothing that waits on the alarm ever ran. It is created now
 * only when it is missing.
 */
async function ensureAlarm() {
  const existing = await chrome.alarms.get(FLUSH_ALARM);
  if (existing === undefined) {
    await chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: 0.5 });
  }
}

void ensureAlarm();
chrome.runtime.onInstalled.addListener(() => void ensureAlarm());
chrome.runtime.onStartup.addListener(() => void ensureAlarm());

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== FLUSH_ALARM) return;
  // Report the open page as it is read, so the dashboard moves while browsing.
  if (current !== null && Date.now() - current.startedAt >= MIN_DWELL_MS) {
    const snapshot = { ...current };
    current = { ...current, startedAt: Date.now() };
    queue.push({
      url: snapshot.url,
      title: snapshot.title,
      kind: "dwell",
      dwellMs: Date.now() - snapshot.startedAt,
      occurredAt: snapshot.startedAt,
    });
  }
  // Each is tried on its own. A send that fails must not stop the person being
  // told about an action that is waiting for them.
  try {
    await flush();
  } catch (error) {
    await note({ lastError: String(error) });
  }
  await pullNotifications();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "loomstate:flush") {
    void closeCurrent(Date.now())
      .then(flush)
      .then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === "loomstate:queueSize") {
    sendResponse({ size: queue.length });
    return false;
  }
  if (message?.type === "loomstate:decide") {
    void decide(message.approvalId, message.decision, message.note).then(
      sendResponse,
    );
    return true;
  }
  if (message?.type === "loomstate:pull") {
    void pullNotifications().then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
