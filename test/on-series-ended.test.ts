import { describe, it, expect } from "vitest";
import { LastWinsAndCancelsPrevious } from "../src";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

  it("отписка работает", async () => {
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
