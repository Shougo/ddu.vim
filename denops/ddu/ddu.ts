import { assertEquals, Denops } from "./deps.ts";
import { Candidate } from "./types.ts";
import { Ui } from "../@ddu-uis/default.ts";
import { Source } from "../@ddu-sources/file.ts";
import { Filter } from "../@ddu-filters/matcher_substring.ts";

export class Ddu {
  async start(
    denops: Denops,
  ): Promise<void> {
    const ui = new Ui();
    const source = new Source();
    const filter = new Filter();

    const sourceCandidates = await source.gather({ denops: denops });
    const dduCandidates = sourceCandidates.map((c: Candidate) => (
      {
        ...c,
        matcherKey: c.word,
      }
    ));
    const filteredCandidates = await filter.filter({
      denops: denops,
      completeStr: "",
      candidates: dduCandidates,
    });

    await ui.redraw({
      denops: denops,
      candidates: filteredCandidates,
    });
  }
}

Deno.test("test", () => {
  assertEquals(1, 1);
});
