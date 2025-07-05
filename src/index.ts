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

export class LastWinsAndCancelsPrevious<R = unknown> {
  private controller?: AbortController;
  private resultPromise!: Promise<R | undefined>;
  private resultPromiseResolve?: (value: R | undefined) => void;
  private resultPromiseReject?: (reason?: any) => void;

  private readonly delay: number;
  private readonly leading: boolean;
  private readonly trailing: boolean;

  private debouncedOrThrottledRun?: (...args: any[]) => any;

  constructor(options?: LastWinsAndCancelsPreviousOptions) {
    this.resetResultPromise();
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
    this.resultPromise = new Promise<R | undefined>((resolve, reject) => {
      this.resultPromiseResolve = resolve;
      this.resultPromiseReject = reject;
    });
  }

  public run<T extends R>(
    task: (signal: AbortSignal) => Promise<T>
  ): Promise<T | undefined> {
    if (!this.debouncedOrThrottledRun) {
      // Без debounce/throttle — просто вызов _run
      return this._run(task);
    }
    const called = { called: false };
    return new Promise<T | undefined>((resolve, reject) => {
      this.debouncedOrThrottledRun!(task, resolve, reject, called);
      // Если debounced/throttled не вызвал _run синхронно, ждем tick и проверяем
      Promise.resolve().then(() => {
        if (!called.called) resolve(undefined);
      });
    });
  }

  private _run<T extends R>(
    task: (signal: AbortSignal) => Promise<T>
  ): Promise<T | undefined> {
    if (this.controller) this.controller.abort();
    this.controller = new AbortController();
    this.resetResultPromise();
    const signal = this.controller.signal;
    return task(signal)
    .then((result) => {
      if (!signal.aborted) this.resultPromiseResolve?.(result);
      return result;
    })
    .catch((err) => {
      if (!signal.aborted) {
        this.resultPromiseReject?.(err);
        throw err;
      }
      return undefined;
    });
  }

  public get result(): Promise<R | undefined> {
    return this.resultPromise;
  }
}
