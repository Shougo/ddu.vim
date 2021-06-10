import { cmp, Nullable } from "./mod.ts";
import { Scored } from "./score.ts";
import { Msg, Response } from "./sort.ts";

self.onmessage = (msg: MessageEvent<Msg>) => {
  try {
    //console.log(msg);
    switch (msg.data.method) {
      case "clear":
        clear();
        break;
      case "push":
        if (msg.data.args) {
          push(msg.data.args);
        }
        break;
      case "sorted":
        nullableMap(sorted(msg.data), self.postMessage);
        break;
      case "close":
        self.close();
        break;
    }
  } catch (e) {
    console.error(e);
  }
};

function nullableMap(n: Nullable<unknown>, f: (x: unknown) => unknown) {
  if (n != null) {
    return f(n);
  }
  return null;
}

// TODO: binary search tree
let data: Scored[] = [];

function clear() {
  data = [];
}

function push(args: Record<string, unknown>) {
  const scored = args.value as Scored;
  const a: Scored[] = data.slice();
  a.push(scored);
  data = a.sort((a, b) => cmp(a.score, b.score)); // is it stable sort?
}

function sorted(req: Msg): Nullable<Response> {
  if (req.id == null) return null;
  const value = data.slice();
  return new Response(req.id, value);
}
