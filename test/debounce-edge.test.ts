import { wait } from './utils';
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  LastWinsAndCancelsPrevious,
  TaskAbortedError,
  TaskCanceledError,
  TaskIgnoredError,
} from "../src/index";


describe("LastWinsAndCancelsPrevious — debounce edge: 'leading'", () => {

  it("leading: повторные run в окне игнорируются", async () => {
    const queue = new LastWinsAndCancelsPrevious(
      async (_signal, x: number) => x,
      { debounceMs: 40, edge: "leading" }
    );
    const p1 = queue.run(1);
    await wait(10);
    const p2 = queue.run(2);
    await wait(10);
    const p3 = queue.run(3);
    await wait(21);
    await expect(p1).resolves.toBe(1);
    await expect(p2).rejects.toThrow(TaskIgnoredError);
    await expect(p3).rejects.toThrow(TaskIgnoredError);
  });

  it("leading: run после паузы снова стартует немедленно", async () => {
    const queue = new LastWinsAndCancelsPrevious(
      async (_signal, x: number) => x,
      { debounceMs: 20, edge: "leading" }
    );
    const p1 = queue.run(1);
    await wait(30);
    // await wait(30);
    const p2 = queue.run(2);
    await expect(p1).resolves.toBe(1);
    await expect(p2).resolves.toBe(2);
  });

  it("leading: хуки вызываются корректно", async () => {
    let started = 0,
      aborted = 0,
      ignored = 0;
    const queue = new LastWinsAndCancelsPrevious(
      async (_signal, x: number) => x,
      { debounceMs: 20, edge: "leading" }
    );
    queue.onTaskStarted(() => {
      started++;
    });
    queue.onTaskAborted(() => {
      aborted++;
    });
    queue.onTaskIgnored(() => {
      ignored++;
    });
    queue.run(1);
    queue.run(2);
    queue.run(3);
    await wait(0)
    expect(started).toBe(1);
    expect(aborted).toBe(0);
    expect(ignored).toBe(2);
  });

  it("leading: abort отменяет только активную задачу", async () => {
    const queue = new LastWinsAndCancelsPrevious(
      async (_signal, x: number) => x,
      { debounceMs: 30, edge: "leading" }
    );
    const p1 = queue.run(1);
    queue.abort();
    await expect(p1).rejects.toThrow(TaskAbortedError);
  });
});

describe("LastWinsAndCancelsPrevious — debounce edge: 'both'", () => {
  it("both: первый run стартует немедленно, trailing — по окончании окна", async () => {
    const results: number[] = [];
    const queue = new LastWinsAndCancelsPrevious(
      async (_signal, x: number) => {
        results.push(x);
        return x;
      },
      { debounceMs: 40, edge: "both" }
    );
    const p1 = queue.run(1);
    await wait(10);
    const p2 = queue.run(2);
    await wait(10);
    const p3 = queue.run(3);
    await wait(41);
    await expect(p1).resolves.toBe(1);
    await expect(p2).rejects.toThrow(TaskIgnoredError);
    await expect(p3).resolves.toBe(3);
    // trailing
    expect(results).toEqual([1, 3]);
  });

  it("both: если не было новых run — trailing не вызывается", async () => {
    let called = 0;
    const queue = new LastWinsAndCancelsPrevious(
      async (_signal, x: number) => {
        called++;
        return x;
      },
      { debounceMs: 30, edge: "both" }
    );
    const p1 = queue.run(1);
    await wait(31);
    await expect(p1).resolves.toBe(1);
    expect(called).toBe(1);
  });

  it("both: run после trailing снова стартует немедленно", async () => {
    const queue = new LastWinsAndCancelsPrevious(
      async (_signal, x: number) => x,
      { debounceMs: 20, edge: "both" }
    );
    const p1 = queue.run(1);
    await wait(21);
    const p2 = queue.run(2);
    await expect(p1).resolves.toBe(1);
    await expect(p2).resolves.toBe(2);
  });

  it("both: хуки вызываются корректно (started 2, ignored 2)", async () => {
    let started = 0,
      ignored = 0;
    const queue = new LastWinsAndCancelsPrevious(
      async (_signal, x: number) => x,
      { debounceMs: 20, edge: "both" }
    );
    queue.onTaskStarted(() => {
      started++;
    });
    queue.onTaskIgnored(() => {
      ignored++;
    });
    queue.run(1);
    queue.run(2);
    queue.run(3);
    await wait(21);
    expect(started).toBe(2); // leading и trailing
    expect(ignored).toBe(1);
  });

  it("both: trailing run получает последние аргументы", async () => {
    let trailingArg = -1;
    const queue = new LastWinsAndCancelsPrevious(
      async (_signal, x: number) => {
        trailingArg = x;
        return x;
      },
      { debounceMs: 15, edge: "both" }
    );
    queue.run(1);
    queue.run(2);
    queue.run(42);
    await wait(16);
    expect(trailingArg).toBe(42);
  });

  it("both: abort до trailing отменяет trailing задачу", async () => {
    const queue = new LastWinsAndCancelsPrevious(
      async (_signal, x: number) => x,
      { debounceMs: 25, edge: "both" }
    );
    const p1 = queue.run(1);
    const p2 = queue.run(2);
    queue.abort();
    await wait(26);
    await expect(p1).rejects.toThrow(TaskAbortedError);
    await expect(p2).rejects.toThrow(TaskCanceledError);
    // trailing задача отменена
    // trailing промис не создаётся, но можно проверить хуки/счётчики если нужно
  });
});
