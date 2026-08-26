import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Loomstate re-reads every watched page on its own, so a loop stays current
// even when nobody opens the dashboard.
crons.interval(
  "sweep watched pages",
  { minutes: 15 },
  internal.watches.sweepDue,
  {},
);

export default crons;
