import { Section } from "./Section.tsx";
import { IndexGroup } from "./search/IndexGroup.tsx";
import { InUse } from "./search/InUse.tsx";
import { Tuning } from "./search/Tuning.tsx";
import { Uses } from "./search/Uses.tsx";

// ponytail: how this project's documents are searched — the ranking and the words beside Try it, the models in use
// (chosen in Models), then this project's index with Reindex and its vector spaces, and folded, who searches and the
// filters a search takes
export function SearchSection() {
  return (
    <Section
      id="search"
      title="Search"
      intro="How passages are found in this project's documents, by you, by Claude and by the check. Tune it on the left, try it on the right."
      wide
    >
      <Tuning>
        <InUse />
      </Tuning>
      <IndexGroup />
      <Uses />
    </Section>
  );
}
