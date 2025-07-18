import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  LastWinsAndCancelsPrevious,
  TaskAbortedError,
  TaskIgnoredError,
} from "../src/index";

import { wait } from './utils';

describe("LastWinsAndCancelsPrevious — debounce", () => {
  

  // Один вызов run — задача выполняется с задержкой debounce
  it("Одиночный run с debounce — задача стартует с задержкой", async () => {
    const queue = new LastWinsAndCancelsPrevious(
      async (_signal, x: number) => x * 2,
      { debounceMs: 50 }
    );
    const promise = queue.run(5);
    await wait(49);
    // Пока не стартовала
    expect(queue.currentSeriesResult).toBeUndefined();
    await wait(1);
    const result = await promise;
    expect(result).toBe(10);
  });

  // Несколько run подряд в пределах debounce-интервала — выполняется только последняя
  it("Несколько run подряд — выполняется только последняя", async () => {
    const queue = new LastWinsAndCancelsPrevious(
      async (_signal, x: number) => x,
      { debounceMs: 100 }
    );
    expect(queue.currentSeriesResult).toBeUndefined();
    const p1 = queue.run(1).catch(err => expect(err).toBeInstanceOf(TaskIgnoredError));
    expect(queue.currentSeriesResult).toBeUndefined();
    await wait(50);
    expect(queue.currentSeriesResult).toBeUndefined();
    const p2 = queue.run(2).catch(err => expect(err).toBeInstanceOf(TaskIgnoredError));
    expect(queue.currentSeriesResult).toBeUndefined();
    await wait(50);
    expect(queue.currentSeriesResult).toBeUndefined();
    const p3 = queue.run(3);
    expect(queue.currentSeriesResult).toBeUndefined();
    // Всё ещё не стартовало
    await wait(99);
    expect(queue.currentSeriesResult).toBeUndefined();
    await wait(10);
    await expect(p3).resolves.toBe(3);
  });

  // run → пауза больше debounce → run — обе задачи выполняются
  it("run, пауза больше debounce, снова run — обе задачи выполняются", async () => {
    const queue = new LastWinsAndCancelsPrevious(
      async (_signal, x: number) => x,
      { debounceMs: 30 }
    );
    expect(queue.currentSeriesResult).toBeUndefined();
    const p1 = queue.run(10);
    expect(queue.currentSeriesResult).toBeUndefined();
    const nextSeriesResult = queue.nextSeriesResult;
    await wait(31);
    await expect(nextSeriesResult).resolves.toBe(10);
    const r1 = await p1;
    expect(r1).toBe(10);
    expect(queue.currentSeriesResult).toBeUndefined();
    const p2 = queue.run(20);
    expect(queue.currentSeriesResult).toBeUndefined();
    const nextSeriesResult2 = queue.nextSeriesResult;
    await wait(31);
    await expect(nextSeriesResult2).resolves.toBe(20);
    const r2 = await p2;
    expect(r2).toBe(20);
    expect(queue.currentSeriesResult).toBeUndefined();
  });

  // run, затем abort до истечения debounce — задача не стартует
  it("run, затем abort до debounce — задача не стартует, TaskAbortedError", async () => {
    const queue = new LastWinsAndCancelsPrevious(
      async (_signal, x: number) => x,
      { debounceMs: 100 }
    );
    const p = queue.run(1).catch(err => expect(err).toBeInstanceOf(TaskAbortedError));
    await wait(50);
    queue.abort();
    await wait(100);
    expect(queue.currentSeriesResult).toBeUndefined();
  });

  // run, затем run вне debounce-интервала — оба раза задача выполняется
  it("run, затем run вне debounce — оба промиса резолвятся", async () => {
    const queue = new LastWinsAndCancelsPrevious(
      async (_signal, x: number) => x,
      { debounceMs: 20 }
    );
    const p1 = queue.run(111);
    await wait(21);
    const r1 = await p1;
    const p2 = queue.run(222);
    await wait(21);
    const r2 = await p2;
    expect(r1).toBe(111);
    expect(r2).toBe(222);
  });

  // Проверка хуков: onTaskStarted только для реально стартовавшей, onTaskIgnored для проигнорированных
  it("Проверка хуков с debounce", async () => {
    let started = 0,
      ignored = 0;
    const queue = new LastWinsAndCancelsPrevious(
      async (_signal, x: number) => x,
      { debounceMs: 40 }
    );
    queue.onTaskStarted(() => {
      started++;
    });
    queue.onTaskIgnored(() => {
      ignored++;
    });
    const p1 = queue.run(1).catch(err => expect(err).toBeInstanceOf(TaskIgnoredError));
    const p2 = queue.run(2).catch(err => expect(err).toBeInstanceOf(TaskIgnoredError));
    const p3 = queue.run(3);
    await wait(41);
    await expect(p3).resolves.toBe(3);
    expect(started).toBe(1);
    expect(ignored).toBeGreaterThanOrEqual(2);
  });

  // Проверка передачи аргументов: только последний run доходит до задачи
  it("debounce: только последний run доходит до задачи", async () => {
    let calledWith: number[] = [];
    const queue = new LastWinsAndCancelsPrevious(
      async (_signal, x: number) => {
        calledWith.push(x);
        return x;
      },
      { debounceMs: 25 }
    );
    queue.run(100).catch(err => expect(err).toBeInstanceOf(TaskIgnoredError));
    queue.run(200).catch(err => expect(err).toBeInstanceOf(TaskIgnoredError));
    queue.run(300);
    await wait(30);
    expect(calledWith).toEqual([300]);
  });
});
