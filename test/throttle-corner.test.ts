import { describe, it, expect, vi } from "vitest";
import {
  LastWinsAndCancelsPrevious,
  TaskAbortedError,
  TaskIgnoredError,
} from "../src";
import { wait } from "./utils";

type ThrottleOptions = {
  ms: number;
  edge?: "leading" | "trailing" | "both";
};
// Вспомогательная функция для создания очереди с throttle
function createThrottleQueue(
  fn: any,
  { ms = 50, edge = "leading" }: ThrottleOptions
) {
  return new LastWinsAndCancelsPrevious(fn, { throttleMs: ms, edge });
}

describe("LastWinsAndCancelsPrevious — throttle corner cases", () => {
  it('edge=both: deferred хук, второй вызов исполняется, nextTaskStartedPromise резолвится верно', async () => {
    const deferred: number[] = [], started: number[] = [];
    const results: number[] = [];
    const fn = vi.fn(async (signal: AbortSignal, x: number) => { results.push(x); return x; });
    const queue = createThrottleQueue(fn, { ms: 500, edge: "both" });
    queue.onTaskDeferred(({ args }) => deferred.push(args[0]));
    queue.onTaskStarted(({ args }) => started.push(args[0]));
    const p1 = queue.run(1);
    const p2 = queue.run(2);
    await wait(10); // ждем 10мс, чтобы второй вызов был отложен
    const nextStartedPromise = (queue as any).nextTaskStartedPromise as Promise<void>;
    await wait(520); // ждем завершения окна
    // deferred хук сработал на второй вызов
    expect(deferred).toEqual([2]);
    // второй вызов реально исполнился
    expect(fn).toHaveBeenCalledTimes(2);
    expect(results).toEqual([1, 2]);
    // nextTaskStartedPromise резолвился после старта второго вызова
    await expect(nextStartedPromise).resolves.toBeUndefined();
    // started отражает порядок запуска
    expect(started).toEqual([1, 2]);
    // второй промис — это результат второго вызова
    expect(await p2).toBe(2);
  });
  it("запускает только первый вызов в throttle-окне (leading)", async () => {
    const results: number[] = [];
    const fn = vi.fn(async (signal: AbortSignal, x: number) => {
      results.push(x);
      return x;
    });
    const queue = createThrottleQueue(fn, { ms: 40, edge: "leading" });
    const p1 = queue.run(1);
    const p2 = queue.run(2);
    await wait(60);
    expect(await p1).toBe(1);
    await expect(p2).rejects.toThrow(TaskIgnoredError);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(results).toEqual([1]);
  });

  it("запускает trailing-вызов после throttle-интервала (trailing)", async () => {
    const results: number[] = [];
    const fn = vi.fn(async (signal: AbortSignal, x: number) => {
      results.push(x);
      return x;
    });
    const queue = createThrottleQueue(fn, { ms: 40, edge: "trailing" });
    const p1 = queue.run(1);
    const p2 = queue.run(2);
    await wait(60);
    await expect(p1).rejects.toThrow(TaskIgnoredError);
    expect(await p2).toBe(2);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(results).toEqual([2]);
  });

  it("запускает оба вызова при leading+trailing", async () => {
    const results: number[] = [];
    const fn = vi.fn(async (signal: AbortSignal, x: number) => {
      results.push(x);
      return x;
    });
    const queue = createThrottleQueue(fn, { ms: 40, edge: "both" });
    const p1 = queue.run(1);
    const p2 = queue.run(2);
    await wait(60);
    expect(await p1).toBe(1);
    expect(await p2).toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(results).toEqual([1, 2]);
  });

  it("игнорирует лишние вызовы в throttle-окне", async () => {
    const results: number[] = [];
    const fn = vi.fn(async (signal: AbortSignal, x: number) => {
      results.push(x);
      return x;
    });
    const queue = createThrottleQueue(fn, { ms: 40, edge: "leading" });
    const p1 = queue.run(1);
    const p2 = queue.run(2);
    const p3 = queue.run(3);
    await wait(60);
    expect(await p1).toBe(1);
    await expect(p2).rejects.toThrow(TaskIgnoredError);
    await expect(p3).rejects.toThrow(TaskIgnoredError);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(results).toEqual([1]);
  });

  it("хуки onTaskStarted/onTaskAborted/onTaskIgnored вызываются корректно", async () => {
    const started: number[] = [],
      aborted: number[] = [],
      ignored: number[] = [];
    const fn = vi.fn(async (signal: AbortSignal) => 1);
    const queue = createThrottleQueue(fn, { ms: 40, edge: "leading" });
    queue.onTaskStarted(() => started.push(Date.now()));
    queue.onTaskAborted(() => aborted.push(Date.now()));
    queue.onTaskIgnored(() => ignored.push(Date.now()));
    const ac = new AbortController();
    const p1 = queue.run();
    const p2 = queue.run({ signal: ac.signal });
    ac.abort();
    await wait(60);
    expect(started.length + aborted.length + ignored.length).toBe(2);
    // либо started+ignored, либо started+aborted
  });

  it("разные очереди с throttle не мешают друг другу", async () => {
    const r1: number[] = [],
      r2: number[] = [];
    const fn1 = vi.fn(async (signal: AbortSignal, x: number) => {
      r1.push(x);
      return x;
    });
    const fn2 = vi.fn(async (signal: AbortSignal, x: number) => {
      r2.push(x);
      return x;
    });
    const queue1 = createThrottleQueue(fn1, { ms: 40, edge: "leading" });
    const queue2 = createThrottleQueue(fn2, { ms: 40, edge: "leading" });
    const p1 = queue1.run(1);
    const p2 = queue2.run(2);
    await wait(60);
    expect(await p1).toBe(1);
    expect(await p2).toBe(2);
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
  });
});
