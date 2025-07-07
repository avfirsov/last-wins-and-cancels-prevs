import { describe, expect, it } from "vitest";
import { LastWinsAndCancelsPrevious } from "../src";
import { makeTask, wait } from "./utils";

describe("LastWinsAndCancelsPrevious — throttle behavior", () => {
  it("throttle leading=true: calls once per interval", async () => {
    const log: number[] = [];
    const queue = new LastWinsAndCancelsPrevious<number>({
      throttleMs: 300,
      edge: "leading",
    });

    expect(queue.currentSeriesResult).toBeUndefined();
    const r1 = queue.run(makeTask(1, log));
    expect(queue.currentSeriesResult).not.toBeUndefined();
    await wait(100);
    expect(queue.currentSeriesResult).toBeUndefined();
    const r2 = queue.run(makeTask(2, log));
    expect(queue.currentSeriesResult).toBeUndefined();
    await wait(200);
    expect(queue.currentSeriesResult).toBeUndefined();
    await wait(400);
    expect(queue.currentSeriesResult).toBeUndefined();
    const r3 = queue.run(makeTask(3, log, 400));
    const result = queue.currentSeriesResult;
    expect(result).not.toBeUndefined();

    expect(log).toEqual([1, 3]);
    expect(await r1).toBe(1);
    expect(await r2).toBeUndefined();
    expect(await r3).toBe(3);
    expect(await result).toBe(3);
    expect(queue.currentSeriesResult).toBeUndefined();
  });

  it("throttle trailing=true: calls at the end of interval", async () => {
    const log: number[] = [];
    const queue = new LastWinsAndCancelsPrevious<number>({
      throttleMs: 300,
      edge: "trailing",
    });

    expect(queue.currentSeriesResult).toBeUndefined();
    const r1 = queue.run(makeTask(1, log));
    expect(queue.currentSeriesResult).toBeUndefined();
    await wait(100);
    expect(queue.currentSeriesResult).toBeUndefined();
    const r2 = queue.run(makeTask(2, log, 300));
    expect(queue.currentSeriesResult).toBeUndefined();
    await wait(300);
    expect(queue.currentSeriesResult).not.toBeUndefined();
    const r3 = queue.run(makeTask(3, log, 300));
    await wait(300);
    expect(queue.currentSeriesResult).not.toBeUndefined();
    expect(await r1).toBeUndefined();
    //тот самый случай, когда мы не отследили что таска была отложена и подумали что ее скипнул дебаунс и вернули undefined а он не скипал ее а просто отложил
    expect(await r2).toBe(2);
    //тот самый случай, когда мы не отследили что таска была отложена и подумали что ее скипнул дебаунс и вернули undefined а он не скипал ее а просто отложил
    expect(await r3).toBe(3);
    expect(log).toEqual([2, 3]);
    expect(queue.currentSeriesResult).toBeUndefined();
  });

  it("throttle leading + trailing: calls twice per interval", async () => {
    const log: number[] = [];
    const queue = new LastWinsAndCancelsPrevious<number>({
      throttleMs: 300,
      edge: "both",
    });

    expect(queue.currentSeriesResult).toBeUndefined();
    const r1 = queue.run(makeTask(1, log));
    expect(queue.currentSeriesResult).not.toBeUndefined();
    await wait(100);
    expect(queue.currentSeriesResult).toBeUndefined();
    const r2 = queue.run(makeTask(2, log));
    expect(queue.currentSeriesResult).toBeUndefined();
    await wait(300);
    expect(queue.currentSeriesResult).toBeUndefined();
    const r3 = queue.run(makeTask(3, log));
    expect(queue.currentSeriesResult).not.toBeUndefined();
    await wait(400);
    expect(queue.currentSeriesResult).toBeUndefined();
    const r4 = queue.run(makeTask(4, log));
    expect(queue.currentSeriesResult).not.toBeUndefined();
    const result = queue.currentSeriesResult;
    expect(result).not.toBeUndefined();
    await wait(400);

    expect(await result).toBe(4);
    expect(await r1).toBe(1);
    //тот самый случай, когда мы не отследили что таска была отложена и подумали что ее скипнул дебаунс и вернули undefined а он не скипал ее а просто отложил
    expect(await r2).toBe(2);
    expect(await r3).toBe(3);
    expect(await r4).toBe(4);
    expect(await result).toBe(4);
    expect(log).toEqual([1, 2, 3, 4]);
  });

  it("result does not resolve until the last run is executed (throttle leading)", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>({
      throttleMs: 300,
      edge: "leading",
    });
    expect(queue.currentSeriesResult).toBeUndefined();
    let resolve1: (v: number) => void;
    let resolve2: (v: number) => void;
    let resultResolved = false;
    const p1 = queue.run(
      () =>
        new Promise<number>((r) => {
          resolve1 = r;
        })
    );
    const result = queue.currentSeriesResult;
    expect(result).not.toBeUndefined();
    result!.then(() => {
      resultResolved = true;
    });
    await wait(350);
    const p2 = queue.run(
      () =>
        new Promise<number>((r) => {
          resolve2 = r;
        })
    );
    expect(queue.currentSeriesResult).toBe(result);
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
      edge: "trailing",
    });
    expect(queue.currentSeriesResult).toBeUndefined();
    let resolveLast: (v: number) => void;
    let resultResolved = false;
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
    await wait(350);
    const result = queue.currentSeriesResult;
    expect(result).not.toBeUndefined();
    result!.then(() => {
      resultResolved = true;
    });
    expect(resultResolved).toBe(false);
    resolveLast!(99);
    await lastPromise;
    expect(await result).toBe(99);
    expect(resultResolved).toBe(true);
    //тот самый случай, когда мы не отследили что таска была отложена и подумали что ее скипнул дебаунс и вернули undefined а он не скипал ее а просто отложил
    expect(await lastPromise).toBe(99);
  });
});
