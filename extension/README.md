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

## What it shows

Open the extension and you see, without opening the web app:

- anything waiting for your decision, which you can answer here
- your loops, with status and how live each one is
- what the agent has just done
- whether Loomstate is paused

Select a loop to open it in the web app. Select **Keep this open while I
browse** to move the panel to the side of the window, where it stays as you
work.

## Adding a page

Select **Add this page to a loop** to file the page you are on. Choose an
existing loop, or name a new one. Loomstate stores the page and starts watching
it, unless it is on your excluded list, in which case it stores nothing and says
so.

## Approval alerts

Loomstate works your loops on a schedule, so an action can come up while the app
is shut. When one needs your decision, the extension raises a browser
notification. Select it to open the approval. Loomstate also emails you from the
agent's own inbox, so the alert reaches you even with the browser closed.

Chrome asks for notification permission the first time. The extension shows each
approval once.

Answer it from the notification. **Approve** or **Reject** without opening
Loomstate. Open the extension popup to read the full action, add a note, and
answer there instead.

An action that commits money or cannot be undone always needs your passkey. The
extension cannot release one of those on its own, so **Approve with passkey**
opens Loomstate at that action, where you confirm. This is deliberate: the
pairing token in this extension is a weaker credential than your passkey, and it
never gets to spend money.

## Stop it

Select **Pause capture** in the popup to stop reporting. Select **Stop** next to
the browser in Loomstate settings to reject it on the server.
