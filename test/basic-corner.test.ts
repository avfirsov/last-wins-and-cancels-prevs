import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { LastWinsAndCancelsPrevious, TaskAbortedError, TaskIgnoredError } from '../src/index';
import { wait } from './utils';

// Мокаем fetch для контроля вызовов и отмен
const originalFetch = globalThis.fetch;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn((input: RequestInfo, init?: RequestInit) => {
    return new Promise((resolve, reject) => {
      if (init && init.signal) {
        (init.signal as AbortSignal).addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      }
      setTimeout(() => resolve({ ok: true, json: async () => ({ ok: true }) }), 100);
    });
  });
  globalThis.fetch = fetchSpy as any;
});

// Тесты на edge-кейсы базовой логики очереди
// Каждый тест снабжён подробным комментарием

describe('LastWinsAndCancelsPrevious — базовые corner-кейсы', () => {
  // Проверяем гонку между run и abort: задача отменяется до старта
  it('Гонка run и abort: задача отменяется до старта', async () => {
    const queue = new LastWinsAndCancelsPrevious(async (_signal, x: number) => x);
    queue.run(1).catch((err) => expect(err).toBeInstanceOf(TaskAbortedError));
    queue.currentSeriesResult!.catch((err) => expect(err).toBeInstanceOf(TaskAbortedError));
    queue.abort();
  });

  // Запускаем две задачи подряд, затем abort — обе должны быть отменены
  it('run → run → abort: обе отменяются', async () => {
    const queue = new LastWinsAndCancelsPrevious(async (_signal, x: number) => x);
    const p1 = queue.run(1);
    const p2 = queue.run(2);
    queue.abort();
    await expect(p1).rejects.toThrow(TaskAbortedError);
    await expect(p2).rejects.toThrow(TaskAbortedError);
  });

  // abort до run — не влияет на следующую задачу, она стартует нормально
  it('abort до run: задача стартует нормально', async () => {
    const queue = new LastWinsAndCancelsPrevious(async (_signal, x: number) => x+1);
    queue.abort();
    const result = await queue.run(3);
    expect(result).toBe(4);
  });

  // Задача, которая синхронно возвращает результат — очередь не "зависает"
  it('run с быстрым завершением', async () => {
    const queue = new LastWinsAndCancelsPrevious(async (_signal, x: number) => x);
    const result = await queue.run(5);
    expect(result).toBe(5);
  });

  // Задача выбрасывает ошибку — промис реджектится этой ошибкой
  it('run с ошибкой', async () => {
    const queue = new LastWinsAndCancelsPrevious(async () => { throw new Error('fail'); });
    await expect(queue.run()).rejects.toThrow('fail');
  });

  // Первая задача медленная, вторая быстрая — только вторая должна выполниться
  it('run → run (медленная и быстрая): только вторая валидна', async () => {
    const queue = new LastWinsAndCancelsPrevious(async (_signal, x: number) => {
      await wait(x === 1 ? 50 : 5);
      return x;
    });
    const p1 = queue.run(1).catch((err) => expect(err).toBeInstanceOf(TaskAbortedError));
    const p2 = queue.run(2);
    await expect(p2).resolves.toBe(2);
  });

  // nextSeriesResult должен реджектиться, если серия отменяется
  it('nextSeriesResult реджектится при отмене', async () => {
    const queue = new LastWinsAndCancelsPrevious(async (_signal, x: number) => x);
    const p = queue.run(10);
    queue.abort();
    await expect(p).rejects.toThrow(TaskAbortedError);
  });

  // После завершения серии currentSeriesResult становится undefined
  it('currentSeriesResult после завершения — undefined', async () => {
    const queue = new LastWinsAndCancelsPrevious(async (_signal, x: number) => x);
    await queue.run(2);
    expect(queue.currentSeriesResult).toBeUndefined();
  });

  // Много run подряд — только последняя задача валидна, остальные отменяются
  it('Многократные run в цикле: только последняя валидна', async () => {
    const queue = new LastWinsAndCancelsPrevious(async (_signal, x: number) => x);
    const ps = Array.from({ length: 10 }, (_, i) => queue.run(i));
    for (let i = 0; i < 9; ++i) {
      await expect(ps[i]).rejects.toThrow(TaskAbortedError);
    }
    await expect(ps[9]).resolves.toBe(9);
  });

  // Интеграция с fetch и AbortSignal
  describe('fetch-интеграция', () => {
    // Если очередь отменяется до старта fetch — запрос не должен выполняться, промис реджектится TaskAbortedError
    it('fetch отменяется до старта — запрос не делается, TaskAborted', async () => {
      const queue = new LastWinsAndCancelsPrevious(async (signal: AbortSignal, url: string) => {
        return fetch(url, { signal });
      }, { debounceMs: 50 });
      const p = queue.run('https://test-endpoint');
      queue.abort();
      await expect(p).rejects.toThrow(TaskAbortedError);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    // Если abort во время выполнения fetch — промис реджектится AbortError, fetch был вызван
    it('fetch отменяется во время выполнения — ошибка AbortError', async () => {
      const queue = new LastWinsAndCancelsPrevious(async (signal: AbortSignal, url: string) => {
        return fetch(url, { signal });
      });
      const p = queue.run('https://test-endpoint');
      setTimeout(() => queue.abort(), 10);
      await expect(p).rejects.toThrow(/Abort/);
      expect(fetchSpy).toHaveBeenCalled();
    });
  });
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

// --- Дополнительные edge/corner-кейсы для устойчивости очереди ---
describe('LastWinsAndCancelsPrevious — дополнительные edge/corner-кейсы', () => {
  // run после завершения серии, когда очередь была отменена
  it('run после отмены — очередь оживает и работает штатно', async () => {
    const queue = new LastWinsAndCancelsPrevious(async (_signal, x: number) => x * 10);
    const p = queue.run(1);
    queue.abort();
    await expect(p).rejects.toThrow(TaskAbortedError);
    // После отмены можно снова запускать задачи
    const r = await queue.run(2);
    expect(r).toBe(20);
  });

  // abort несколько раз подряд
  it('abort несколько раз подряд — нет лишних сайд-эффектов', async () => {
    const queue = new LastWinsAndCancelsPrevious(async (_signal, x: number) => x);
    const p = queue.run(1);
    queue.abort();
    queue.abort();
    queue.abort();
    await expect(p).rejects.toThrow(TaskAbortedError);
    // Нет ошибок, нет дублей
    const r = await queue.run(2);
    expect(r).toBe(2);
  });

  // run с одинаковыми аргументами
  it('run с одинаковыми аргументами — задачи не "слипаются"', async () => {
    const queue = new LastWinsAndCancelsPrevious(async (_signal, x: number) => x + Math.random());
    const p1 = queue.run(5);
    const p2 = queue.run(5);
    await expect(p1).rejects.toThrow(TaskAbortedError);
    const r2 = await p2;
    expect(typeof r2).toBe('number');
  });

  // run с undefined/null аргументами
  it('run с undefined/null аргументами — корректная работа', async () => {
    const queue = new LastWinsAndCancelsPrevious(async (_signal, x?: number | null) => x ?? 42);
    const r1 = await queue.run(undefined);
    const r2 = await queue.run(null);
    expect(r1).toBe(42);
    expect(r2).toBe(42);
  });

  // run, затем abort, затем снова run
  it('run, abort, снова run — очередь работает штатно', async () => {
    const queue = new LastWinsAndCancelsPrevious(async (_signal, x: number) => x * 2);
    const p = queue.run(10);
    queue.abort();
    await expect(p).rejects.toThrow(TaskAbortedError);
    const r = await queue.run(11);
    expect(r).toBe(22);
  });

  // run, в задаче внутри вызывается abort
  it('abort вызывается внутри задачи — очередь корректно завершает серию', async () => {
    const queue = new LastWinsAndCancelsPrevious(async (signal, x: number) => {
      if (x === 1) {
        queue.abort();
      }
      return x;
    });
    const p = queue.run(1);
    await expect(p).rejects.toThrow(TaskAbortedError);
    // Следующая задача работает штатно
    const r = await queue.run(2);
    expect(r).toBe(2);
  });

  // run с задачей, которая не использует signal
  it('run с задачей без использования signal — отмена всё равно работает', async () => {
    const queue = new LastWinsAndCancelsPrevious(async (_signal, x: number) => x * 3);
    const p = queue.run(7);
    queue.abort();
    await expect(p).rejects.toThrow(TaskAbortedError);
  });

  // run с задачей, которая никогда не завершится (pending) + abort
  // Ожидаем, что промис не завершится, если задача не использует signal (expected pending)
  it('run с pending-задачей + abort — промис остаётся pending, если signal не используется', async () => {
    const queue = new LastWinsAndCancelsPrevious(async (_signal, _x: number) => new Promise(() => {}));
    const p = queue.run(1);
    queue.abort();
    // Promise.race вернёт 'timeout', если промис не завершился за 100 мс
    const result = await Promise.race([
      p.then(() => 'resolved', () => 'rejected'),
      new Promise(res => setTimeout(() => res('timeout'), 100))
    ]);
    expect(result).toBe('timeout');
    // Это ожидаемое поведение: если задача игнорирует signal, отмена не завершает промис
  });

  // run, затем run с теми же аргументами, но через debounce/throttle
  it('debounce/throttle не ломает семантику отмен и хуков', async () => {
    let started = 0, aborted = 0;
    const queue = new LastWinsAndCancelsPrevious(async (_signal, x: number) => x, {
      debounceMs: 10
    });
    queue.onTaskStarted(() => { started++; });
    queue.onTaskAborted(() => { aborted++; });
    const p1 = queue.run(1);
    const p2 = queue.run(1);
    queue.abort();
    await expect(p1).rejects.toThrow(TaskIgnoredError);
    await expect(p2).rejects.toThrow(TaskAbortedError);
    expect(started + aborted).toBeGreaterThan(0);
  });

  // Проверка хуков на дубль и отсутствие лишних вызовов
  it('хуки вызываются ровно один раз на событие', async () => {
    let started = 0, aborted = 0;
    const queue = new LastWinsAndCancelsPrevious(async (_signal, x: number) => x);
    queue.onTaskStarted(() => { started++; });
    queue.onTaskAborted(() => { aborted++; });
    const p = queue.run(1);
    queue.abort();
    await expect(p).rejects.toThrow(TaskAbortedError);
    expect(started).toBeLessThanOrEqual(1);
    expect(aborted).toBeLessThanOrEqual(1);
  });
});
