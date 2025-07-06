import { describe, it, expect } from "vitest";
import { LastWinsAndCancelsPrevious } from "../src";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("LastWinsAndCancelsPrevious — unsubscribe hooks", () => {
  it("onError вызывается при ошибке, даже если задача не выиграла гонку", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    const calls: any[] = [];
    queue.onError((args) => calls.push(args));
    const run1 = queue.run(async () => {
      await wait(100);
      throw new Error("fail");
    });
    const run2 = queue.run(async () => {
      return 1;
    });
    const result = queue.result;
    await expect(run1).rejects.toThrow("fail");
    expect(await run2).toBe(1);
    expect(calls.length).toBe(1);
    expect(await result).toBe(1);
    expect(calls[0]).toMatchObject({
      error: expect.any(Error),
      aborted: false,
    });
  });
  it("onAborted отписка работает", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    const calls: any[] = [];
    const unsub = queue.onAborted((args) => calls.push(args));
    await queue.run(async () => 1);
    queue.run(async () => 2); // вызовет abort
    expect(calls.length).toBe(1);
    unsub();
    queue.run(async () => 3); // abort, но хук уже не должен вызваться
    expect(calls.length).toBe(1);
  });

  it("onError отписка работает", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    const calls: any[] = [];
    const unsub = queue.onError((args) => calls.push(args));
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

  it("onComplete отписка работает", async () => {
    const queue = new LastWinsAndCancelsPrevious<number>();
    const calls: any[] = [];
    const unsub = queue.onComplete((args) => calls.push(args));
    await queue.run(async () => 1);
    expect(calls.length).toBe(1);
    unsub();
    await queue.run(async () => 2);
    expect(calls.length).toBe(1);
  });
});
