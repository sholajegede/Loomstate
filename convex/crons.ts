import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Loomstate runs on its own. A person signs in, sets their keys, and browses.
// Everything below happens whether or not the app or the extension is open.

// New browsing signal becomes loops.
crons.interval(
  "rebuild loops from new signal",
  { minutes: 5 },
  internal.autopilot.reconstructAll,
  {},
);

// Watched pages get re-read, and a real change is recorded.
crons.interval(
  "sweep watched pages",
  { minutes: 15 },
  internal.watches.sweepDue,
  {},
);

// Loops with something new get worked. The agent acts inside its grant, and
// anything that commits money waits in the approval queue instead.
crons.interval(
  "work loops that have something new",
  { minutes: 15 },
  internal.autopilot.workDueLoops,
  {},
);

export default crons;
