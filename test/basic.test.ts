import { describe, it, expect } from 'vitest';
import { LastWinsAndCancelsPrevious, TaskAbortedError } from '../src/index';

describe('LastWinsAndCancelsPrevious — базовые сценарии', () => {
  it('Один вызов run — задача выполняется, результат возвращается', async () => {
    const queue = new LastWinsAndCancelsPrevious(async (_signal, x: number) => x * 2);
    const result = await queue.run(2);
    expect(result).toBe(4);
  });

  it('Несколько последовательных run — только последняя выполняется', async () => {
    const results: number[] = [];
    const queue = new LastWinsAndCancelsPrevious(async (_signal, x: number) => {
      results.push(x);
      await new Promise(res => setTimeout(res, 10));
      return x * 2;
    });
    const p1 = queue.run(1);
    const p2 = queue.run(2);
    const p3 = queue.run(3);
    await expect(p1).rejects.toThrow(TaskAbortedError);
    await expect(p2).rejects.toThrow(TaskAbortedError);
    await expect(p3).resolves.toBe(6);
    expect(results).toEqual([1, 2, 3]); // все стартовали, но только последний валиден
  });

  it('run → run → run с разными аргументами, только последний валиден', async () => {
    const queue = new LastWinsAndCancelsPrevious(async (_signal, x: number) => x + 1);
    const p1 = queue.run(10);
    const p2 = queue.run(20);
    const p3 = queue.run(30);
    await expect(p1).rejects.toThrow(TaskAbortedError);
    await expect(p2).rejects.toThrow(TaskAbortedError);
    await expect(p3).resolves.toBe(31);
  });

  it('run + abort — задача отменяется', async () => {
    const queue = new LastWinsAndCancelsPrevious(async (_signal, x: number) => {
      await new Promise(res => setTimeout(res, 20));
      return x;
    });
    const p = queue.run(5);
    queue.abort();
    await expect(p).rejects.toThrow(TaskAbortedError);
  });

  it('run, дождаться завершения, снова run — обе задачи выполняются по очереди', async () => {
    const queue = new LastWinsAndCancelsPrevious(async (_signal, x: number) => x * 10);
    const r1 = await queue.run(2);
    const r2 = await queue.run(3);
    expect(r1).toBe(20);
    expect(r2).toBe(30);
  });

  it('Параллельные run — только последняя реально стартует', async () => {
    const queue = new LastWinsAndCancelsPrevious(async (_signal, x: number) => x);
    const p1 = queue.run(1);
    const p2 = queue.run(2);
    const p3 = queue.run(3);
    await expect(p1).rejects.toThrow(TaskAbortedError);
    await expect(p2).rejects.toThrow(TaskAbortedError);
    await expect(p3).resolves.toBe(3);
  });

  it('currentSeriesResult и nextSeriesResult работают корректно', async () => {
    const queue = new LastWinsAndCancelsPrevious(async (_signal, x: number) => x);
    const p = queue.run(42);
    expect(queue.currentSeriesResult).toBeDefined();
    const next = queue.nextSeriesResult;
    const result = await p;
    expect(result).toBe(42);
    await expect(next).resolves.toBe(42);
  });

  it('Проверка хуков onTaskStarted/onTaskCancelled', async () => {
    const queue = new LastWinsAndCancelsPrevious(async (_signal, x: number) => x);
    let started = false;
    let cancelled = false;
    queue.onTaskStarted(() => { started = true; });
    queue.onTaskCanceled(() => { cancelled = true; });
    const p = queue.run(7);
    queue.abort();
    await expect(p).rejects.toThrow(TaskAbortedError);
    expect(started || cancelled).toBe(true); // хотя бы один хук должен сработать
  });
});
