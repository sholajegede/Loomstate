import { isReportableUrl } from "./exclusions.js";

const FLUSH_ALARM = "loomstate-flush";
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

chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: 0.5 });
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
  await flush();
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
  return false;
});
