import type { BaseParams, DduItem, SourceOptions } from "./types.ts";
import type { BaseSource } from "./base/source.ts";

import { is } from "jsr:@core/unknownutil@~4.3.0/is";
import { maybe } from "jsr:@core/unknownutil@~4.3.0/maybe";

export type AvailableSourceInfo<
  Params extends BaseParams = BaseParams,
  UserData extends unknown = unknown,
> = {
  sourceIndex: number;
  source: BaseSource<Params, UserData>;
  sourceOptions: SourceOptions;
  sourceParams: Params;
};

type GatherStateAbortReason =
  | {
    reason: "quit";
  }
  | {
    reason: "cancelToRefresh";
    refreshIndexes: number[];
  };

export type GatherStateAbortable = {
  abort(reason: GatherStateAbortReason): void;
};

export class GatherState<
  Params extends BaseParams = BaseParams,
  UserData extends unknown = unknown,
> {
  readonly sourceInfo: AvailableSourceInfo<Params, UserData>;
  readonly itemsStream: ReadableStream<DduItem[]>;
  #items: DduItem[] = [];
  #isDone = false;
  readonly #waitDone = Promise.withResolvers<void>();
  readonly #aborter = new AbortController();
  #resetParentSignal?: AbortController;

  constructor(
    sourceInfo: AvailableSourceInfo<Params, UserData>,
    itemsStream: ReadableStream<DduItem[]>,
    options?: {
      signal?: AbortSignal;
    },
  ) {
    const { signal: parentSignal } = options ?? {};
    this.sourceInfo = sourceInfo;
    this.#chainAbortSignal(parentSignal);
    this.itemsStream = this.#processItemsStream(itemsStream);
  }

  resetSignal(signal?: AbortSignal): void {
    // Do nothing if already aborted.
    if (!this.#aborter.signal.aborted) {
      this.#chainAbortSignal(signal);
    }
  }

  #chainAbortSignal(parentSignal?: AbortSignal): void {
    this.#resetParentSignal?.abort();
    if (parentSignal == null) {
      return;
    }

    const abortIfTarget = () => {
      const reason = maybe(
        parentSignal.reason,
        is.ObjectOf({ reason: is.String }),
      ) as GatherStateAbortReason | undefined;
      if (
        reason?.reason !== "cancelToRefresh" ||
        isRefreshTarget(this.sourceInfo.sourceIndex, reason.refreshIndexes)
      ) {
        this.#aborter.abort(parentSignal.reason);
      }
    };

    if (parentSignal.aborted) {
      abortIfTarget();
    } else {
      this.#resetParentSignal = new AbortController();
      parentSignal.addEventListener("abort", () => abortIfTarget(), {
        signal: AbortSignal.any([
          this.#aborter.signal,
          this.#resetParentSignal.signal,
        ]),
      });
    }
  }

  #processItemsStream(
    itemsStream: ReadableStream<DduItem[]>,
  ): ReadableStream<DduItem[]> {
    const appendStream = new TransformStream<DduItem[], DduItem[]>({
      transform: (newItems, controller) => {
        this.#items = this.#items.concat(newItems);
        controller.enqueue(newItems);
      },
      flush: () => {
        // Set done flag before stream closed.
        this.#isDone = true;
      },
    });

    itemsStream
      .pipeTo(appendStream.writable, {
        signal: this.#aborter.signal,
        // Do not abort output stream.
        preventAbort: true,
      })
      .catch(() => {
        appendStream.writable.close().catch(() => {
          // Prevent errors if already closed.
        });
      })
      .finally(() => {
        this.#waitDone.resolve();
      });

    return appendStream.readable;
  }

  get items(): readonly DduItem[] {
    return this.#items;
  }

  get isDone(): boolean {
    return this.#isDone;
  }

  get waitDone(): Promise<void> {
    return this.#waitDone.promise;
  }

  get signal(): AbortSignal {
    return this.#aborter.signal;
  }

  async readAll(): Promise<void> {
    if (this.itemsStream != null) {
      await Array.fromAsync(this.itemsStream);
    }
  }
}

export function isRefreshTarget(
  sourceIndex: number,
  refreshIndexes: number[],
): boolean {
  return refreshIndexes.length === 0
    // Target all states.
    ? true
    // Target included states.
    : refreshIndexes.includes(sourceIndex);
}
