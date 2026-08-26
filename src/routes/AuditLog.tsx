import { EmptyState, Page } from "../components/Page";

export default function AuditLog() {
  return (
    <Page
      title="Audit log"
      lede="Every action the agent takes, the grant that allowed it, and the evidence behind it."
    >
      <EmptyState title="No entries yet" body="The agent has not acted yet." />
    </Page>
  );
}
