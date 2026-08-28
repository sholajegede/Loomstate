/**
 * The Loomstate surface inside the browser.
 *
 * It shows what is waiting, what is live, and what the agent just did, and it
 * lets a person answer an action or file the page they are on. It is meant to
 * be glanced at: one bounded read fills it, and the web app holds the rest.
 */

const $ = (id) => document.getElementById(id);

let state = { endpoint: "", token: "", appUrl: "", cursor: null };

function setMessage(text, isError = false) {
  const el = $("message");
  el.textContent = text ?? "";
  el.classList.toggle("error", Boolean(isError));
}

function timeAgo(at) {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

async function post(path, body) {
  const response = await fetch(`${state.endpoint}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.token}`,
    },
    body: JSON.stringify(body ?? {}),
  });
  if (!response.ok) {
    if (response.status === 401) {
      setMessage("Loomstate does not know this browser. Pair it again.", true);
    }
    return null;
  }
  return await response.json();
}

// --- rendering ------------------------------------------------------------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderLoops(loops, append) {
  const holder = $("loops");
  if (!append) holder.textContent = "";

  if (loops.length === 0 && !append) {
    holder.appendChild(
      el("p", "empty", "No loops yet. Browse as you normally do."),
    );
    return;
  }

  for (const loop of loops) {
    const card = el("button", "loop");

    const top = el("div", "loopTop");
    const tone = loop.paused
      ? "paused"
      : loop.status === "active"
        ? "active"
        : loop.status === "stalled"
          ? "stalled"
          : "";
    top.appendChild(el("span", `dot ${tone}`));
    top.appendChild(el("span", "loopName", loop.title));
    top.appendChild(el("span", "score", String(loop.aliveness)));
    card.appendChild(top);

    const blocked = loop.paused
      ? "stopped for review"
      : (loop.blocked ?? null);
    const meta = el(
      "p",
      blocked ? "loopMeta warn" : "loopMeta",
      blocked ?? `${loop.status} · ${timeAgo(loop.lastActivityAt)}`,
    );
    card.appendChild(meta);

    card.addEventListener("click", () => {
      void chrome.tabs.create({ url: `${state.appUrl}/loops/${loop._id}` });
    });
    holder.appendChild(card);
  }
}

function renderActivity(entries) {
  const holder = $("activity");
  holder.textContent = "";
  if (entries.length === 0) {
    $("activityBlock").classList.add("hidden");
    return;
  }
  $("activityBlock").classList.remove("hidden");

  for (const entry of entries) {
    const row = el("div", "entry");
    const head = `${entry.action} · ${timeAgo(entry.at)}${
      entry.loopTitle ? ` · ${entry.loopTitle}` : ""
    }`;
    row.appendChild(el("p", "entryTop", head));
    row.appendChild(el("p", "entryText", entry.detail));
    holder.appendChild(row);
  }
}

function tag(text, hot) {
  const node = el("span", hot ? "tag hot" : "tag", text);
  return node;
}

function renderApprovals(approvals) {
  const holder = $("approvals");
  holder.textContent = "";
  if (approvals.length === 0) {
    holder.classList.add("hidden");
    return;
  }
  holder.classList.remove("hidden");
  holder.appendChild(el("p", "blockTitle", `Needs you · ${approvals.length}`));

  for (const approval of approvals) {
    holder.appendChild(renderApproval(approval));
  }
}

function renderApproval(approval) {
  const card = el("div", "approval");
  card.appendChild(el("p", "loop", approval.loopTitle));
  card.appendChild(el("p", "subject", approval.subject));
  card.appendChild(el("p", "reason", approval.reason));

  const tags = el("div", "tags");
  tags.appendChild(tag(`${approval.riskLevel} risk`, approval.riskLevel === "high"));
  if (approval.commitsMoney) tags.appendChild(tag("commits money", true));
  if (!approval.reversible) tags.appendChild(tag("cannot undo", true));
  if (approval.stepUpRequired) tags.appendChild(tag("needs passkey", true));
  card.appendChild(tags);

  const note = document.createElement("textarea");
  note.rows = 2;
  note.placeholder = "Add a note (optional)";
  card.appendChild(note);

  const row = el("div", "row");

  const approve = el(
    "button",
    "",
    approval.stepUpRequired ? "Approve with passkey" : "Approve",
  );
  approve.addEventListener("click", async () => {
    approve.disabled = true;
    const result = await chrome.runtime.sendMessage({
      type: "loomstate:decide",
      approvalId: approval._id,
      decision: "approve",
      note: note.value,
    });
    if (result && result.needsStepUp && result.url) {
      await chrome.tabs.create({ url: result.url });
      window.close();
      return;
    }
    setMessage(result?.detail ?? "Loomstate answered.", result?.ok === false);
    await load();
  });

  const reject = el("button", "danger", "Reject");
  reject.addEventListener("click", async () => {
    reject.disabled = true;
    const result = await chrome.runtime.sendMessage({
      type: "loomstate:decide",
      approvalId: approval._id,
      decision: "reject",
      note: note.value,
    });
    setMessage(result?.detail ?? "Loomstate answered.", result?.ok === false);
    await load();
  });

  row.appendChild(approve);
  row.appendChild(reject);
  card.appendChild(row);
  return card;
}

// --- loading --------------------------------------------------------------

async function load() {
  const stored = await chrome.storage.local.get([
    "endpoint",
    "token",
    "paused",
    "appUrl",
  ]);
  state.endpoint = stored.endpoint ?? "";
  state.token = stored.token ?? "";
  state.appUrl = stored.appUrl ?? "";
  state.cursor = null;

  $("endpoint").value = state.endpoint;
  $("token").value = state.token ? "••••••••••••" : "";
  $("pause").textContent =
    stored.paused === true ? "Resume capture" : "Pause capture";

  if (state.endpoint === "" || state.token === "") {
    $("pairing").classList.remove("hidden");
    return;
  }

  $("pairing").classList.add("hidden");
  $("status").textContent = stored.paused === true ? "Paused" : "Capturing";
  $("status").classList.toggle("live", stored.paused !== true);

  // Opening the panel is also a chance to raise anything waiting, so a person
  // who opens it does not have to wait for the next alarm.
  void chrome.runtime.sendMessage({ type: "loomstate:pull" }).then(
    () => setTimeout(() => void showNotifyState(), 400),
    () => {},
  );

  const overview = await post("/x/overview", { numItems: 8 });
  if (overview === null) return;

  state.appUrl = overview.appUrl ?? state.appUrl;
  await chrome.storage.local.set({ appUrl: state.appUrl });

  $("paused").classList.toggle("hidden", overview.paused !== true);
  $("capture").classList.remove("hidden");
  $("loopsBlock").classList.remove("hidden");

  $("loopCount").textContent = `· ${overview.counts.activeLoops} active`;
  renderApprovals(overview.approvals ?? []);
  renderLoops(overview.loops.page, false);
  renderActivity(overview.activity ?? []);

  state.cursor = overview.loops.isDone ? null : overview.loops.continueCursor;
  $("moreLoops").classList.toggle("hidden", state.cursor === null);
}

async function loadMoreLoops() {
  if (state.cursor === null) return;
  const more = await post("/x/overview", { cursor: state.cursor, numItems: 8 });
  if (more === null) return;
  renderLoops(more.loops.page, true);
  state.cursor = more.loops.isDone ? null : more.loops.continueCursor;
  $("moreLoops").classList.toggle("hidden", state.cursor === null);
}

// --- quick add ------------------------------------------------------------

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

async function openCapture() {
  const tab = await currentTab();
  if (!tab || !tab.url || !/^https?:/.test(tab.url)) {
    setMessage("Loomstate can only add a web page.", true);
    return;
  }

  $("capturePage").textContent = tab.title || tab.url;
  $("captureForm").classList.remove("hidden");
  $("captureToggle").classList.add("hidden");

  const picker = $("loopPick");
  picker.textContent = "";
  const fresh = document.createElement("option");
  fresh.value = "";
  fresh.textContent = "A new loop";
  picker.appendChild(fresh);

  const payload = await post("/x/capture", { list: true });
  for (const loop of payload?.loops ?? []) {
    const option = document.createElement("option");
    option.value = loop._id;
    option.textContent = loop.title;
    picker.appendChild(option);
  }

  $("loopName").value = (tab.title || "").slice(0, 80);
  $("loopName").classList.remove("hidden");
}

function closeCapture() {
  $("captureForm").classList.add("hidden");
  $("captureToggle").classList.remove("hidden");
}

async function doCapture() {
  const tab = await currentTab();
  if (!tab || !tab.url) return;

  $("captureGo").disabled = true;
  const loopId = $("loopPick").value;
  const result = await post("/x/capture", {
    url: tab.url,
    title: tab.title ?? "",
    ...(loopId === "" ? { newLoopTitle: $("loopName").value } : { loopId }),
  });
  $("captureGo").disabled = false;

  setMessage(result?.detail ?? "Loomstate could not add the page.", result?.ok === false);
  if (result?.ok) {
    closeCapture();
    await load();
  }
}

// --- wiring ---------------------------------------------------------------

$("save").addEventListener("click", async () => {
  const endpoint = $("endpoint").value.trim().replace(/\/+$/, "");
  const token = $("token").value.trim();
  if (endpoint === "" || token === "" || token.startsWith("•")) {
    setMessage("Enter the address and the token.", true);
    return;
  }
  await chrome.storage.local.set({ endpoint, token, appUrl: endpoint, paused: false });
  setMessage("This browser is paired.");
  await load();
});

$("pause").addEventListener("click", async () => {
  const { paused } = await chrome.storage.local.get("paused");
  await chrome.storage.local.set({ paused: paused !== true });
  await load();
});

$("dashboard").addEventListener("click", async () => {
  await chrome.tabs.create({ url: state.appUrl || "https://convex.dev" });
});

/**
 * The side panel stays open while the person browses, which is the point of
 * living in the extension. It shows this same page, so it never offers to open
 * itself again.
 */
const inPanel = new URLSearchParams(location.search).get("panel") === "1";
if (inPanel || !chrome.sidePanel) {
  $("dock").classList.add("hidden");
} else {
  $("dock").addEventListener("click", async () => {
    const window_ = await chrome.windows.getCurrent();
    await chrome.sidePanel.open({ windowId: window_.id });
    window.close();
  });
}

$("captureToggle").addEventListener("click", () => void openCapture());
$("captureCancel").addEventListener("click", closeCapture);
$("captureGo").addEventListener("click", () => void doCapture());
$("moreLoops").addEventListener("click", () => void loadMoreLoops());

$("loopPick").addEventListener("change", () => {
  $("loopName").classList.toggle("hidden", $("loopPick").value !== "");
});

/**
 * Says plainly when a waiting action cannot reach the person.
 *
 * A browser notification that is refused looks exactly like one that worked,
 * so without this the only sign is that nothing appears.
 */
async function showNotifyState() {
  const version = chrome.runtime.getManifest().version;
  const badge = $("build");
  if (badge) badge.textContent = `v${version}`;

  const stored = await chrome.storage.local.get([
    "permission",
    "lastPullAt",
    "lastPullCount",
    "lastShownAt",
    "lastShownCount",
    "lastNotifyError",
    "lastPullError",
  ]);

  // What the drain is actually doing, so nobody has to guess whether it runs.
  const checked =
    stored.lastPullAt === undefined
      ? "not checked yet"
      : `checked ${timeAgo(stored.lastPullAt)}`;
  const pulled =
    stored.lastPullCount === undefined
      ? ""
      : `, ${stored.lastPullCount} waiting`;
  const raised =
    stored.lastShownCount === undefined
      ? ""
      : `, ${stored.lastShownCount} raised ${
          stored.lastShownAt ? timeAgo(stored.lastShownAt) : ""
        }`;
  const permission = stored.permission ? `, permission ${stored.permission}` : "";
  $("notifyState").textContent = `${checked}${pulled}${raised}${permission}`;

  // The exact words Chrome used, never a summary of them.
  const error = stored.lastNotifyError || stored.lastPullError || "";
  $("notifyError").textContent = error === "" ? "" : `Chrome said: ${error}`;
  $("notifyError").classList.toggle("hidden", error === "");

  // Only a refusal is worth a banner. A notification that went out says so on
  // the line above, and repeating that as a warning turns working software into
  // a standing complaint.
  const el = $("notifyWarning");
  const text =
    stored.permission === "denied"
      ? "Chrome blocks notifications for this extension. Open chrome://settings/content/notifications and allow them."
      : "";
  el.textContent = text;
  el.classList.toggle("hidden", text === "");
}

void showNotifyState();
void load();
