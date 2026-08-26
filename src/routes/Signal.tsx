import { EmptyState, Page } from "../components/Page";

export default function Signal() {
  return (
    <Page
      title="Signal"
      lede="The raw browsing events the extension sends. Loops are built from this stream."
    >
      <EmptyState
        title="No events yet"
        body="The extension streams a page visit as soon as you pair a browser."
      />
    </Page>
  );
}
