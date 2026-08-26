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
  }
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
