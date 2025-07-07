import { describe, it, expect, vi } from "vitest";
import { LastWinsAndCancelsPrevious } from "../src";

import { wait } from './utils';

// onTaskAborted, onSeriesFailed, onSeriesSucceeded

describe("LastWinsAndCancelsPrevious — hooks and abort", () => {
  it("calls all onTaskAborted subscribers independently", async () => {
    const calls1: any[] = [];
    const calls2: any[] = [];
    const queue = new LastWinsAndCancelsPrevious<number>();
    queue.onTaskAborted((args) => calls1.push(args));
    queue.onTaskAborted((args) => calls2.push(args));
    const first = queue.run(async (signal) => {
      return new Promise<number>((resolve) => {
        signal.addEventListener("abort", () => resolve(-1));
        setTimeout(() => resolve(1), 50);
      });
    });
    const second = queue.run(async () => 2);
    expect(await second).toBe(2);
    expect(await first).toBe(-1);
    expect(calls1.length).toBe(1);
    expect(calls2.length).toBe(1);
    expect(calls1[0]).toMatchObject({ aborted: true });
    expect(calls2[0]).toMatchObject({ aborted: true });
  });

  it("calls all onSeriesFailed subscribers independently", async () => {
    const calls1: any[] = [];
    const calls2: any[] = [];
    const queue = new LastWinsAndCancelsPrevious<number>();
    queue.onSeriesFailed((args) => calls1.push(args));
    queue.onSeriesFailed((args) => calls2.push(args));
    const error = new Error("fail");
    const task = queue.run(async () => { throw error; });
    await expect(task).rejects.toThrow("fail");
    expect(calls1.length).toBe(1);
    expect(calls2.length).toBe(1);
    expect(calls1[0]).toMatchObject({ error, isSeriesEnd: true });
    expect(calls2[0]).toMatchObject({ error, isSeriesEnd: true });
  });

  it("calls all onSeriesSucceeded subscribers independently", async () => {
    const calls1: any[] = [];
    const calls2: any[] = [];
    const queue = new LastWinsAndCancelsPrevious<number>();
    queue.onSeriesSucceeded((args) => calls1.push(args));
    queue.onSeriesSucceeded((args) => calls2.push(args));
    const task = queue.run(async () => 42);
    expect(await task).toBe(42);
    expect(calls1.length).toBe(1);
    expect(calls2.length).toBe(1);
    expect(calls1[0]).toMatchObject({ result: 42, isSeriesEnd: true });
    expect(calls2[0]).toMatchObject({ result: 42, isSeriesEnd: true });
  });

  it("calls onTaskAborted when task is cancelled by new run", async () => {
    const onTaskAborted = vi.fn();
    const queue = new LastWinsAndCancelsPrevious<number>();
    queue.onTaskAborted(onTaskAborted);
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
    expect(onTaskAborted).toHaveBeenCalledTimes(1);
    expect(onTaskAborted.mock.calls[0][0]).toMatchObject({ aborted: true });
  });

  it("calls onTaskAborted when abort() is called", async () => {
    const onTaskAborted = vi.fn();
    const queue = new LastWinsAndCancelsPrevious<number>();
    queue.onTaskAborted(onTaskAborted);
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
    expect(onTaskAborted).toHaveBeenCalledTimes(1);
    expect(onTaskAborted.mock.calls[0][0]).toMatchObject({ aborted: true });
  });

  it("calls onSeriesFailed when task throws", async () => {
    const onSeriesFailed = vi.fn();
    const queue = new LastWinsAndCancelsPrevious<number>();
    queue.onSeriesFailed(onSeriesFailed);
    const error = new Error("fail");
    const task = queue.run(async () => {
      throw error;
    });
    await expect(task).rejects.toThrow("fail");
    expect(onSeriesFailed).toHaveBeenCalledTimes(1);
    expect(onSeriesFailed.mock.calls[0][0]).toMatchObject({
      error,
      isSeriesEnd: true,
    });
  });

  it("calls onSeriesSucceeded when task resolves", async () => {
    const onSeriesSucceeded = vi.fn();
    const queue = new LastWinsAndCancelsPrevious<number>();
    queue.onSeriesSucceeded(onSeriesSucceeded);
    const task = queue.run(async () => 42);
    expect(await task).toBe(42);
    expect(onSeriesSucceeded).toHaveBeenCalledTimes(1);
    expect(onSeriesSucceeded.mock.calls[0][0]).toMatchObject({
      result: 42,
      isSeriesEnd: true,
    });
    expect(onSeriesSucceeded.mock.calls[0][0]).toMatchObject({
      result: 42,
      isSeriesEnd: true,
    });
  });

  it("does not call hooks extra times (multiple aborts, errors, completes)", async () => {
    const onTaskAborted = vi.fn();
    const onSeriesFailed = vi.fn();
    const onSeriesSucceeded = vi.fn();
    const queue = new LastWinsAndCancelsPrevious<number>();
    queue.onTaskAborted(onTaskAborted);
    queue.onSeriesFailed(onSeriesFailed);
    queue.onSeriesSucceeded(onSeriesSucceeded);
    await queue.run(async () => 1);
    expect(onTaskAborted).toHaveBeenCalledTimes(0);
    await expect(
      queue.run(async () => {
        throw new Error("err");
      })
    ).rejects.toThrow("err");
    expect(onTaskAborted).toHaveBeenCalledTimes(1);
    expect(onTaskAborted.mock.calls[0][0]).toMatchObject({ isSeriesEnd: false });
    const t1 = queue.run(
      async (signal) =>
        new Promise<number>((resolve) => {
          signal.addEventListener("abort", () => resolve(-1));
          setTimeout(() => resolve(10), 100);
        })
    );
    expect(onTaskAborted).toHaveBeenCalledTimes(2);
    expect(onTaskAborted.mock.calls[1][0]).toMatchObject({ isSeriesEnd: false });
    expect(onTaskAborted.mock.calls[1][0]).toMatchObject({ isSeriesEnd: false });
    const t2 = queue.run(async () => 2);
    expect(onTaskAborted).toHaveBeenCalledTimes(3);
    expect(onTaskAborted.mock.calls[2][0]).toMatchObject({ isSeriesEnd: false });
    expect(onTaskAborted.mock.calls[2][0]).toMatchObject({ isSeriesEnd: false });
    await t1;
    await t2;
    const t3 = queue.run(
      async (signal) =>
        new Promise<number>((resolve) => {
          signal.addEventListener("abort", () => resolve(-1));
          setTimeout(() => resolve(3), 100);
        })
    );
    expect(onTaskAborted).toHaveBeenCalledTimes(4);
    expect(onTaskAborted.mock.calls[3][0]).toMatchObject({ isSeriesEnd: false });
    queue.abort();
    await t3;
    expect(onTaskAborted).toHaveBeenCalledTimes(5);
    expect(onTaskAborted.mock.calls[4][0]).toMatchObject({ isSeriesEnd: true });
    expect(onSeriesSucceeded).toHaveBeenCalledTimes(2);
    expect(onSeriesFailed).toHaveBeenCalledTimes(1);
    expect(onTaskAborted).toHaveBeenCalledTimes(5);
  });

  it("abort() does nothing if no active task", () => {
    const onTaskAborted = vi.fn();
    const queue = new LastWinsAndCancelsPrevious<number>();
    queue.onTaskAborted(onTaskAborted);
    queue.abort();
    expect(onTaskAborted).not.toHaveBeenCalled();
  });
});

// onSeriesStarted

describe("LastWinsAndCancelsPrevious — onSeriesStarted hook", () => {
  it("вызывается при каждом запуске новой задачи", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    const calls: any[] = [];
    queue.onSeriesStarted(() => calls.push("start"));
    await queue.run(async () => 1);
    await queue.run(async () => 2);
    expect(calls.length).toBe(2);
  });

  it("не вызывается, если run не приводит к запуску (debounce)", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>({ debounceMs: 100 });
    const calls: any[] = [];
    queue.onSeriesStarted(() => calls.push("start"));
    const r1 = queue.run(async () => 1);
    const r2 = queue.run(async () => 2);
    await wait(150);
    await r2;
    expect(calls.length).toBe(1);
  });

  it("вызывает всех подписчиков", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    const calls1: any[] = [];
    const calls2: any[] = [];
    queue.onSeriesStarted(() => calls1.push("a"));
    queue.onSeriesStarted(() => calls2.push("b"));
    await queue.run(async () => 1);
    expect(calls1.length).toBe(1);
    expect(calls2.length).toBe(1);
  });

  it("onSeriesStarted отписка работает", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    const calls: any[] = [];
    const unsub = queue.onSeriesStarted(() => calls.push("start"));
    await queue.run(async () => 1);
    unsub();
    await queue.run(async () => 2);
    expect(calls.length).toBe(1);
  });

  it("не вызывается, если задача не стартовала из-за throttle", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>({ throttleMs: 200 });
    const calls: any[] = [];
    queue.onSeriesStarted(() => calls.push("start"));
    await queue.run(async () => 1);
    await queue.run(async () => 2);
    await wait(250);
    await queue.run(async () => 3);
    expect(calls.length).toBe(2);
  });
});

// onSeriesEnded

describe("LastWinsAndCancelsPrevious — onSeriesEnded hook", () => {
  it("вызывается при успешном завершении", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    const calls: any[] = [];
    queue.onSeriesEnded((args) => calls.push(args));
    await queue.run(async () => 42);
    expect(calls.length).toBe(1);
    expect(calls[0]).toMatchObject({ isSeriesEnd: true, result: 42 });
  });

  it("вызывается при ошибке", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    const calls: any[] = [];
    queue.onSeriesEnded((args) => calls.push(args));
    await expect(queue.run(async () => { throw new Error('fail'); })).rejects.toThrow('fail');
    expect(calls.length).toBe(1);
    expect(calls[0]).toMatchObject({ isSeriesEnd: true, error: expect.any(Error) });
  });

  it("вызывается при отмене", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    const calls: any[] = [];
    queue.onSeriesEnded((args) => calls.push(args));
    const t = queue.run(async (signal) => new Promise<number>((resolve) => {
      signal.addEventListener("abort", () => resolve(-1));
      setTimeout(() => resolve(1), 100);
    }));
    queue.abort();
    await t;
    expect(calls.length).toBe(1);
    expect(calls[0]).toMatchObject({ isSeriesEnd: true, aborted: true });
  });

  it("onSeriesEnded отписка работает", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    const calls: any[] = [];
    const unsub = queue.onSeriesEnded((args) => calls.push(args));
    await queue.run(async () => 1);
    unsub();
    await queue.run(async () => 2);
    expect(calls.length).toBe(1);
  });

  it("работает с debounce", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>({ debounceMs: 100 });
    const calls: any[] = [];
    queue.onSeriesEnded((args) => calls.push(args));
    queue.run(async () => 1);
    queue.run(async () => 2);
    await wait(150);
    expect(calls.length).toBe(1);
    expect(calls[0]).toMatchObject({ isSeriesEnd: true, result: 2 });
  });

  it("работает с несколькими подписчиками", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    const calls1: any[] = [];
    const calls2: any[] = [];
    queue.onSeriesEnded((args) => calls1.push(args));
    queue.onSeriesEnded((args) => calls2.push(args));
    await queue.run(async () => 1);
    expect(calls1.length).toBe(1);
    expect(calls2.length).toBe(1);
  });
});

// Unsubscribe & multi-subscriber

describe("LastWinsAndCancelsPrevious — unsubscribe hooks", () => {
  it("onSeriesFailed вызывается при ошибке, даже если задача не выиграла гонку", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    const calls: any[] = [];
    queue.onSeriesFailed((args) => calls.push(args));
    const run1 = queue.run(async () => {
      await wait(100);
      throw new Error("fail");
    });
    const run2 = queue.run(async () => {
      return 1;
    });
    const result = queue.currentSeriesResult;
    await expect(run1).rejects.toThrow("fail");
    expect(await run2).toBe(1);
    expect(calls.length).toBe(1);
    expect(await result).toBe(1);
    expect(calls[0]).toMatchObject({
      error: expect.any(Error),
      aborted: false,
    });
  });
  it("onTaskAborted отписка работает", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    const calls: any[] = [];
    const unsub = queue.onTaskAborted((args) => calls.push(args));
    await queue.run(async () => 1);
    queue.run(async () => 2);
    expect(calls.length).toBe(1);
    unsub();
    queue.run(async () => 3);
    expect(calls.length).toBe(1);
  });

  it("onSeriesFailed отписка работает", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    const calls: any[] = [];
    const unsub = queue.onSeriesFailed((args) => calls.push(args));
    await expect(
      queue.run(async () => {
        throw new Error("fail");
      })
    ).rejects.toThrow("fail");
    expect(calls.length).toBe(1);
    unsub();
    await expect(
      queue.run(async () => {
        throw new Error("fail2");
      })
    ).rejects.toThrow("fail2");
    expect(calls.length).toBe(1);
  });

  it("onSeriesSucceeded отписка работает", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    const calls: any[] = [];
    const unsub = queue.onSeriesSucceeded((args) => calls.push(args));
    await queue.run(async () => 1);
    expect(calls.length).toBe(1);
    unsub();
    await queue.run(async () => 2);
    expect(calls.length).toBe(1);
  });
});
