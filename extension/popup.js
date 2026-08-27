const $ = (id) => document.getElementById(id);

function setMessage(text, isError = false) {
  const el = $("message");
  el.textContent = text;
  el.classList.toggle("error", isError);
}

async function load() {
  const stored = await chrome.storage.local.get([
    "endpoint",
    "token",
    "paused",
    "dashboardUrl",
  ]);
  $("endpoint").value = stored.endpoint ?? "";
  $("token").value = stored.token ? "••••••••••••" : "";
  $("pause").textContent = stored.paused === true ? "Resume capture" : "Pause capture";

  if (stored.endpoint && stored.token) {
    $("status").textContent = stored.paused === true ? "Paused" : "Capturing";
    $("status").classList.toggle("live", stored.paused !== true);
    $("pairing").classList.add("hidden");
    await refreshCounts(stored.endpoint, stored.token);
    await loadApprovals(stored.endpoint, stored.token);
  }
}

/**
 * Shows what is waiting and lets the person answer it here. Approving an
 * action that needs a passkey opens the web app, because only that origin can
 * ask for one.
 */
async function loadApprovals(endpoint, token) {
  const holder = $("approvals");
  let approvals = [];
  try {
    const response = await fetch(`${endpoint}/x/approvals`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return;
    const payload = await response.json();
    approvals = payload.approvals ?? [];
  } catch {
    return;
  }

  holder.textContent = "";
  if (approvals.length === 0) {
    holder.classList.add("hidden");
    return;
  }
  holder.classList.remove("hidden");

  for (const approval of approvals) {
    holder.appendChild(renderApproval(approval, endpoint, token));
  }
}

function tag(text, hot) {
  const el = document.createElement("span");
  el.className = hot ? "tag hot" : "tag";
  el.textContent = text;
  return el;
}

function renderApproval(approval, endpoint, token) {
  const card = document.createElement("div");
  card.className = "approval";

  const loop = document.createElement("p");
  loop.className = "loop";
  loop.textContent = approval.loopTitle;
  card.appendChild(loop);

  const subject = document.createElement("p");
  subject.className = "subject";
  subject.textContent = approval.subject;
  card.appendChild(subject);

  const reason = document.createElement("p");
  reason.className = "reason";
  reason.textContent = approval.reason;
  card.appendChild(reason);

  const tags = document.createElement("div");
  tags.className = "tags";
  tags.appendChild(tag(`${approval.riskLevel} risk`, approval.riskLevel === "high"));
  if (approval.commitsMoney) tags.appendChild(tag("commits money", true));
  if (!approval.reversible) tags.appendChild(tag("cannot undo", true));
  if (approval.stepUpRequired) tags.appendChild(tag("needs passkey", true));
  card.appendChild(tags);

  const note = document.createElement("textarea");
  note.rows = 2;
  note.placeholder = "Add a note (optional)";
  card.appendChild(note);

  const row = document.createElement("div");
  row.className = "row";

  const approve = document.createElement("button");
  approve.textContent = approval.stepUpRequired ? "Approve with passkey" : "Approve";
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

  const reject = document.createElement("button");
  reject.className = "danger";
  reject.textContent = "Reject";
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

async function refreshCounts(endpoint, token) {
  try {
    const response = await fetch(`${endpoint}/x/state`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      setMessage("Loomstate rejected this browser. Pair it again.", true);
      return;
    }
    const state = await response.json();
    $("loopCount").textContent = String(state.activeLoops);
    $("approvalCount").textContent = String(state.pendingApprovals);
    $("counts").classList.remove("hidden");
    if (state.pendingApprovals > 0) {
      setMessage("An action waits for your approval.");
    }
  } catch {
    setMessage("Loomstate is unreachable.", true);
  }
}

$("save").addEventListener("click", async () => {
  const endpoint = $("endpoint").value.trim().replace(/\/+$/, "");
  const token = $("token").value.trim();
  if (endpoint === "" || token === "" || token.startsWith("•")) {
    setMessage("Enter the address and the token.", true);
    return;
  }
  await chrome.storage.local.set({
    endpoint,
    token,
    dashboardUrl: endpoint.replace(".convex.site", ".convex.app"),
    paused: false,
  });
  setMessage("This browser is paired.");
  await load();
});

$("pause").addEventListener("click", async () => {
  const { paused } = await chrome.storage.local.get("paused");
  await chrome.storage.local.set({ paused: paused !== true });
  await load();
});

$("dashboard").addEventListener("click", async () => {
  const { dashboardUrl } = await chrome.storage.local.get("dashboardUrl");
  await chrome.tabs.create({ url: dashboardUrl || "https://convex.dev" });
});

void load();
