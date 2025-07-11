import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  LastWinsAndCancelsPrevious,
  TaskCanceledError,
  TaskIgnoredError,
} from "../src/index";

import { wait } from './utils';

describe("LastWinsAndCancelsPrevious — debounce (corner-cases)", () => {
  

  // 1. run → abort → run (всё в пределах debounce)
  it("run → abort → run: первая отменена, вторая выполняется", async () => {
    const queue = new LastWinsAndCancelsPrevious(async (_signal, x: number) => x, { debounceMs: 30 });
    const p1 = queue.run(1);
    await wait(10);
    queue.abort();
    await wait(10);
    const p2 = queue.run(2);
    await wait(31);
    await expect(p1).rejects.toThrow(TaskCanceledError);
    await expect(p2).resolves.toBe(2);
  });

  // 2. run → run → abort (всё в пределах debounce)
  it("run → run → abort: обе отменены, ни одна не стартует", async () => {
    const queue = new LastWinsAndCancelsPrevious(async (_signal, x: number) => x, { debounceMs: 50 });
    const p1 = queue.run(1);
    await wait(10);
    const p2 = queue.run(2);
    await wait(10);
    queue.abort();
    await wait(51);
    await expect(p1).rejects.toThrow(TaskCanceledError);
    await expect(p2).rejects.toThrow(TaskCanceledError);
  });

  // 3. run → run (разные аргументы) → пауза > debounce → run
  it("run → run → пауза → run: только последний выполняется", async () => {
    const queue = new LastWinsAndCancelsPrevious(async (_signal, x: number) => x, { debounceMs: 20 });
    const p1 = queue.run(1);
    const p2 = queue.run(2);
    await wait(21);
    await expect(p1).rejects.toThrow(TaskIgnoredError);
    await expect(p2).resolves.toBe(2);
    const p3 = queue.run(3);
    await wait(21);
    await expect(p3).resolves.toBe(3);
  });

  // 4. run → run → abort → run
  it("run → run → abort → run: первые две отменены, третий стартует", async () => {
    const queue = new LastWinsAndCancelsPrevious(async (_signal, x: number) => x, { debounceMs: 40 });
    const p1 = queue.run(1);
    const p2 = queue.run(2);
    await wait(10);
    queue.abort();
    await wait(10);
    const p3 = queue.run(3);
    await wait(41);
    await expect(p1).rejects.toThrow(TaskCanceledError);
    await expect(p2).rejects.toThrow(TaskCanceledError);
    await expect(p3).resolves.toBe(3);
  });

  // 5. run → run (разные аргументы) → run (тот же аргумент)
  it("run → run → run (одинаковый аргумент): только последний выполняется", async () => {
    const queue = new LastWinsAndCancelsPrevious(async (_signal, x: number) => x, { debounceMs: 25 });
    const p1 = queue.run(1);
    const p2 = queue.run(2);
    const p3 = queue.run(2);
    await wait(26);
    await expect(p1).rejects.toThrow(TaskIgnoredError);
    await expect(p2).rejects.toThrow(TaskIgnoredError);
    await expect(p3).resolves.toBe(2);
  });

  // 6. run, затем быстро run, затем быстро abort
  it("run → run → abort быстро: ни одна задача не стартует", async () => {
    const queue = new LastWinsAndCancelsPrevious(async (_signal, x: number) => x, { debounceMs: 100 });
    const p1 = queue.run(10);
    const p2 = queue.run(20);
    queue.abort();
    await wait(110);
    await expect(p1).rejects.toThrow(TaskCanceledError);
    await expect(p2).rejects.toThrow(TaskCanceledError);
  });

  // 7. run, затем run, затем второй run стартует (таймер истёк), затем abort
  it("run → run (стартовала) → abort: отменяет только вторую", async () => {
    const queue = new LastWinsAndCancelsPrevious(async (_signal, x: number) => x, { debounceMs: 15 });
    const p1 = queue.run(1);
    const p2 = queue.run(2);
    await wait(16);
    await expect(p1).rejects.toThrow(TaskIgnoredError);
    // Вторая задача стартовала, теперь abort
    queue.abort();
    await expect(p2).resolves.toBe(2);
  });

  // 8. Проверка хуков на edge-кейсах
  it("debounce: хуки не дублируются на corner-кейсах", async () => {
    let started = 0, ignored = 0, aborted = 0;
    const queue = new LastWinsAndCancelsPrevious(async (_signal, x: number) => x, { debounceMs: 30 });
    queue.onTaskStarted(() => { started++; });
    queue.onTaskIgnored(() => { ignored++; });
    queue.onTaskAborted(() => { aborted++; });
    const p1 = queue.run(1);
    const p2 = queue.run(2);
    queue.abort();
    await wait(31);
    await expect(p1).rejects.toThrow(TaskCanceledError);
    await expect(p2).rejects.toThrow(TaskCanceledError);
    expect(started).toBe(0);
    expect(ignored).toBe(0);
    expect(aborted).toBe(2);
  });

  // 9. Проверка передачи аргументов во всех сценариях
  it("debounce: аргументы всегда актуальны для последнего run", async () => {
    let lastArg = 0;
    const queue = new LastWinsAndCancelsPrevious(async (_signal, x: number) => { lastArg = x; return x; }, { debounceMs: 20 });
    queue.run(10);
    queue.run(20);
    queue.run(30);
    await wait(21);
    expect(lastArg).toBe(30);
  });
});
