import { ActionFlags, BaseKind, DduItem } from "../ddu/types.ts";
import { Denops, fn } from "../ddu/deps.ts";
import { ActionArguments } from "../ddu/base/kind.ts";

export type ActionData = {
  path?: string;
  bufNr?: number;
  lineNr?: number;
  col?: number;
};

type Params = Record<never, never>;

export class Kind extends BaseKind<Params> {
  actions: Record<
    string,
    (args: ActionArguments<Params>) => Promise<ActionFlags>
  > = {
    open: async (args: { denops: Denops; items: DduItem[] }) => {
      for (const item of args.items) {
        const action = item?.action as ActionData;

        if (action.bufNr != null) {
          await args.denops.cmd(`buffer ${action.bufNr}`);
        } else {
          const path = action.path == null ? item.word : action.path;
          await args.denops.call("ddu#util#execute_path", "edit", path);
        }

        if (action.lineNr != null) {
          await fn.cursor(args.denops, action.lineNr, 0);
        }
        if (action.col != null) {
          await fn.cursor(args.denops, 0, action.col);
        }
      }

      return Promise.resolve(ActionFlags.None);
    },
  };

  params(): Params {
    return {};
  }
}
