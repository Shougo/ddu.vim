import { Nullable, shouldBeExcluded } from "./mod.ts";
import { Scored } from "./score.ts";
import { delay } from "https://deno.land/std/async/delay.ts";

export class OnlineSort {
  worker: Worker;
  id: number;
  handlers: Record<number, (a: Response) => void>;
  constructor() {
    this.id = 0;
    this.handlers = {};
    this.worker = new Worker(
      new URL("./sort_worker.ts", import.meta.url).href,
      { type: "module" },
    );
    this.worker.onmessage = (msg: MessageEvent<Response>) => {
      if (msg.data.id != null) {
        this.handlers[msg.data.id](msg.data);
      }
    };
  }
  async start(stream: AsyncIterableIterator<Scored>) {
    this.notify("clear", {});
    // データ送らなくてもインデックスとスコアで十分では
    for await (const scored of stream) {
      if (shouldBeExcluded(scored.score)) continue;
      this.notify("push", { value: scored });
      await delay(0);
    }
  }
  async sorted() {
    const response = (await this.request("sorted", {})) as Response;
    return response.value;
  }
  notify(method: string, args: Record<string, unknown>) {
    this.worker.postMessage(new Msg(null, method, args));
  }
  request(method: string, args: Record<string, unknown>): Promise<unknown> {
    const id = this.id++;
    const promise = new Promise((resolve) => {
      this.handlers[id] = resolve;
    });
    this.worker.postMessage(new Msg(id, method, args));
    return promise;
  }
}

export class Response {
  id: Nullable<number>;
  value: Scored[];
  constructor(id: Nullable<number>, value: Scored[]) {
    this.id = id;
    this.value = value;
  }
}

export class Msg {
  id: Nullable<number>;
  method: string;
  args: Record<string, unknown>;
  constructor(
    id: Nullable<number>,
    method: string,
    args: Record<string, unknown>,
  ) {
    this.id = id;
    this.method = method;
    this.args = args;
  }
}
