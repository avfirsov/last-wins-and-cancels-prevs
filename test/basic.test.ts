import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LastWinsAndCancelsPrevious } from "../src";

describe("LastWinsAndCancelsPrevious", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("резолвит результат единственной задачи", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    const result = await queue.run(async () => 42);
    expect(result).toBe(42);
    expect(await queue.result).toBe(42);
  });

  it("отменяет предыдущую задачу при запуске новой", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
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
    const second = queue.run(async () => 2);
    expect(await second).toBe(2);
    expect(firstAborted).toBe(true);
    expect(await queue.result).toBe(2);
  });

  it("run возвращает undefined при отмене задачи", async () => {
    const queue = new LastWinsAndCancelsPrevious<number | undefined>();
    const first = queue.run(async (signal) => {
      return new Promise<number | undefined>((resolve) => {
        signal.addEventListener("abort", () => resolve(undefined));
        setTimeout(() => resolve(1), 100);
      });
    });
    queue.run(async () => 2); // отменяет первую
    expect(await first).toBeUndefined();
  });

  it("result резолвится только с последней задачей", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    queue.run(async () => 1);
    queue.run(async () => 2);
    const last = queue.run(async () => 3);
    expect(await last).toBe(3);
  });

  it("старые задачи без AbortSignal завершаются, но не влияют на result", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    let finished = false;
    const first = queue.run(async () => {
      await new Promise((r) => setTimeout(() => r("first"), 100));
      finished = true;
      return 1;
    });
    const last = queue.run(async () => 2);
    await vi.advanceTimersByTimeAsync(100); // Продвигаем таймеры, чтобы промисы резолвились
    expect(await last).toBe(2);
    expect(await queue.result).toBe(2);
    expect(await first).toBe(1); // Ожидаем undefined, т.к. задача была отменена
    expect(finished).toBe(true);
  });

  it("ошибка в задаче приводит к reject result", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    const error = new Error("fail");
    const task = queue.run(async () => {
      throw error;
    });
    await expect(task).rejects.toThrow("fail");
    await expect(queue.result).rejects.toThrow("fail");
  });

  it("concurrent: только результат последней задачи попадает в result", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    let resolve1: (v: number) => void;
    let resolve2: (v: number) => void;
    let resolve3: (v: number) => void;
    const p1 = queue.run(
      () =>
        new Promise<number>((r) => {
          resolve1 = r;
        })
    );
    const p2 = queue.run(
      () =>
        new Promise<number>((r) => {
          resolve2 = r;
        })
    );
    const p3 = queue.run(
      () =>
        new Promise<number>((r) => {
          resolve3 = r;
        })
    );
    resolve3!(33);
    expect(await queue.result).toBe(33);
    expect(await p3).toBe(33);
    resolve1!(11);
    resolve2!(22);
    expect(await p1).toBe(11);
    expect(await p2).toBe(22);
  });
});


const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("LastWinsAndCancelsPrevious — debounce/throttle поведение", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const makeTask = (value: number, log: number[], delay = 0) =>
    async () => {
      await wait(delay);
      log.push(value);
      return value;
    };

  it("debounce trailing=true (по умолчанию): вызывает только после паузы", async () => {
    const log: number[] = [];
    const queue = new LastWinsAndCancelsPrevious<number>({ debounceMs: 300 });

    const r1 = queue.run(makeTask(1, log));
    vi.advanceTimersByTime(100);
    const r2 = queue.run(makeTask(2, log));
    vi.advanceTimersByTime(100);
    const r3 = queue.run(makeTask(3, log));
    vi.advanceTimersByTime(400);

    await vi.runAllTimersAsync();
    await vi.runAllTicks();
    expect(log).toEqual([3]);
    expect(await r1).toBeUndefined();
    expect(await r2).toBeUndefined();
    expect(await r3).toBe(3);
    expect(await queue.result).toBe(3);
  });

  it("debounce leading=true: вызывает сразу, не в конце", async () => {
    const log: number[] = [];
    const queue = new LastWinsAndCancelsPrevious<number>({ debounceMs: 300, leading: true, trailing: false });

    const r1 = queue.run(makeTask(1, log));
    vi.advanceTimersByTime(100);
    const r2 = queue.run(makeTask(2, log));
    vi.advanceTimersByTime(400);
    const r3 = queue.run(makeTask(3, log));
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();
    await vi.runAllTicks();
    await Promise.all([r1, r2, r3]);
    expect(await r1).toBe(1);
    expect(await r2).toBeUndefined();
    expect(await r3).toBe(3);
    expect(await queue.result).toBe(3);
    expect(log).toEqual([1, 3]);
  });

  it("debounce leading + trailing: вызывает дважды — в начале и в конце", async () => {
    const log: number[] = [];
    const queue = new LastWinsAndCancelsPrevious<number>({ debounceMs: 300, leading: true, trailing: true });

    const r1 = queue.run(makeTask(1, log));
    vi.advanceTimersByTime(100);
    const r2 = queue.run(makeTask(2, log));
    vi.advanceTimersByTime(200);
    const r3 = queue.run(makeTask(3, log));
    vi.advanceTimersByTime(400);

    await vi.runAllTicks();
    expect(log).toEqual([1, 3]);
    expect(await r1).toBe(1);
    expect(await r2).toBeUndefined();
    expect(await r3).toBe(3);
    expect(await queue.result).toBe(3);
  });

  it("debounce leading=false, trailing=false: не вызывает ничего", async () => {
    const log: number[] = [];
    const queue = new LastWinsAndCancelsPrevious<number>({ debounceMs: 300, leading: false, trailing: false });

    const result = await queue.run(makeTask(1, log));
    vi.advanceTimersByTime(500);

    await vi.runAllTimersAsync();
    await vi.runAllTicks();
    expect(result).toBeUndefined();
    expect(log).toEqual([]);
  });

  it("throttle leading=true: вызывает один раз в интервал", async () => {
    const log: number[] = [];
    const queue = new LastWinsAndCancelsPrevious<number>({ throttleMs: 300, leading: true, trailing: false });

    const r1 = queue.run(makeTask(1, log));
    vi.advanceTimersByTime(100);
    const r2 = queue.run(makeTask(2, log));
    vi.advanceTimersByTime(200);
    const r3 = queue.run(makeTask(3, log));
    vi.advanceTimersByTime(400);

    await vi.runAllTicks();
    expect(log).toEqual([1, 3]);
    expect(await r1).toBe(1);
    expect(await r2).toBeUndefined();
    expect(await r3).toBe(3);
    expect(await queue.result).toBe(3);
  });

  it("throttle trailing=true: вызывает в конце интервала", async () => {
    const log: number[] = [];
    const queue = new LastWinsAndCancelsPrevious<number>({ throttleMs: 300, leading: false, trailing: true });

    const r1 = queue.run(makeTask(1, log));
    vi.advanceTimersByTime(100);
    const r2 = queue.run(makeTask(2, log));
    vi.advanceTimersByTime(300);
    const r3 = queue.run(makeTask(3, log));
    vi.advanceTimersByTime(300);

    await vi.runAllTimersAsync();
    await vi.runAllTicks();
    expect(await r1).toBeUndefined();
    expect(await r2).toBe(2);
    expect(await r3).toBe(3);
    expect(await queue.result).toBe(3);
    expect(log).toEqual([2, 3]);
  });

  it("throttle leading + trailing: вызывает дважды на интервал", async () => {
    const log: number[] = [];
    const queue = new LastWinsAndCancelsPrevious<number>({ throttleMs: 300, leading: true, trailing: true });

    const r1 = queue.run(makeTask(1, log));
    vi.advanceTimersByTime(100);
    const r2 = queue.run(makeTask(2, log));
    vi.advanceTimersByTime(200);
    const r3 = queue.run(makeTask(3, log));
    vi.advanceTimersByTime(400);
    const r4 = queue.run(makeTask(4, log));
    vi.advanceTimersByTime(400);  

    await vi.runAllTimersAsync();
    await vi.runAllTicks();
    expect(await r1).toBe(1);
    expect(await r2).toBe(2);
    expect(await r3).toBeUndefined();
    expect(await r4).toBe(4);
    expect(await queue.result).toBe(4);
    expect(log).toEqual([1, 2, 4]);
  });

  it("throttle leading=false, trailing=false: ничего не вызывает", async () => {
    const log: number[] = [];
    const queue = new LastWinsAndCancelsPrevious<number>({ throttleMs: 300, leading: false, trailing: false });

    const r = await queue.run(makeTask(1, log));
    await vi.runAllTimersAsync();
    await vi.runAllTicks();
    expect(r).toBeUndefined();
    expect(log).toEqual([]);
  });
});
