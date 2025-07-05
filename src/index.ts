import debounce from "lodash.debounce";
import throttle from "lodash.throttle";

export type DebounceOptions = {
  debounceMs: number;
  leading?: boolean;
  trailing?: boolean;
};

export type ThrottleOptions = {
  throttleMs: number;
  leading?: boolean;
  trailing?: boolean;
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

export type LastWinsAndCancelsPreviousHook<R> = (args: { result?: R; error?: any; aborted: boolean; signal: AbortSignal; isSeriesEnd: boolean }) => void;

/**
 * Task queue with previous cancellation and event hooks support.
 */
export class LastWinsAndCancelsPrevious<R = unknown> {
  private controller?: AbortController;
  private resultPromise!: Promise<R> | undefined;
  private resultPromiseResolve?: (value: R) => void;
  private resultPromiseReject?: (reason?: any) => void;

  private readonly delay: number;
  private readonly leading: boolean;
  private readonly trailing: boolean;

  private debouncedOrThrottledRun?: (...args: any[]) => any;

  // Event hooks
  private onAbortedHooks: LastWinsAndCancelsPreviousHook<R>[] = [];
  private onErrorHooks: LastWinsAndCancelsPreviousHook<R>[] = [];
  private onCompleteHooks: LastWinsAndCancelsPreviousHook<R>[] = [];

  /**
   * Subscribe to abort events (any task, not just result)
   */
  public onAborted(cb: LastWinsAndCancelsPreviousHook<R>): void {
    this.onAbortedHooks.push(cb);
  }
  /**
   * Subscribe to error events (any task, not just result)
   */
  public onError(cb: LastWinsAndCancelsPreviousHook<R>): void {
    this.onErrorHooks.push(cb);
  }
  /**
   * Subscribe to completion events (any task, not just result)
   */
  public onComplete(cb: LastWinsAndCancelsPreviousHook<R>): void {
    this.onCompleteHooks.push(cb);
  }

  /**
   * Forcefully aborts the current task (and fires hooks)
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
  private fireAborted(result: R | undefined, signal: AbortSignal, isSeriesEnd: boolean) {
    for (const cb of this.onAbortedHooks) {
      try { cb({ result, aborted: true, error: undefined, signal, isSeriesEnd }); } catch {}
    }
  }
  /**
   * Internal call for error hooks
   * @param isSeriesEnd true if the queue is idle after error
   */
  private fireError(error: any, signal: AbortSignal, isSeriesEnd: boolean) {
    for (const cb of this.onErrorHooks) {
      try { cb({ error, aborted: false, result: undefined, signal, isSeriesEnd }); } catch {}
    }
  }
  /**
   * Internal call for complete hooks
   * @param isSeriesEnd true if the queue is idle after completion
   */
  private fireComplete(result: R, signal: AbortSignal, isSeriesEnd: boolean) {
    for (const cb of this.onCompleteHooks) {
      try { cb({ result, aborted: false, error: undefined, signal, isSeriesEnd }); } catch {}
    }
  }

  constructor(options?: LastWinsAndCancelsPreviousOptions) {
    if (!options) {
      this.delay = 0;
      this.leading = true;
      this.trailing = false;
      return;
    }
    if (isDebounceOptions(options)) {
      this.delay = options.debounceMs;
      this.leading = options.leading ?? false;
      this.trailing = options.trailing ?? true;
      this.debouncedOrThrottledRun = debounce(
        (task, resolve, reject, callMarker) => {
          callMarker.called = true;
          this._run(task).then(resolve, reject);
        },
        this.delay,
        { leading: this.leading, trailing: this.trailing }
      );
    } else if (isThrottleOptions(options)) {
      this.delay = options.throttleMs;
      this.leading = options.leading ?? true;
      this.trailing = options.trailing ?? false;
      this.debouncedOrThrottledRun = throttle(
        (task, resolve, reject, callMarker) => {
          callMarker.called = true;
          this._run(task).then(resolve, reject);
        },
        this.delay,
        { leading: this.leading, trailing: this.trailing }
      );
    } else {
      this.delay = 0;
      this.leading = true;
      this.trailing = false;
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
    if (!this.resultPromise) {
      this.resetResultPromise();
    }
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
        }
        throw err;
      });
  }

  public get result(): Promise<R> | undefined {
    return this.resultPromise;
  }
}
