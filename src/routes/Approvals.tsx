import { EmptyState, Page } from "../components/Page";

export default function Approvals() {
  return (
    <Page
      title="Approvals"
      lede="Actions that commit money or cannot be undone wait here. You approve, edit, or reject each one."
    >
      <EmptyState
        title="Nothing waiting"
        body="The agent has no action that needs your decision."
      />
    </Page>
  );
}
