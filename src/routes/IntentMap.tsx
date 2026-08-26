import { EmptyState, Page } from "../components/Page";

export default function IntentMap() {
  return (
    <Page
      title="Intent map"
      lede="Every goal you started on the web and never closed. Loomstate builds each loop from your own browsing signal."
    >
      <EmptyState
        title="No loops yet"
        body="Loomstate needs browsing signal first. Pair the browser extension, then browse as you normally do."
        hint="Open Settings to pair a browser."
      />
    </Page>
  );
}
