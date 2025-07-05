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
export type LastWinsAndCancelsPreviousOptions = DebounceOptions | ThrottleOptions;
export declare const isDebounceOptions: (options: LastWinsAndCancelsPreviousOptions) => options is DebounceOptions;
export declare const isThrottleOptions: (options: LastWinsAndCancelsPreviousOptions) => options is ThrottleOptions;
export declare class LastWinsAndCancelsPrevious<R = unknown> {
    private controller?;
    private resultPromise;
    private resultPromiseResolve?;
    private resultPromiseReject?;
    private readonly delay;
    private readonly leading;
    private readonly trailing;
    private debouncedOrThrottledRun?;
    constructor(options?: LastWinsAndCancelsPreviousOptions);
    private resetResultPromise;
    private clearResultPromise;
    run<T extends R>(task: (signal: AbortSignal) => Promise<T>): Promise<T | undefined>;
    private _run;
    get result(): Promise<R> | undefined;
}
