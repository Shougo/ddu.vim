//import { main } from "https://deno.land/x/denops_std@v0.10/mod.ts";
import { OnlineSort } from "./model/sort.ts";
import { delay } from "https://deno.land/std/async/delay.ts";
import { Even, scoreStream } from "./model/score.ts";
import { NumberSource } from "./model/source.ts";

//main(async ({ _vim }) => {
//});
async function main() {
  const source = new NumberSource();
  const itemStream = source.start({});
  const match = new Even();
  match.start("", {});
  const scored = scoreStream(itemStream, match);
  const sort = new OnlineSort();
  sort.start(scored);
  while (true) {
    console.log(await sort.sorted());
    await delay(15); // 60fps
  }
}

main();
