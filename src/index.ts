// src/LastWinsAndCancelsPrevious.ts

export type Edge = "leading" | "trailing" | "both";

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
  private lastInvokeTime = 0;
  private timeout?: ReturnType<typeof setTimeout>;
  private pendingResolves: Array<(v: any) => void> = [];

  private readonly isDebounce: boolean;
  private readonly delay: number;
  private readonly leading: boolean;
  private readonly trailing: boolean;

  constructor(options?: LastWinsAndCancelsPreviousOptions) {
    this.resetResultPromise();
    if (!options) {
      this.isDebounce = false;
      this.delay = 0;
      this.leading = true;
      this.trailing = false;
      return;
    }
    if (isDebounceOptions(options)) {
      this.isDebounce = true;
      this.delay = options.debounceMs;
      this.leading = options.leading ?? false;
      this.trailing = options.trailing ?? true;
    } else if (isThrottleOptions(options)) {
      this.isDebounce = false;
      this.delay = options.throttleMs;
      this.leading = options.leading ?? true;
      this.trailing = options.trailing ?? false;
    } else {
      this.isDebounce = false;
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
    const now = Date.now();
    const invoke = () => {
      if (this.controller) this.controller.abort();
      this.controller = new AbortController();
      this.resetResultPromise();
      const signal = this.controller.signal;
      const taskPromise = task(signal)
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
      return taskPromise;
    };

    if (this.delay === 0) return invoke();

    if (this.isDebounce) {
      const shouldCallNow = this.leading && !this.timeout;
      if (this.timeout) {
        clearTimeout(this.timeout);
        this.pendingResolves.forEach((r) => r(undefined));
        this.pendingResolves = [];
      }

      if (shouldCallNow) {
        const result = invoke();
        this.timeout = setTimeout(() => {
          this.timeout = undefined;
        }, this.delay);
        return result;
      }

      if (this.trailing) {
        // trailing вызывается только если был хотя бы один вызов в окне
        return new Promise((resolve) => {
          this.pendingResolves = [];
          this.pendingResolves.push(resolve);
          this.timeout = setTimeout(() => {
            this.timeout = undefined;
            resolve(invoke());
            this.pendingResolves = [];
          }, this.delay);
        });
      }

      // Если ни leading, ни trailing — сразу резолвим undefined
      return Promise.resolve(undefined);
    } else {
      const timeSinceLast = now - this.lastInvokeTime;
      const canCallNow = timeSinceLast >= this.delay;

      if (canCallNow && this.leading) {
        this.lastInvokeTime = now;
        return invoke();
      }

      if (this.trailing) {
        // trailing вызывается только если был хотя бы один вызов в окне
        if (this.timeout) {
          clearTimeout(this.timeout);
          this.pendingResolves.forEach((r) => r(undefined));
          this.pendingResolves = [];
        }
        return new Promise((resolve) => {
          this.pendingResolves = [];
          this.pendingResolves.push(resolve);
          this.timeout = setTimeout(() => {
            this.lastInvokeTime = Date.now();
            this.timeout = undefined;
            resolve(invoke());
            this.pendingResolves = [];
          }, this.delay - timeSinceLast);
        });
      }

      // Если ни leading, ни trailing — сразу резолвим undefined
      return Promise.resolve(undefined);
    }
  }

  public get result(): Promise<R | undefined> {
    return this.resultPromise;
  }
}
