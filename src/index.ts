type Edge = 'leading' | 'trailing' | 'both';

export interface LastWinsAndCancelsPreviousOptions {
  debounceMs?: number;
  throttleMs?: number;
  edge?: Edge;
}

export class LastWinsAndCancelsPrevious<R = unknown> {
  private controller?: AbortController;
  /**
   * Promise с результатом последней неотменённой задачи.
   * Если последняя задача была отменена, возвращает undefined.
   */
  private resultPromise!: Promise<R | undefined>;
  /**
   * Функция для резолвинга resultPromise.
   * Используется внутри run для резолвинга результата последней задачи.
   */
  private resultPromiseResolve?: (value: R | undefined) => void;
  /**
   * Функция для резолвинга resultPromise.
   * Используется внутри run для резолвинга результата последней задачи.
   */
  private resultPromiseReject?: (reason?: any) => void;

  constructor() {
    this.resetResultPromise();
  }

  private resetResultPromise() {
    this.resultPromise = new Promise<R | undefined>((resolve, reject) => {
      this.resultPromiseResolve = resolve;
      this.resultPromiseReject = reject;
    });
  }

  /**
   * Запускает новую задачу, отменяя предыдущую (last-wins/cancel).
   * - run всегда возвращает результат именно этой задачи, даже если она была отменена.
   * - result (геттер) резолвится только с результатом последней неотменённой задачи.
   * @param task Асинхронная функция с поддержкой AbortSignal
   * @returns Promise с результатом задачи
   */
  public run<T extends R>(task: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
    // 1. Отмена предыдущей задачи, если она была запущена
    if (this.controller) this.controller.abort();
    // 2. Новый AbortController для новой задачи
    this.controller = new AbortController();
    // 3. Сброс внутреннего промиса результата (result), чтобы он отражал только последнюю задачу
    this.resetResultPromise();

    const signal = this.controller.signal;
    // 4. Запуск пользовательской задачи с поддержкой отмены
    const taskPromise = task(signal)
      .then((result) => {
        // Если задача не была отменена — резолвим геттер result
        if (!signal.aborted) this.resultPromiseResolve?.(result);
        // run всегда возвращает результат задачи, даже если она была отменена
        return result;
      })
      .catch((err) => {
        // Если задача не была отменена — пробрасываем ошибку в геттер result
        if (!signal.aborted) this.resultPromiseReject?.(err);
        if (!signal.aborted) throw err;
        // Если ошибка из-за отмены — подавляем, возвращаем undefined
        return undefined;
      });
    return taskPromise;
  }
  /**
   * Геттер, возвращающий Promise с результатом последней неотменённой задачи.
   * Если последняя задача была отменена, возвращает undefined.
   */
  public get result(): Promise<R | undefined> {
    return this.resultPromise;
  }
}
