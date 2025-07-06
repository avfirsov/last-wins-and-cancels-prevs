import { describe, it, expect } from "vitest";
import { LastWinsAndCancelsPrevious } from "../src";
import { makeTask, wait } from "./utils";

/**
 *
 * Больше тестов что queue.result сетиться только КОГДА запуститься task, иначе - undefined (особенно касается когда debounce/throttle с trailing без leading)
 * Также проверить что после завершения окна сетиться обратно в undefined для разных сочетаний trailing/leading/both
 * Также сделать тесты на кейс когда вызов run() откладывается (trailing debounce/throttle) и он должен НЕ сразу вернуть undefined, а только когда станет ясно что эту таску не вызовут, ну или наоборот - если вызовут - то вернуть значение
 */

describe("LastWinsAndCancelsPrevious", () => {
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
    await wait(100);
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
    const task1 = queue.run(
      () =>
        new Promise<number>((_, rej) => {
          reject1 = rej;
        })
    );
    const resultPromise = queue.result;
    const task2 = queue.run(
      () =>
        new Promise<number>((res) => {
          resolve2 = res;
        })
    );
    reject1!(error1); // First task fails immediately
    resolve2!(42); // Second completes after
    expect(await task2).toBe(42);
    expect(await resultPromise).toBe(42);
    await expect(task1).rejects.toThrow("fail1");
  });

  it("first task fails AFTER second completes — result = task2, task1 rejects", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    let reject1: (e: any) => void, resolve2: (v: number) => void;
    const error1 = new Error("fail1");
    const task1 = queue.run(
      () =>
        new Promise<number>((_, rej) => {
          reject1 = rej;
        })
    );
    const resultPromise = queue.result;
    const task2 = queue.run(
      () =>
        new Promise<number>((res) => {
          resolve2 = res;
        })
    );
    resolve2!(42); // Second completes first
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
    task1
      .then((v) => console.log("🚀 ~ it ~ v:", v))
      .catch((e) => console.log("🚀 ~ it ~ e:", e));
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
    const task1 = queue.run(
      () =>
        new Promise<number>((res) => {
          resolve1 = res;
        })
    );
    const resultPromise = queue.result;
    const task2 = queue.run(
      () =>
        new Promise<number>((_, rej) => {
          rej(error2);
        })
    );
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
    const task1 = queue.run(
      () =>
        new Promise<number>((res) => {
          resolve1 = res;
        })
    );
    const resultPromise = queue.result;
    const task2 = queue.run(
      () =>
        new Promise<number>((_, rej) => {
          reject2 = rej;
        })
    );
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
    const task1 = queue.run(
      () =>
        new Promise<number>((_, rej) => {
          reject1 = rej;
        })
    );
    const resultPromise = queue.result;
    const task2 = queue.run(
      () =>
        new Promise<number>((_, rej) => {
          reject2 = rej;
        })
    );
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
    const task1 = queue.run(
      () =>
        new Promise<number>((_, rej) => {
          reject1 = rej;
        })
    );
    const resultPromise = queue.result;
    const task2 = queue.run(
      () =>
        new Promise<number>((_, rej) => {
          reject2 = rej;
        })
    );
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

// --- Result consistency tests ---
describe("result consistency", () => {
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
});
