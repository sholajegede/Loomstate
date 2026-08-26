import { useParams } from "react-router-dom";
import { EmptyState, Page } from "../components/Page";

export default function LoopDetail() {
  const { loopId } = useParams();
  return (
    <Page title="Loop" lede="One goal, its evidence, and the work the agent does on it.">
      <EmptyState
        title="Loop not loaded"
        body={`Loomstate cannot show loop ${loopId ?? ""} yet.`}
      />
    </Page>
  );
}
