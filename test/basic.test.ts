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
    expect(queue.result).toBeUndefined();
    const runResult = queue.run(async () => 42);
    expect(queue.result).not.toBeUndefined();
    const result = queue.result;
    expect(await runResult).toBe(42);
    expect(await result).toBe(42);
  });

  it("отменяет предыдущую задачу при запуске новой", async () => {
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

  it("run возвращает undefined при отмене задачи", async () => {
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

  it("result резолвится только с последней задачей", async () => {
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

  it("старые задачи без AbortSignal завершаются, но не влияют на result", async () => {
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
    expect(await first).toBe(1); // Ожидаем undefined, т.к. задача была отменена
    expect(finished).toBe(true);
  });

  it("ошибка в задаче приводит к reject result", async () => {
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

  it("первая задача падает с ошибкой ДО завершения второй — result = task2, task1 реджект", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    let reject1: (e: any) => void, resolve2: (v: number) => void;
    const error1 = new Error("fail1");
    const task1 = queue.run(() => new Promise<number>((_, rej) => { reject1 = rej; }));
    const resultPromise = queue.result;
    const task2 = queue.run(() => new Promise<number>((res) => { resolve2 = res; }));
    reject1!(error1); // Первая задача падает сразу
    resolve2!(42);    // Вторая завершается после
    expect(await task2).toBe(42);
    expect(await resultPromise).toBe(42);
    await expect(task1).rejects.toThrow("fail1");
  });

  it("первая задача падает с ошибкой ПОСЛЕ завершения второй — result = task2, task1 реджект", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    let reject1: (e: any) => void, resolve2: (v: number) => void;
    const error1 = new Error("fail1");
    const task1 = queue.run(() => new Promise<number>((_, rej) => { reject1 = rej; }));
    const resultPromise = queue.result;
    const task2 = queue.run(() => new Promise<number>((res) => { resolve2 = res; }));
    resolve2!(42);    // Вторая завершается первой
    reject1!(error1); // Первая задача падает после
    expect(await task2).toBe(42);
    expect(await resultPromise).toBe(42);
    await expect(task1).rejects.toThrow("fail1");
  });

  it("если первая задача упала с ошибкой, но была отменена второй — result = task2, task1 реджект", async () => {
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
    // Запускаем вторую задачу, которая успешно завершается
    const task2 = queue.run(async () => 42);
    expect(resultPromise).toBe(queue.result);
    // Первая задача падает с ошибкой, но уже отменена
    task1Reject!(error1);
    expect(queue.result).toBe(resultPromise);
    console.log("🚀 ~ it ~ task1:", task1);
    expect(await task2).toBe(42);
    expect(await resultPromise).toBe(42);
    await expect(task1).rejects.toThrow("fail1");
  });

  it("вторая задача падает с ошибкой ДО завершения первой — result и task2 реджект, task1 success", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    let resolve1: (v: number) => void;
    const error2 = new Error("fail2");
    const task1 = queue.run(() => new Promise<number>((res) => { resolve1 = res; }));
    const resultPromise = queue.result;
    const task2 = queue.run(() => new Promise<number>((_, rej) => { rej(error2); }));
    // Вторая задача падает первой
    await expect(task2).rejects.toThrow("fail2");
    resolve1!(1); // Первая задача завершается после
    expect(await task1).toBe(1);
    await expect(resultPromise).rejects.toThrow("fail2");
  });

  it("вторая задача падает с ошибкой ПОСЛЕ завершения первой — result и task2 реджект, task1 success", async () => {
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

  it("если вторая задача падает с ошибкой — result и task2 реджект, task1 success", async () => {
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

  it("обе задачи падают: первая ДО второй — result и task2 реджект, task1 реджект", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    let reject1: (e: any) => void, reject2: (e: any) => void;
    const error1 = new Error("fail1");
    const error2 = new Error("fail2");
    const task1 = queue.run(() => new Promise<number>((_, rej) => { reject1 = rej; }));
    const resultPromise = queue.result;
    const task2 = queue.run(() => new Promise<number>((_, rej) => { reject2 = rej; }));
    reject1!(error1); // Первая падает первой
    reject2!(error2); // Вторая падает после
    await expect(task1).rejects.toThrow("fail1");
    await expect(task2).rejects.toThrow("fail2");
    await expect(resultPromise).rejects.toThrow("fail2");
  });

  it("обе задачи падают: вторая ДО первой — result и task2 реджект, task1 реджект", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    let reject1: (e: any) => void, reject2: (e: any) => void;
    const error1 = new Error("fail1");
    const error2 = new Error("fail2");
    const task1 = queue.run(() => new Promise<number>((_, rej) => { reject1 = rej; }));
    const resultPromise = queue.result;
    const task2 = queue.run(() => new Promise<number>((_, rej) => { reject2 = rej; }));
    reject2!(error2); // Вторая падает первой
    reject1!(error1); // Первая падает после
    await expect(task1).rejects.toThrow("fail1");
    await expect(task2).rejects.toThrow("fail2");
    await expect(resultPromise).rejects.toThrow("fail2");
  });

  it("если обе задачи упали с ошибкой — result и task2 реджект, task1 реджект", async () => {
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

  it("concurrent: только результат последней задачи попадает в result", async () => {
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

// --- Тесты на корректность резолва result ---
describe("result consistency", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("result не резолвится до завершения последнего run (без debounce/throttle)", async () => {
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
    // Завершаем вторую (последнюю) задачу — теперь result должен резолвиться
    resolve2!(2);
    await resultPromise;
    expect(resultResolved).toBe(true);
    expect(await resultPromise).toBe(2);
  });

  it("result не резолвится до выполнения последнего run (debounce trailing)", async () => {
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
        new Promise<number>((r) => {
          resolveLast = r;
        })
    );
    expect(queue.result).toBe(result);
    vi.advanceTimersByTime(300); // Только теперь дебаунс вызовет задачу
    await Promise.resolve();
    expect(resultResolved).toBe(false);
    resolveLast!(42);
    await lastPromise;
    expect(resultResolved).toBe(true);
    expect(await lastPromise).toBe(42);
    expect(await result).toBe(42);
  });

  it("result не резолвится до выполнения последнего run (throttle leading)", async () => {
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
    // Завершаем первую задачу — result не должен резолвиться, т.к. throttle не разрешил вторую
    resolve1!(1);
    await Promise.resolve();
    expect(resultResolved).toBe(false);
    // Теперь завершаем вторую (которая не должна была быть вызвана)
    resolve2!(2);
    expect(await p1).toBe(1);
    expect(await p2).toBe(2);
    expect(await result).toBe(2);
  });

  it("result не резолвится до выполнения trailing (throttle trailing)", async () => {
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
    expect(queue.result).toBe(result);
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
    vi.advanceTimersByTime(300); // Только теперь throttle вызовет задачу
    await Promise.resolve();
    expect(resultResolved).toBe(false);
    resolveLast!(99);
    await lastPromise;
    expect(resultResolved).toBe(true);
    expect(await lastPromise).toBe(99);
    expect(await result).toBe(99);
  });
});

describe("LastWinsAndCancelsPrevious — debounce/throttle поведение", () => {
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

  it("debounce leading + trailing: вызывает дважды — в начале и в конце", async () => {
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

  it("debounce leading=false, trailing=false: не вызывает ничего", async () => {
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

  it("throttle leading=true: вызывает один раз в интервал", async () => {
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

  it("throttle trailing=true: вызывает в конце интервала", async () => {
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

  it("throttle leading + trailing: вызывает дважды на интервал", async () => {
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

  it("throttle leading=false, trailing=false: ничего не вызывает", async () => {
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
