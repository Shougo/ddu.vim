import type { BaseParams, DduItem, SourceOptions } from "./types.ts";
import type { BaseSource } from "./base/source.ts";

export type AvailableSourceInfo<
  Params extends BaseParams = BaseParams,
  UserData extends unknown = unknown,
> = {
  sourceIndex: number;
  source: BaseSource<Params, UserData>;
  sourceOptions: SourceOptions;
  sourceParams: Params;
};

export type BaseAbortReason = {
  readonly type: string;
};

export class QuitAbortReason extends Error implements BaseAbortReason {
  override name = "QuitAbortReason";
  readonly type = "quit";
}

export class RefreshAbortReason extends Error implements BaseAbortReason {
  override name = "RefreshAbortReason";
  readonly type = "cancelToRefresh";
  readonly refreshIndexes: readonly number[];

  constructor(refreshIndexes: number[] = []) {
    super();
    this.refreshIndexes = refreshIndexes;
  }
}

export type GatherStateAbortReason =
  | QuitAbortReason
  | RefreshAbortReason;

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

  constructor(
    sourceInfo: AvailableSourceInfo<Params, UserData>,
    itemsStream: ReadableStream<DduItem[]>,
  ) {
    this.sourceInfo = sourceInfo;
    this.itemsStream = this.#processItemsStream(itemsStream);
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

  get cancelled(): AbortSignal {
    return this.#aborter.signal;
  }

  cancel(reason?: unknown): void {
    this.#aborter.abort(reason);
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
