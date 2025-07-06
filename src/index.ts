import debounce from "lodash.debounce";
import throttle from "lodash.throttle";

export type DebounceOptions = {
  debounceMs: number;
  edge?: "leading" | "trailing" | "both";
};

export type ThrottleOptions = {
  throttleMs: number;
  edge?: "leading" | "trailing" | "both";
};

export type LastWinsAndCancelsPreviousOptions =
  | DebounceOptions
  | ThrottleOptions;

export const isDebounceOptions = (
  options: LastWinsAndCancelsPreviousOptions
): options is DebounceOptions => "debounceMs" in options;

export const isThrottleOptions = (
  options: LastWinsAndCancelsPreviousOptions
): options is ThrottleOptions => "throttleMs" in options;

export type LastWinsAndCancelsPreviousHook<R> = (args: {
  result?: R;
  error?: any;
  aborted: boolean;
  signal: AbortSignal;
  isSeriesEnd: boolean;
}) => void;

export type Unsub = () => void;

/**
 * Task queue with previous cancellation and event hooks support.
 */
export class LastWinsAndCancelsPrevious<R = unknown> {
  private controller?: AbortController;
  private resultPromise!: Promise<R> | undefined;
  private resultPromiseResolve?: (value: R) => void;
  private resultPromiseReject?: (reason?: any) => void;

  private readonly delay: number;
  private edge: "leading" | "trailing" | "both";

  private debouncedOrThrottledRun?: (...args: any[]) => any;

  // Event hooks
  private onAbortedHooks: LastWinsAndCancelsPreviousHook<R>[] = [];
  private onErrorHooks: LastWinsAndCancelsPreviousHook<R>[] = [];
  private onCompleteHooks: LastWinsAndCancelsPreviousHook<R>[] = [];
  private onSeriesStartedHooks: (() => void)[] = [];

  /**
   * Subscribe to abort events (any task, not just result)
   */
  public onAborted(cb: LastWinsAndCancelsPreviousHook<R>): Unsub {
    this.onAbortedHooks.push(cb);
    return () => {
      const idx = this.onAbortedHooks.indexOf(cb);
      if (idx !== -1) this.onAbortedHooks.splice(idx, 1);
    };
  }
  /**
   * Subscribe to error events (any task, not just result)
   */
  public onError(cb: LastWinsAndCancelsPreviousHook<R>): Unsub {
    this.onErrorHooks.push(cb);
    return () => {
      const idx = this.onErrorHooks.indexOf(cb);
      if (idx !== -1) this.onErrorHooks.splice(idx, 1);
    };
  }
  /**
   * Subscribe to completion events (any task, not just result)
   */
  public onComplete(cb: LastWinsAndCancelsPreviousHook<R>): Unsub {
    this.onCompleteHooks.push(cb);
    return () => {
      const idx = this.onCompleteHooks.indexOf(cb);
      if (idx !== -1) this.onCompleteHooks.splice(idx, 1);
    };
  }
  /**
   * Subscribe to series start events
   */
  public onSeriesStarted(cb: () => void): Unsub {
    this.onSeriesStartedHooks.push(cb);
    return () => {
      const idx = this.onSeriesStartedHooks.indexOf(cb);
      if (idx !== -1) this.onSeriesStartedHooks.splice(idx, 1);
    };
  }
  /**
   * Subscribe to series end events
   */
  public onSeriesEnded(cb: LastWinsAndCancelsPreviousHook<R>): Unsub {
    const unsubComplete = this.onComplete((args) => {
      if (args.isSeriesEnd) cb(args);
    });
    const unsubError = this.onError((args) => {
      if (args.isSeriesEnd) cb(args);
    });
    const unsubAborted = this.onAborted((args) => {
      if (args.isSeriesEnd) cb(args);
    });
    return () => {
      unsubComplete();
      unsubError();
      unsubAborted();
    };
  }
  /**
   * Forcefully aborts the current winning task (and fires hooks)
   */
  public abort(): void {
    if (!(this.controller && !this.controller.signal.aborted)) {
      return;
    }
    this.controller.abort();
    // After abort(), the queue is always idle since run is not called
    this.fireAborted(undefined, this.controller.signal, true);
    this.clearResultPromise();
  }

  /**
   * Internal call for abort hooks
   * @param isSeriesEnd true if this is the final abort (queue is idle)
   */
  private fireAborted(
    result: R | undefined,
    signal: AbortSignal,
    isSeriesEnd: boolean
  ) {
    for (const cb of this.onAbortedHooks) {
      cb({ result, aborted: true, error: undefined, signal, isSeriesEnd });
    }
  }
  /**
   * Internal call for error hooks
   * @param isSeriesEnd true if the queue is idle after error
   */
  private fireError(error: any, signal: AbortSignal, isSeriesEnd: boolean) {
    for (const cb of this.onErrorHooks) {
      cb({ error, aborted: false, result: undefined, signal, isSeriesEnd });
    }
  }
  /**
   * Internal call for complete hooks
   * @param isSeriesEnd true if the queue is idle after completion
   */
  private fireComplete(result: R, signal: AbortSignal, isSeriesEnd: boolean) {
    for (const cb of this.onCompleteHooks) {
      cb({ result, aborted: false, error: undefined, signal, isSeriesEnd });
    }
  }
  private fireSeriesStarted() {
    for (const cb of this.onSeriesStartedHooks) {
      cb();
    }
  }

  constructor(options?: LastWinsAndCancelsPreviousOptions) {
    if (!options) {
      this.delay = 0;
      this.edge = "trailing";
      this.debouncedOrThrottledRun = undefined;
      return;
    }

    if (isDebounceOptions(options)) {
      this.delay = options.debounceMs;
      this.edge = options.edge ?? "trailing";
      this.debouncedOrThrottledRun = debounce(
        (task, resolve, reject, callMarker) => {
          callMarker.called = true;
          this._run(task).then(resolve, reject);
        },
        this.delay,
        {
          leading: this.edge === "leading" || this.edge === "both",
          trailing: this.edge === "trailing" || this.edge === "both",
        }
      );
    } else if (isThrottleOptions(options)) {
      this.delay = options.throttleMs;
      this.edge = options.edge ?? "leading";
      this.debouncedOrThrottledRun = throttle(
        (task, resolve, reject, callMarker) => {
          callMarker.called = true;
          this._run(task).then(resolve, reject);
        },
        this.delay,
        {
          leading: this.edge === "leading" || this.edge === "both",
          trailing: this.edge === "trailing" || this.edge === "both",
        }
      );
    } else {
      this.delay = 0;
      this.edge = "trailing";
      this.debouncedOrThrottledRun = undefined;
    }
  }

  private resetResultPromise() {
    this.resultPromise = new Promise<R>((resolve, reject) => {
      this.resultPromiseResolve = resolve;
      this.resultPromiseReject = reject;
    });
  }

  private clearResultPromise() {
    this.resultPromiseResolve = undefined;
    this.resultPromiseReject = undefined;
    this.resultPromise = undefined;
  }

  public run<T extends R>(
    task: (signal: AbortSignal) => Promise<T>
  ): Promise<T | undefined> {
    if (!this.debouncedOrThrottledRun) {
      // No debounce/throttle — just call _run
      return this._run(task);
    }
    const called = { called: false };
    return new Promise<T | undefined>((resolve, reject) => {
      this.debouncedOrThrottledRun!(task, resolve, reject, called);
      // If debounced/throttled does not call _run synchronously, wait for a tick and check
      Promise.resolve().then(() => {
        if (!called.called) resolve(undefined);
      });
    });
  }

  private _run<T extends R>(
    task: (signal: AbortSignal) => Promise<T>
  ): Promise<T | undefined> {
    if (!this.resultPromise) {
      this.resetResultPromise();
    }
    this.fireSeriesStarted();
    if (this.controller) {
      // Abort previous task and fire hooks
      this.controller.abort();
      // If a new task starts, the series does not end
      this.fireAborted(undefined, this.controller.signal, false);
    }
    this.controller = new AbortController();
    const signal = this.controller.signal;
    let completed = false;
    return task(signal)
      .then((result) => {
        if (!signal.aborted) {
          completed = true;
          this.resultPromiseResolve?.(result);
          // After successful completion — the series ends
          this.fireComplete(result, signal, true);
          this.clearResultPromise();
        }
        return result;
      })
      .catch((err) => {
        if (!signal.aborted) {
          this.resultPromiseReject?.(err);
          // After error — the series ends
          this.fireError(err, signal, true);
          this.clearResultPromise();
          throw err;
        }
        this.fireError(err, signal, false);
        throw err;
      });
  }

  public get result(): Promise<R> | undefined {
    return this.resultPromise;
  }
}
