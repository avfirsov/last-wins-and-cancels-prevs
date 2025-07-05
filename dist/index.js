import debounce from "lodash.debounce";
import throttle from "lodash.throttle";
export const isDebounceOptions = (options) => "debounceMs" in options;
export const isThrottleOptions = (options) => "throttleMs" in options;
export class LastWinsAndCancelsPrevious {
    constructor(options) {
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
            this.debouncedOrThrottledRun = debounce((task, resolve, reject, callMarker) => {
                callMarker.called = true;
                this._run(task).then(resolve, reject);
            }, this.delay, { leading: this.leading, trailing: this.trailing });
        }
        else if (isThrottleOptions(options)) {
            this.delay = options.throttleMs;
            this.leading = options.leading ?? true;
            this.trailing = options.trailing ?? false;
            this.debouncedOrThrottledRun = throttle((task, resolve, reject, callMarker) => {
                callMarker.called = true;
                this._run(task).then(resolve, reject);
            }, this.delay, { leading: this.leading, trailing: this.trailing });
        }
        else {
            this.delay = 0;
            this.leading = true;
            this.trailing = false;
        }
    }
    resetResultPromise() {
        this.resultPromise = new Promise((resolve, reject) => {
            this.resultPromiseResolve = resolve;
            this.resultPromiseReject = reject;
        });
    }
    clearResultPromise() {
        this.resultPromiseResolve = undefined;
        this.resultPromiseReject = undefined;
        this.resultPromise = undefined;
    }
    run(task) {
        if (!this.resultPromise) {
            this.resetResultPromise();
        }
        if (!this.debouncedOrThrottledRun) {
            // Без debounce/throttle — просто вызов _run
            return this._run(task);
        }
        const called = { called: false };
        return new Promise((resolve, reject) => {
            this.debouncedOrThrottledRun(task, resolve, reject, called);
            // Если debounced/throttled не вызвал _run синхронно, ждем tick и проверяем
            Promise.resolve().then(() => {
                if (!called.called)
                    resolve(undefined);
            });
        });
    }
    _run(task) {
        if (this.controller)
            this.controller.abort();
        this.controller = new AbortController();
        const signal = this.controller.signal;
        return task(signal)
            .then((result) => {
            if (!signal.aborted) {
                this.resultPromiseResolve?.(result);
                this.clearResultPromise();
            }
            return result;
        })
            .catch((err) => {
            if (!signal.aborted) {
                this.resultPromiseReject?.(err);
                this.clearResultPromise();
            }
            throw err;
        });
    }
    get result() {
        return this.resultPromise;
    }
}
