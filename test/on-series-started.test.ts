import { describe, it, expect } from "vitest";
import { LastWinsAndCancelsPrevious } from "../src";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    const r2 = queue.run(async () => 2); // debounce отменит первый
    await wait(150); // дождаться выполнения дебаунса
    await r2;
    expect(calls.length).toBe(1); // только одна задача реально стартовала
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

  it("отписка работает", async () => {
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
    await queue.run(async () => 1); // первая задача стартует
    await queue.run(async () => 2); // в пределах throttle, не стартует
    await wait(250);
    await queue.run(async () => 3); // после throttle, стартует
    expect(calls.length).toBe(2);
  });
});
