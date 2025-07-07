import { describe, expect, it } from "vitest";
import { makeTask, wait } from "./utils";
import { LastWinsAndCancelsPrevious } from "../src";

describe("LastWinsAndCancelsPrevious — debounce behavior", () => {
  it("result does not resolve until the last run is executed (debounce trailing)", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>({ debounceMs: 300 });
    let resolveLast: (v: number) => void;
    let resultResolved = false;
    expect(queue.currentSeriesResult).toBeUndefined();
    queue.run(() => new Promise<number>((r) => {}));
    expect(queue.currentSeriesResult).toBeUndefined();
    queue.run(() => new Promise<number>((r) => {}));
    expect(queue.currentSeriesResult).toBeUndefined();
    const lastPromise = queue.run(
      () =>
        new Promise<number>((r) => {
          resolveLast = r;
        })
    );
    expect(queue.currentSeriesResult).toBeUndefined();
    await wait(400);
    const result = queue.currentSeriesResult;
    expect(result).not.toBeUndefined();
    result!.then(() => {
      resultResolved = true;
    });
    // Пока задача не завершена
    expect(resultResolved).toBe(false);
    // Завершаем задачу
    resolveLast!(42);
    await wait(50);
    expect(resultResolved).toBe(true);
    expect(await result).toBe(42);
    //тот самый случай, когда мы не отследили что таска была отложена и подумали что ее скипнул дебаунс и вернули undefined а он не скипал ее а просто отложил
    expect(await lastPromise).toBe(42);
  });

  it("debounce trailing=true (по умолчанию): вызывает только после паузы", async () => {
    const log: number[] = [];
    const queue = new LastWinsAndCancelsPrevious<number>({ debounceMs: 300 });

    const r1 = queue.run(makeTask(1, log));
    expect(queue.currentSeriesResult).toBeUndefined();
    await wait(100);
    expect(queue.currentSeriesResult).toBeUndefined();
    const r2 = queue.run(makeTask(2, log));
    expect(queue.currentSeriesResult).toBeUndefined();
    await wait(100);
    expect(queue.currentSeriesResult).toBeUndefined();
    const r3 = queue.run(makeTask(3, log, 400));
    expect(queue.currentSeriesResult).toBeUndefined();
    await wait(400);
    const result = queue.currentSeriesResult;
    expect(log).toEqual([3]);
    expect(await result).toBe(3);
    expect(await r1).toBeUndefined();
    // expect(await r2).toBeUndefined();
    // //тот самый случай, когда мы не отследили что таска была отложена и подумали что ее скипнул дебаунс и вернули undefined а он не скипал ее а просто отложил
    // expect(await r3).toBe(3);
    // expect(queue.result).toBeUndefined();
  });

  it("debounce leading=true: вызывает сразу, не в конце", async () => {
    const log: number[] = [];
    const queue = new LastWinsAndCancelsPrevious<number>({
      debounceMs: 300,
      edge: "leading",
    });
    expect(queue.currentSeriesResult).toBeUndefined();
    const r1 = queue.run(makeTask(1, log));
    expect(queue.currentSeriesResult).not.toBeUndefined();
    const result1 = queue.currentSeriesResult;
    await wait(100);
    const r2 = queue.run(makeTask(2, log));
    await wait(1000);
    expect(queue.currentSeriesResult).toBeUndefined();
    const r3 = queue.run(makeTask(3, log));
    const result2 = queue.currentSeriesResult;
    await wait(100);
    await Promise.all([r1, r2, r3]);
    expect(await r1).toBe(1);
    expect(await r2).toBeUndefined();
    expect(await r3).toBe(3);
    expect(log).toEqual([1, 3]);
    expect(await result1).toBe(1);
    expect(queue.currentSeriesResult).toBeUndefined();
    expect(await result2).toBe(3);
  });

  it("debounce leading + trailing: calls twice — at start and end", async () => {
    const log: number[] = [];
    const queue = new LastWinsAndCancelsPrevious<number>({
      debounceMs: 300,
      edge: "both",
    });
    expect(queue.currentSeriesResult).toBeUndefined();
    const r1 = queue.run(makeTask(1, log));
    const result1 = queue.currentSeriesResult;
    expect(result1).not.toBeUndefined();
    await wait(100);
    const r2 = queue.run(makeTask(2, log));
    await wait(200);
    const r3 = queue.run(makeTask(3, log, 400));
    await wait(400);

    const result2 = queue.currentSeriesResult;
    expect(log).toEqual([1, 3]);
    expect(await result1).toBe(1);
    expect(await r1).toBe(1);
    expect(await r2).toBeUndefined();
    expect(await result2).toBe(3);
    expect(queue.currentSeriesResult).toBeUndefined();
    //тот самый случай, когда мы не отследили что таска была отложена и подумали что ее скипнул дебаунс и вернули undefined а он не скипал ее а просто отложил
    expect(await r3).toBe(3);
  });
});
