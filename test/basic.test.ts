import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LastWinsAndCancelsPrevious } from "../src";

describe("LastWinsAndCancelsPrevious", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves the result of a single task", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    expect(queue.result).toBeUndefined();
    const runResult = queue.run(async () => 42);
    expect(queue.result).not.toBeUndefined();
    const result = queue.result;
    expect(await runResult).toBe(42);
    expect(await result).toBe(42);
  });

  it("cancels the previous task when a new one is started", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    expect(queue.result).toBeUndefined();
    let firstAborted = false;
    const first = queue.run(async (signal) => {
      return new Promise<number>((resolve) => {
        signal.addEventListener("abort", () => {
          firstAborted = true;
          resolve(-1);
        });
        setTimeout(() => resolve(1), 100);
      });
    });
    const result = queue.result;
    expect(result).not.toBeUndefined();
    const second = queue.run(async () => 2);
    expect(queue.result).toBe(result);
    expect(await second).toBe(2);
    expect(await first).toBe(-1);
    expect(firstAborted).toBe(true);
    expect(await result).toBe(2);
  });

  it("run returns undefined when the task is cancelled", async () => {
    const queue = new LastWinsAndCancelsPrevious<number | undefined>();
    expect(queue.result).toBeUndefined();
    const first = queue.run(async (signal) => {
      return new Promise<number | undefined>((resolve) => {
        signal.addEventListener("abort", () => resolve(undefined));
        setTimeout(() => resolve(1), 100);
      });
    });
    const result = queue.result;
    expect(result).not.toBeUndefined();
    const second = queue.run(async () => 2); // отменяет первую
    expect(queue.result).toBe(result);
    expect(await first).toBeUndefined();
    expect(await second).toBe(2);
    expect(await result).toBe(2);
  });

  it("result resolves only with the last task", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    expect(queue.result).toBeUndefined();
    queue.run(async () => 1);
    const result = queue.result;
    expect(queue.result).toBe(result);
    queue.run(async () => 2);
    expect(queue.result).toBe(result);
    const last = queue.run(async () => 3);
    expect(await last).toBe(3);
    expect(await result).toBe(3);
  });

  it("old tasks without AbortSignal finish, but do not affect result", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    expect(queue.result).toBeUndefined();
    let finished = false;
    const first = queue.run(async () => {
      await new Promise((r) => setTimeout(() => r("first"), 100));
      finished = true;
      return 1;
    });
    const result = queue.result;
    expect(result).not.toBeUndefined();
    const last = queue.run(async () => 2);
    expect(queue.result).toBe(result);
    await vi.advanceTimersByTimeAsync(100); // Продвигаем таймеры, чтобы промисы резолвились
    expect(await last).toBe(2);
    expect(await result).toBe(2);
    expect(await first).toBe(1); // Should be undefined, since the task was cancelled
    expect(finished).toBe(true);
  });

  it("an error in the task leads to result rejection", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    expect(queue.result).toBeUndefined();
    const error = new Error("fail");
    const task = queue.run(async () => {
      throw error;
    });
    const result = queue.result;
    expect(result).not.toBeUndefined();
    await expect(task).rejects.toThrow("fail");
    await expect(result).rejects.toThrow("fail");
  });

  it("first task fails BEFORE second completes — result = task2, task1 rejects", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    let reject1: (e: any) => void, resolve2: (v: number) => void;
    const error1 = new Error("fail1");
    const task1 = queue.run(() => new Promise<number>((_, rej) => { reject1 = rej; }));
    const resultPromise = queue.result;
    const task2 = queue.run(() => new Promise<number>((res) => { resolve2 = res; }));
    reject1!(error1); // First task fails immediately
    resolve2!(42);    // Second completes after
    expect(await task2).toBe(42);
    expect(await resultPromise).toBe(42);
    await expect(task1).rejects.toThrow("fail1");
  });

  it("first task fails AFTER second completes — result = task2, task1 rejects", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    let reject1: (e: any) => void, resolve2: (v: number) => void;
    const error1 = new Error("fail1");
    const task1 = queue.run(() => new Promise<number>((_, rej) => { reject1 = rej; }));
    const resultPromise = queue.result;
    const task2 = queue.run(() => new Promise<number>((res) => { resolve2 = res; }));
    resolve2!(42);    // Second completes first
    reject1!(error1); // First task fails after
    expect(await task2).toBe(42);
    expect(await resultPromise).toBe(42);
    await expect(task1).rejects.toThrow("fail1");
  });

  it("if the first task failed but was cancelled by the second — result = task2, task1 rejects", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    const error1 = new Error("fail1");
    let task1Reject: (e: any) => void;
    const task1 = queue.run(
      () =>
        new Promise<number>((_, reject) => {
          task1Reject = reject;
        })
    );
    task1.then((v) => console.log("🚀 ~ it ~ v:", v)).catch((e) => console.log("🚀 ~ it ~ e:", e));
    const resultPromise = queue.result;
    // Start the second task, which completes successfully
    const task2 = queue.run(async () => 42);
    expect(resultPromise).toBe(queue.result);
    // First task fails with error, but is already cancelled
    task1Reject!(error1);
    expect(queue.result).toBe(resultPromise);
    console.log("🚀 ~ it ~ task1:", task1);
    expect(await task2).toBe(42);
    expect(await resultPromise).toBe(42);
    await expect(task1).rejects.toThrow("fail1");
  });

  it("second task fails BEFORE first completes — result and task2 reject, task1 success", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    let resolve1: (v: number) => void;
    const error2 = new Error("fail2");
    const task1 = queue.run(() => new Promise<number>((res) => { resolve1 = res; }));
    const resultPromise = queue.result;
    const task2 = queue.run(() => new Promise<number>((_, rej) => { rej(error2); }));
    // Second task fails first
    await expect(task2).rejects.toThrow("fail2");
    resolve1!(1); // First task completes after
    expect(await task1).toBe(1);
    await expect(resultPromise).rejects.toThrow("fail2");
  });

  it("second task fails AFTER first completes — result and task2 reject, task1 success", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    let resolve1: (v: number) => void, reject2: (e: any) => void;
    const error2 = new Error("fail2");
    const task1 = queue.run(() => new Promise<number>((res) => { resolve1 = res; }));
    const resultPromise = queue.result;
    const task2 = queue.run(() => new Promise<number>((_, rej) => { reject2 = rej; }));
    resolve1!(1); // Первая задача завершается первой
    reject2!(error2); // Вторая падает после
    expect(await task1).toBe(1);
    await expect(task2).rejects.toThrow("fail2");
    await expect(resultPromise).rejects.toThrow("fail2");
  });

  it("if the second task fails — result and task2 reject, task1 success", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    const task1 = queue.run(async () => 1);
    const resultPromise = queue.result;
    // Вторая задача падает
    const error2 = new Error("fail2");
    const task2 = queue.run(async () => {
      throw error2;
    });
    expect(queue.result).toBe(resultPromise);
    expect(await task1).toBe(1);
    await expect(task2).rejects.toThrow("fail2");
    await expect(resultPromise).rejects.toThrow("fail2");
  });

  it("both tasks fail: first BEFORE second — result and task2 reject, task1 rejects", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    let reject1: (e: any) => void, reject2: (e: any) => void;
    const error1 = new Error("fail1");
    const error2 = new Error("fail2");
    const task1 = queue.run(() => new Promise<number>((_, rej) => { reject1 = rej; }));
    const resultPromise = queue.result;
    const task2 = queue.run(() => new Promise<number>((_, rej) => { reject2 = rej; }));
    reject1!(error1); // First fails first
    reject2!(error2); // Вторая падает после
    await expect(task1).rejects.toThrow("fail1");
    await expect(task2).rejects.toThrow("fail2");
    await expect(resultPromise).rejects.toThrow("fail2");
  });

  it("both tasks fail: second BEFORE first — result and task2 reject, task1 rejects", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    let reject1: (e: any) => void, reject2: (e: any) => void;
    const error1 = new Error("fail1");
    const error2 = new Error("fail2");
    const task1 = queue.run(() => new Promise<number>((_, rej) => { reject1 = rej; }));
    const resultPromise = queue.result;
    const task2 = queue.run(() => new Promise<number>((_, rej) => { reject2 = rej; }));
    reject2!(error2); // Second fails first
    reject1!(error1); // First fails after
    await expect(task1).rejects.toThrow("fail1");
    await expect(task2).rejects.toThrow("fail2");
    await expect(resultPromise).rejects.toThrow("fail2");
  });

  it("if both tasks failed — result and task2 reject, task1 rejects", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    const error1 = new Error("fail1");
    const error2 = new Error("fail2");
    const task1 = queue.run(async () => {
      throw error1;
    });
    const resultPromise = queue.result;
    const task2 = queue.run(async () => {
      throw error2;
    });
    expect(queue.result).toBe(resultPromise);
    await expect(task1).rejects.toThrow("fail1");
    await expect(task2).rejects.toThrow("fail2");
    await expect(resultPromise).rejects.toThrow("fail2");
  });

  it("concurrent: only the result of the last task goes to result", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    expect(queue.result).toBeUndefined();
    let resolve1: (v: number) => void;
    let resolve2: (v: number) => void;
    let resolve3: (v: number) => void;
    const p1 = queue.run(
      () =>
        new Promise<number>((r) => {
          resolve1 = r;
        })
    );
    const result = queue.result;
    expect(result).not.toBeUndefined();
    const p2 = queue.run(
      () =>
        new Promise<number>((r) => {
          resolve2 = r;
        })
    );
    expect(queue.result).toBe(result);
    const p3 = queue.run(
      () =>
        new Promise<number>((r) => {
          resolve3 = r;
        })
    );
    expect(queue.result).toBe(result);
    resolve3!(33);
    expect(await p3).toBe(33);
    resolve1!(11);
    resolve2!(22);
    expect(await p1).toBe(11);
    expect(await p2).toBe(22);
    expect(await result).toBe(33);
  });
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- Result consistency tests ---
describe("result consistency", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("result does not resolve until the last run is finished (no debounce/throttle)", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    expect(queue.result).toBeUndefined();
    let resolve1: (v: number) => void;
    let resolve2: (v: number) => void;
    let resultResolved = false;
    const p1 = queue.run(
      () =>
        new Promise<number>((r) => {
          resolve1 = r;
        })
    );
    const result = queue.result;
    expect(result).not.toBeUndefined();
    const p2 = queue.run(
      () =>
        new Promise<number>((r) => {
          resolve2 = r;
        })
    );
    expect(queue.result).toBe(result);
    const resultPromise = queue.result!;
    resultPromise.then(() => {
      resultResolved = true;
    });
    // Завершаем первую задачу — result не должен резолвиться
    expect(resultResolved).toBe(false);
    resolve1!(1);
    await Promise.resolve();
    expect(resultResolved).toBe(false);
    // Complete the second (last) task — now result should resolve
    resolve2!(2);
    await resultPromise;
    expect(resultResolved).toBe(true);
    expect(await resultPromise).toBe(2);
  });

  it("result does not resolve until the last run is executed (debounce trailing)", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>({ debounceMs: 300 });
    let resolveLast: (v: number) => void;
    let resultResolved = false;
    queue.run(() => new Promise<number>((r) => {}));
    const result = queue.result;
    result!.then(() => {
      resultResolved = true;
    });
    expect(result).not.toBeUndefined();
    queue.run(() => new Promise<number>((r) => {}));
    const lastPromise = queue.run(
      () =>

it("result does not resolve until the last run is executed (throttle leading)", async () => {
const queue = new LastWinsAndCancelsPrevious<number>({
throttleMs: 300,
leading: true,
trailing: false,
});
expect(queue.result).toBeUndefined();
let resolve1: (v: number) => void;
let resolve2: (v: number) => void;
let resultResolved = false;
const p1 = queue.run(
() =>
new Promise<number>((r) => {
resolve1 = r;
})
);
const result = queue.result;
expect(result).not.toBeUndefined();
result!.then(() => {
resultResolved = true;
});
vi.advanceTimersByTime(350);
const p2 = queue.run(
() =>
new Promise<number>((r) => {
resolve2 = r;
})
);
expect(queue.result).toBe(result);
// Complete the first task — result should not resolve, because throttle did not allow the second
resolve1!(1);
await Promise.resolve();
expect(resultResolved).toBe(false);
// Now complete the second (which should not have been called)
resolve2!(2);
expect(await p1).toBe(1);
expect(await p2).toBe(2);
expect(await result).toBe(2);
});

it("result does not resolve until trailing is executed (throttle trailing)", async () => {
const queue = new LastWinsAndCancelsPrevious<number>({
throttleMs: 300,
leading: false,
trailing: true,
});
expect(queue.result).toBeUndefined();
let resolveLast: (v: number) => void;
let resultResolved = false;
queue.run(() => new Promise<number>((r) => {}));
const result = queue.result;
expect(result).not.toBeUndefined();
queue.run(() => new Promise<number>((r) => {}));
const lastPromise = queue.run(
() =>
new Promise<number>((r) => {
resolveLast = r;
})
);
expect(queue.result).toBe(result);
result!.then(() => {
resultResolved = true;
});
vi.advanceTimersByTime(300); // Only now throttle will call the task
await Promise.resolve();
expect(resultResolved).toBe(false);
resolveLast!(99);
await lastPromise;
expect(resultResolved).toBe(true);
expect(await lastPromise).toBe(99);
expect(await result).toBe(99);
    expect(await lastPromise).toBe(99);
    expect(await result).toBe(99);
  });
});

describe("LastWinsAndCancelsPrevious — debounce/throttle behavior", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const makeTask =
    (value: number, log: number[], delay = 0) =>
    async () => {
      await wait(delay);
      log.push(value);
      return value;
    };

  it("debounce trailing=true (по умолчанию): вызывает только после паузы", async () => {
    const log: number[] = [];
    const queue = new LastWinsAndCancelsPrevious<number>({ debounceMs: 300 });

    const r1 = queue.run(makeTask(1, log));
    const result = queue.result;
    vi.advanceTimersByTime(100);
    const r2 = queue.run(makeTask(2, log));
    vi.advanceTimersByTime(100);
    const r3 = queue.run(makeTask(3, log));
    vi.advanceTimersByTime(400);

    await vi.runAllTimersAsync();
    await vi.runAllTicks();
    expect(log).toEqual([3]);
    expect(await result).toBe(3);
    expect(await r1).toBeUndefined();
    expect(await r2).toBeUndefined();
    expect(await r3).toBe(3);
    expect(await result).toBe(3);
  });

  it("debounce leading=true: вызывает сразу, не в конце", async () => {
    const log: number[] = [];
    const queue = new LastWinsAndCancelsPrevious<number>({
      debounceMs: 300,
      leading: true,
      trailing: false,
    });

    const r1 = queue.run(makeTask(1, log));
    const result = queue.result;
    vi.advanceTimersByTime(100);
    const r2 = queue.run(makeTask(2, log));
    vi.advanceTimersByTime(400);
    const r3 = queue.run(makeTask(3, log));
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();
    await vi.runAllTicks();
    await Promise.all([r1, r2, r3]);
    expect(await result).toBe(3);
    expect(await r1).toBe(1);
    expect(await r2).toBeUndefined();
    expect(await r3).toBe(3);
    expect(await result).toBe(3);
    expect(log).toEqual([1, 3]);
  });

  it("debounce leading + trailing: calls twice — at start and end", async () => {
    const log: number[] = [];
    const queue = new LastWinsAndCancelsPrevious<number>({
      debounceMs: 300,
      leading: true,
      trailing: true,
    });

    const r1 = queue.run(makeTask(1, log));
    const result = queue.result;
    vi.advanceTimersByTime(100);
    const r2 = queue.run(makeTask(2, log));
    vi.advanceTimersByTime(200);
    const r3 = queue.run(makeTask(3, log));
    vi.advanceTimersByTime(400);

    await vi.runAllTicks();
    expect(log).toEqual([1, 3]);
    expect(await result).toBe(3);
    expect(await r1).toBe(1);
    expect(await r2).toBeUndefined();
    expect(await r3).toBe(3);
    expect(await result).toBe(3);
  });

  it("debounce leading=false, trailing=false: does not call anything", async () => {
    const log: number[] = [];
    const queue = new LastWinsAndCancelsPrevious<number>({
      debounceMs: 300,
      leading: false,
      trailing: false,
    });

    const r1 = queue.run(makeTask(1, log));
    const r2 = queue.run(makeTask(1, log));
    const r3 = queue.run(makeTask(1, log));
    const r4 = queue.run(makeTask(1, log));
    vi.advanceTimersByTime(500);

    await vi.runAllTimersAsync();
    await vi.runAllTicks();
    expect(await r1).toBeUndefined();
    expect(log).toEqual([]);
  });

  it("throttle leading=true: calls once per interval", async () => {
    const log: number[] = [];
    const queue = new LastWinsAndCancelsPrevious<number>({
      throttleMs: 300,
      leading: true,
      trailing: false,
    });

    const r1 = queue.run(makeTask(1, log));
    vi.advanceTimersByTime(100);
    const r2 = queue.run(makeTask(2, log));
    vi.advanceTimersByTime(200);
    const r3 = queue.run(makeTask(3, log));
    vi.advanceTimersByTime(400);

    await vi.runAllTicks();
    const result = queue.result;
    expect(await result).toBe(3);
    expect(log).toEqual([1, 3]);
    expect(await r1).toBe(1);
    expect(await r2).toBeUndefined();
    expect(await r3).toBe(3);
    expect(await result).toBe(3);
  });

  it("throttle trailing=true: calls at the end of interval", async () => {
    const log: number[] = [];
    const queue = new LastWinsAndCancelsPrevious<number>({
      throttleMs: 300,
      leading: false,
      trailing: true,
    });

    const r1 = queue.run(makeTask(1, log));
    const result = queue.result;
    expect(result).not.toBeUndefined();
    vi.advanceTimersByTime(100);
    const r2 = queue.run(makeTask(2, log));
    expect(result).toBe(queue.result);
    vi.advanceTimersByTime(300);
    const r3 = queue.run(makeTask(3, log));
    expect(result).toBe(queue.result);
    vi.advanceTimersByTime(300);

    await vi.runAllTimersAsync();
    await vi.runAllTicks();
    expect(await result).toBe(3);
    expect(await r1).toBeUndefined();
    expect(await r2).toBe(2);
    expect(await r3).toBe(3);
    expect(await result).toBe(3);
    expect(log).toEqual([2, 3]);
  });

  it("throttle leading + trailing: calls twice per interval", async () => {
    const log: number[] = [];
    const queue = new LastWinsAndCancelsPrevious<number>({
      throttleMs: 300,
      leading: true,
      trailing: true,
    });

    const r1 = queue.run(makeTask(1, log));
    vi.advanceTimersByTime(100);
    const r2 = queue.run(makeTask(2, log));
    vi.advanceTimersByTime(200);
    const r3 = queue.run(makeTask(3, log));
    vi.advanceTimersByTime(400);
    const r4 = queue.run(makeTask(4, log));
    const result = queue.result;
    expect(result).not.toBeUndefined();
    vi.advanceTimersByTime(400);

    await vi.runAllTimersAsync();
    await vi.runAllTicks();
    expect(await result).toBe(4);
    expect(await r1).toBe(1);
    expect(await r2).toBe(2);
    expect(await r3).toBe(3);
    expect(await r4).toBe(4);
    expect(await result).toBe(4);
    expect(log).toEqual([1, 2, 3, 4]);
  });

  it("throttle leading=false, trailing=false: does not call anything", async () => {
    const log: number[] = [];
    const queue = new LastWinsAndCancelsPrevious<number>({
      throttleMs: 300,
      leading: false,
      trailing: false,
    });

    const r1 = await queue.run(makeTask(1, log));
    const r2 = await queue.run(makeTask(1, log));
    const r3 = await queue.run(makeTask(1, log));
    const r4 = await queue.run(makeTask(1, log));
    await vi.runAllTimersAsync();
    await vi.runAllTicks();
    expect(r1).toBeUndefined();
    expect(log).toEqual([]);
  });
});

describe("LastWinsAndCancelsPrevious — hooks and abort", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls onAborted when task is cancelled by new run", async () => {
    const onAborted = vi.fn();
    const queue = new LastWinsAndCancelsPrevious<number>();
    queue.onAborted(onAborted);
    let aborted = false;
    const first = queue.run(async (signal) => {
      return new Promise<number>((resolve) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          resolve(-1);
        });
        setTimeout(() => resolve(1), 100);
      });
    });
    const second = queue.run(async () => 2);
    expect(await second).toBe(2);
    expect(await first).toBe(-1);
    expect(aborted).toBe(true);
    expect(onAborted).toHaveBeenCalledTimes(1);
    expect(onAborted.mock.calls[0][0]).toMatchObject({ aborted: true });
  });

  it("calls onAborted when abort() is called", async () => {
    const onAborted = vi.fn();
    const queue = new LastWinsAndCancelsPrevious<number>();
    queue.onAborted(onAborted);
    let aborted = false;
    const task = queue.run(async (signal) => {
      return new Promise<number>((resolve) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          resolve(-1);
        });
        setTimeout(() => resolve(1), 100);
      });
    });
    queue.abort();
    expect(await task).toBe(-1);
    expect(aborted).toBe(true);
    expect(onAborted).toHaveBeenCalledTimes(1);
    expect(onAborted.mock.calls[0][0]).toMatchObject({ aborted: true });
  });

  it("calls onError when task throws", async () => {
    const onError = vi.fn();
    const queue = new LastWinsAndCancelsPrevious<number>();
    queue.onError(onError);
    const error = new Error("fail");
    const task = queue.run(async () => {
      throw error;
    });
    await expect(task).rejects.toThrow("fail");
    expect(onError).toHaveBeenCalledTimes(1);
    // После ошибки — isSeriesEnd === true
    expect(onError.mock.calls[0][0]).toMatchObject({ error, isSeriesEnd: true });
  });

  it("calls onComplete when task resolves", async () => {
    const onComplete = vi.fn();
    const queue = new LastWinsAndCancelsPrevious<number>();
    queue.onComplete(onComplete);
    const task = queue.run(async () => 42);
    expect(await task).toBe(42);
    expect(onComplete).toHaveBeenCalledTimes(1);
// После успешного завершения — isSeriesEnd === true
expect(onComplete.mock.calls[0][0]).toMatchObject({ result: 42, isSeriesEnd: true });
    // После успешного завершения — isSeriesEnd === true
    expect(onComplete.mock.calls[0][0]).toMatchObject({ result: 42, isSeriesEnd: true });
  });

  it("does not call hooks extra times (multiple aborts, errors, completes)", async () => {
    const onAborted = vi.fn();
    const onError = vi.fn();
    const onComplete = vi.fn();
    const queue = new LastWinsAndCancelsPrevious<number>();
    queue.onAborted(onAborted);
    queue.onError(onError);
    queue.onComplete(onComplete);
    // First: success
    await queue.run(async () => 1);
    expect(onAborted).toHaveBeenCalledTimes(0); // после первого run — не было отмен
    // Second: error
    await expect(queue.run(async () => { throw new Error("err"); })).rejects.toThrow("err");
    expect(onAborted).toHaveBeenCalledTimes(1); // 1. abort by new run
    expect(onAborted.mock.calls[0][0]).toMatchObject({ isSeriesEnd: false });
    // Third: abort by new run
    const t1 = queue.run(async (signal) => new Promise<number>((resolve) => {
      signal.addEventListener("abort", () => resolve(-1));
      setTimeout(() => resolve(10), 100);
    }));
    expect(onAborted).toHaveBeenCalledTimes(2); // 2. abort by new run
expect(onAborted.mock.calls[1][0]).toMatchObject({ isSeriesEnd: false });
    // 2. abort by new run — isSeriesEnd: false
    expect(onAborted.mock.calls[1][0]).toMatchObject({ isSeriesEnd: false });
    const t2 = queue.run(async () => 2);
    expect(onAborted).toHaveBeenCalledTimes(3); // 3. abort by new run
expect(onAborted.mock.calls[2][0]).toMatchObject({ isSeriesEnd: false });
    // 3. abort by new run — isSeriesEnd: false
    expect(onAborted.mock.calls[2][0]).toMatchObject({ isSeriesEnd: false });
    await t1; await t2;
    // Fourth: abort by abort()
    const t3 = queue.run(async (signal) => new Promise<number>((resolve) => {
      signal.addEventListener("abort", () => resolve(-1));
      setTimeout(() => resolve(3), 100);
    }));
    expect(onAborted).toHaveBeenCalledTimes(4); // 4. abort by abort()
    expect(onAborted.mock.calls[3][0]).toMatchObject({ isSeriesEnd: false });
    queue.abort();
    await t3;
    expect(onAborted).toHaveBeenCalledTimes(5); // 5. abort by abort()
    expect(onAborted.mock.calls[4][0]).toMatchObject({ isSeriesEnd: true });
    expect(onComplete).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onAborted).toHaveBeenCalledTimes(5);
  });

  it("does not break if hook throws", async () => {
    const onAborted = vi.fn(() => { throw new Error("hook fail"); });
    const onError = vi.fn(() => { throw new Error("hook fail"); });
    const onComplete = vi.fn(() => { throw new Error("hook fail"); });
    const queue = new LastWinsAndCancelsPrevious<number>();
    queue.onAborted(onAborted);
    queue.onError(onError);
    queue.onComplete(onComplete);
    // onComplete throws, but task still resolves
    expect(await queue.run(async () => 1)).toBe(1);
    // onError throws, but task still rejects
    await expect(queue.run(async () => { throw new Error("err"); })).rejects.toThrow("err");
    // onAborted throws, but abort still works
    const t = queue.run(async (signal) => new Promise<number>((resolve) => {
      signal.addEventListener("abort", () => resolve(-1));
      setTimeout(() => resolve(5), 100);
    }));
    queue.abort();
    expect(await t).toBe(-1);
  });

  it("abort() does nothing if no active task", () => {
    const onAborted = vi.fn();
    const queue = new LastWinsAndCancelsPrevious<number>();
    queue.onAborted(onAborted);
    queue.abort();
    expect(onAborted).not.toHaveBeenCalled();
  });
});
