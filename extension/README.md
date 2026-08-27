# Loomstate browser extension

The extension is the sensor. It reports the pages you read to Loomstate, and it
shows how many loops are active without you leaving the tab.

## What it sends

For each page you read for more than four seconds:

- the URL, the page title, and how long you stayed
- nothing else

## What it never sends

The extension holds a block list of banking, payment, and health domains. It
checks every page against that list inside the browser. A blocked page never
leaves your machine. You can add your own domains in Loomstate settings, and the
server checks the same list a second time.

## Load it

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Select **Load unpacked** and choose this `extension` folder.

## Pair it

1. Open Loomstate and go to **Settings**.
2. Select **Create token**. Loomstate shows the address and the token once.
3. Open the Loomstate extension popup.
4. Paste both values and select **Pair this browser**.

The popup then shows how many loops are active and how many actions wait for
your approval.

## Approval alerts

Loomstate works your loops on a schedule, so an action can come up while the app
is shut. When one needs your decision, the extension raises a browser
notification. Select it to open the approval. Loomstate also emails you from the
agent's own inbox, so the alert reaches you even with the browser closed.

Chrome asks for notification permission the first time. The extension shows each
approval once.

## Stop it

Select **Pause capture** in the popup to stop reporting. Select **Stop** next to
the browser in Loomstate settings to reject it on the server.
