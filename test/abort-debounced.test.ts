import { describe, it, expect } from "vitest";
import { LastWinsAndCancelsPrevious, TaskAbortedError } from "../src";
import { makeTask, wait } from "./utils";
import { resolvablePromiseFromOutside } from "../src/utils";

/**
 * Тесты на корректную отмену отложенных задач методом abort
 */
describe("LastWinsAndCancelsPrevious.abort отменяет и отложенные задачи (debounce/throttle)", () => {  
  it("debounce: abort отменяет отложенную задачу и возвращает undefined", async () => {
    const queue = new LastWinsAndCancelsPrevious<
      number,
      [number, number[], number?]
    >(makeTask, { debounceMs: 100 });
    const log: number[] = [];
    expect(queue.currentSeriesResult).toBeUndefined();
    const r1 = queue.run(1, log, 50);
    const r2 = queue.run(2, log, 50); // будет отложена
    expect(queue.currentSeriesResult).toBeUndefined();
    // Не дожидаемся выполнения, сразу abort
    queue.abort();
    await expect(r2).rejects.toThrow(TaskAbortedError);
    expect(queue.currentSeriesResult).toBeUndefined();
    expect(log).toEqual([]); // ни одна задача не стартовала
  });

  it("throttle: abort отменяет отложенную задачу и возвращает undefined", async () => {
    const queue = new LastWinsAndCancelsPrevious<number, [number, number[], number?]>(makeTask, {
      throttleMs: 100,
      edge: "trailing",
    });
    const log: number[] = [];
    queue.run(1, log, 50); // первая — стартует сразу
    const r2 = queue.run(2, log, 50); // будет отложена (trailing)
    queue.abort();
    expect(await r2).toBeUndefined();
    expect(queue.currentSeriesResult).toBeUndefined();
    expect(log.length).toBe(1); // только первая задача стартовала
  });

  it("debounce: abort после старта задачи — результат корректен", async () => {
    const queue = new LastWinsAndCancelsPrevious<number, [number, number[], number?]>(makeTask, { debounceMs: 50 });
    const log: number[] = [];
    const r1 = queue.run(1, log, 10);
    await wait(60); // ждём, чтобы задача стартовала
    queue.abort();
    expect(await r1).toBe(1); // задача уже стартовала, abort не влияет
    expect(queue.currentSeriesResult).toBeUndefined();
    expect(log).toEqual([1]);
  });
});
