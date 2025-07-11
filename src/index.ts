import debounce from "lodash.debounce";
import throttle from "lodash.throttle";
import { DebouncedFunc } from "lodash";
import { resolvablePromiseFromOutside } from "./utils";

export type DebounceOptions = {
  debounceMs: number;
  edge?: "leading" | "trailing" | "both";
};

export type ThrottleOptions = {
  throttleMs: number;
  edge?: "leading" | "trailing" | "both";
};

export type LastWinsAndCancelsPreviousOptions =
  | DebounceOptions
  | ThrottleOptions;

export const isDebounceOptions = (
  options: LastWinsAndCancelsPreviousOptions
): options is DebounceOptions => "debounceMs" in options;

export const isThrottleOptions = (
  options: LastWinsAndCancelsPreviousOptions
): options is ThrottleOptions => "throttleMs" in options;

export type TaskFn<R, Args extends any[]> = (
  signal: AbortSignal,
  ...args: Args
) => Promise<R>;

export type OnTaskAbortedHook<Args extends any[]> = (params: {
  signal?: AbortSignal;
  args?: Args;
}) => void;

export type OnSeriesFailedHook<Args extends any[]> = (params: {
  error: any;
  signal: AbortSignal;
  args: Args;
}) => void;

export type OnSeriesSucceededHook<R, Args extends any[]> = (params: {
  result: R;
  signal: AbortSignal;
  args: Args;
}) => void;

export type OnSeriesEndedHook<R, Args extends any[]> = (params: {
  result?: R;
  error?: any;
  aborted: boolean;
  signal: AbortSignal;
  args: Args;
}) => void;

export type OnSeriesStartedHook<Args extends any[]> = (params: {
  signal: AbortSignal;
  args: Args;
}) => void;

export type OnTaskDeferredHook<Args extends any[]> = (params: {
  args: Args;
}) => void;

export type OnTaskIgnoredHook<Args extends any[]> = (params: {
  args: Args;
}) => void;

export type OnAbortedTaskFinishedHook<R, Args extends any[]> = (params: {
  result?: R;
  error?: any;
  signal: AbortSignal;
  args: Args;
}) => void;

export type onTaskStartedHook<Args extends any[]> = (params: {
  signal: AbortSignal;
  args: Args;
}) => void;

type onTaskAbortedInternalHook = () => void;

export type Unsub = () => void;

const startedTaskSymbol = Symbol("startedTask");

export class TaskAbortedError extends Error {
  constructor() {
    super("Aborted");
    this.name = "TaskAbortedError";
  }
}

export class TaskIgnoredError extends Error {
  constructor() {
    super("Task ignored");
    this.name = "TaskIgnoredError";
  }
}

/**
 * Task queue with previous cancellation and event hooks support.
 */
export class LastWinsAndCancelsPrevious<
  R = unknown,
  Args extends any[] = any[]
> {
  private task: TaskFn<R, Args>;
  private leadingTaskController?: AbortController;
  private leadingTaskArgs?: Args;
  private currentSeriesPromise!: Promise<R> | undefined;
  private currentSeriesPromiseResolve?: (value: R) => void;
  private currentSeriesPromiseReject?: (reason?: any) => void;

  private readonly delay: number;
  private edge: "leading" | "trailing" | "both";

  private debouncedOrThrottledRun?: DebouncedFunc<
    (
      args: Args,
      onTaskStarted?: () => void,
      onTaskCompleted?: (result: R) => void,
      onTaskFailed?: (error: any) => void
    ) => Promise<R>
  >;

  // Event hooks
  private onTaskAbortedHooks: OnTaskAbortedHook<Args>[] = [];
  private onSeriesFailedHooks: OnSeriesFailedHook<Args>[] = [];
  private onSeriesSucceededHooks: OnSeriesSucceededHook<R, Args>[] = [];
  private onSeriesStartedHooks: OnSeriesStartedHook<Args>[] = [];
  private onTaskDeferredHooks: OnTaskDeferredHook<Args>[] = [];
  private onTaskIgnoredHooks: OnTaskIgnoredHook<Args>[] = [];
  private onAbortedTaskFinishedHooks: OnAbortedTaskFinishedHook<R, Args>[] = [];
  private onTaskStartedHooks: onTaskStartedHook<Args>[] = [];
  private onTaskAbortedInternalHooks: onTaskAbortedInternalHook[] = [];

  /**
   * Subscribe to abort events (any task, not just result)
   */
  /**
   * Подписка на событие отмены задачи (любая задача, не только последняя).
   * Если подписчик выбрасывает ошибку — очередь ломается (ошибка пробрасывается наружу из run/_run).
   * Порядок вызова: onSeriesStarted → onTaskAborted → onSeriesEnded (если это последняя задача).
   * @param cb Callback
   * @returns Функция отписки
   */
  public onTaskAborted(cb: OnTaskAbortedHook<Args>): Unsub {
    this.onTaskAbortedHooks.push(cb);
    return () => {
      const idx = this.onTaskAbortedHooks.indexOf(cb);
      if (idx !== -1) this.onTaskAbortedHooks.splice(idx, 1);
    };
  }
  /**
   * Subscribe to error events (any task, not just result)
   */
  /**
   * Подписка на событие ошибки задачи (любая задача, не только последняя).
   * Если подписчик выбрасывает ошибку — очередь ломается (ошибка пробрасывается наружу из run/_run).
   * Порядок вызова: onSeriesStarted → onSeriesFailed → onSeriesEnded (если это последняя задача).
   * @param cb Callback
   * @returns Функция отписки
   */
  public onSeriesFailed(cb: OnSeriesFailedHook<Args>): Unsub {
    this.onSeriesFailedHooks.push(cb);
    return () => {
      const idx = this.onSeriesFailedHooks.indexOf(cb);
      if (idx !== -1) this.onSeriesFailedHooks.splice(idx, 1);
    };
  }
  /**
   * Subscribe to completion events (any task, not just result)
   */
  /**
   * Подписка на событие успешного завершения задачи (любая задача, не только последняя).
   * Если подписчик выбрасывает ошибку — очередь ломается (ошибка пробрасывается наружу из run/_run).
   * Порядок вызова: onSeriesStarted → onSeriesSucceeded → onSeriesEnded (если это последняя задача).
   * @param cb Callback
   * @returns Функция отписки
   */
  public onSeriesSucceeded(cb: OnSeriesSucceededHook<R, Args>): Unsub {
    this.onSeriesSucceededHooks.push(cb);
    return () => {
      const idx = this.onSeriesSucceededHooks.indexOf(cb);
      if (idx !== -1) this.onSeriesSucceededHooks.splice(idx, 1);
    };
  }
  /**
   * Subscribe to series start events
   */
  /**
   * Подписка на событие старта новой серии задач.
   * Если подписчик выбрасывает ошибку — очередь ломается (ошибка пробрасывается наружу из run/_run).
   * Порядок вызова: onSeriesStarted всегда вызывается перед запуском задачи.
   * @param cb Callback
   * @returns Функция отписки
   */
  public onSeriesStarted(cb: OnSeriesStartedHook<Args>): Unsub {
    this.onSeriesStartedHooks.push(cb);
    return () => {
      const idx = this.onSeriesStartedHooks.indexOf(cb);
      if (idx !== -1) this.onSeriesStartedHooks.splice(idx, 1);
    };
  }
  /**
   * Subscribe to series end events
   */
  /**
   * Подписка на событие завершения серии задач (последняя запущенная задача завершилась/отменилась/упала).
   * Если подписчик выбрасывает ошибку — очередь ломается (ошибка пробрасывается наружу из run/_run).
   * Порядок вызова: onSeriesStarted → onTaskAborted/onSeriesFailed/onSeriesSucceeded → onSeriesEnded.
   * @param cb Callback
   * @returns Функция отписки
   */
  public onSeriesEnded(cb: OnSeriesEndedHook<R, Args>): Unsub {
    const unsubComplete = this.onSeriesSucceeded((params) => {
      cb({
        result: params.result,
        signal: params.signal,
        aborted: false,
        args: params.args,
      });
    });
    const unsubError = this.onSeriesFailed((params) => {
      cb({
        error: params.error,
        signal: params.signal,
        aborted: false,
        args: params.args,
      });
    });
    const unsubAborted = this.onTaskAborted((params) => {
      if (!params.signal || !params.args) return;
      cb({
        aborted: true,
        signal: params.signal,
        args: params.args,
      });
    });
    return () => {
      unsubComplete();
      unsubError();
      unsubAborted();
    };
  }

  public onTaskDeferred(cb: OnTaskDeferredHook<Args>): Unsub {
    this.onTaskDeferredHooks.push(cb);
    return () => {
      const idx = this.onTaskDeferredHooks.indexOf(cb);
      if (idx !== -1) this.onTaskDeferredHooks.splice(idx, 1);
    };
  }

  public onTaskIgnored(cb: OnTaskIgnoredHook<Args>): Unsub {
    this.onTaskIgnoredHooks.push(cb);
    return () => {
      const idx = this.onTaskIgnoredHooks.indexOf(cb);
      if (idx !== -1) this.onTaskIgnoredHooks.splice(idx, 1);
    };
  }

  public onAbortedTaskFinished(cb: OnAbortedTaskFinishedHook<R, Args>): Unsub {
    this.onAbortedTaskFinishedHooks.push(cb);
    return () => {
      const idx = this.onAbortedTaskFinishedHooks.indexOf(cb);
      if (idx !== -1) this.onAbortedTaskFinishedHooks.splice(idx, 1);
    };
  }

  public onTaskStarted(cb: onTaskStartedHook<Args>): Unsub {
    this.onTaskStartedHooks.push(cb);
    return () => {
      const idx = this.onTaskStartedHooks.indexOf(cb);
      if (idx !== -1) this.onTaskStartedHooks.splice(idx, 1);
    };
  }

  public onTaskAbortedInternal(cb: onTaskAbortedInternalHook): Unsub {
    this.onTaskAbortedInternalHooks.push(cb);
    return () => {
      const idx = this.onTaskAbortedInternalHooks.indexOf(cb);
      if (idx !== -1) this.onTaskAbortedInternalHooks.splice(idx, 1);
    };
  }

  /**
   * Forcefully aborts the current winning task (and fires hooks)
   */
  /**
   * Принудительно отменяет текущую задачу и все отложенные (debounced/throttled).
   * После вызова abort очередь становится idle (result = undefined).
   * Вызывает хуки onTaskAborted/onSeriesEnded.
   */
  public abort(): void {
    // Отменяем текущую задачу
    const err = new TaskAbortedError();
    if (
      this.leadingTaskController &&
      !this.leadingTaskController.signal.aborted
    ) {
      this.leadingTaskController.abort();
      if (!this.leadingTaskArgs) {
        throw new Error(
          "this.leadingTaskController defined, but leading task args is undefined"
        );
      }
    }

    this.fireTaskAbortedInternal();

    this.clearSeries(false);
    // Отменяем отложенные задачи (debounce/throttle)
    if (this.debouncedOrThrottledRun) {
      this.debouncedOrThrottledRun.cancel();
    }
    this.currentSeriesPromiseReject?.(err);
  }

  /**
   * Internal call for abort hooks
   * Вызывается при отмене любого запущенного запроса
   * @param isSeriesEnd true if this is the final abort (queue is idle)
   */
  /**
   * Internal call for abort hooks
   * Вызывается при отмене любого запущенного запроса
   * @param isSeriesEnd true if this is the final abort (queue is idle)
   */
  private fireTaskAborted(args?: Args, signal?: AbortSignal) {
    for (const cb of this.onTaskAbortedHooks) {
      cb({
        args,
        signal,
      });
    }
  }
  /**
   * Internal call for error hooks
   * Вызывается при ошибке любого запущенного запроса
   * @param isSeriesEnd true if the queue is idle after error
   */
  /**
   * Internal call for failure hooks
   * Вызывается при ошибке любого запущенного запроса
   * @param isSeriesEnd true if the queue is idle after error
   */
  private fireSeriesFailed(error: any, signal: AbortSignal, args: Args) {
    for (const cb of this.onSeriesFailedHooks) {
      cb({ error, signal, args });
    }
  }
  /**
   * Internal call for complete hooks
   * Вызывается при успешном завершении любого запущенного запроса
   * @param isSeriesEnd true if the queue is idle after completion
   */
  /**
   * Internal call for success hooks
   * Вызывается при успешном завершении любого запущенного запроса
   * @param isSeriesEnd true if the queue is idle after completion
   */
  private fireSeriesSucceeded(result: R, signal: AbortSignal, args: Args) {
    for (const cb of this.onSeriesSucceededHooks) {
      cb({ result, signal, args });
    }
  }

  private fireTaskDeferred(args: Args) {
    for (const cb of this.onTaskDeferredHooks) {
      cb({ args });
    }
  }

  private fireTaskIgnored(args: Args) {
    for (const cb of this.onTaskIgnoredHooks) {
      cb({ args });
    }
  }

  private fireAbortedTaskFinished(
    signal: AbortSignal,
    args: Args,
    result?: R,
    error?: any
  ) {
    for (const cb of this.onAbortedTaskFinishedHooks) {
      cb({ result, error, signal, args });
    }
  }

  private startSeries(args: Args, signal: AbortSignal) {
    this.currentSeriesPromise = new Promise<R>((resolve, reject) => {
      this.currentSeriesPromiseResolve = resolve;
      this.currentSeriesPromiseReject = reject;
    });
    this.fireSeriesStarted(args, signal);
  }

  private fireSeriesStarted(args: Args, signal: AbortSignal) {
    for (const cb of this.onSeriesStartedHooks) {
      cb({
        signal,
        args,
      });
    }
  }

  private fireTaskStarted(args: Args, signal: AbortSignal) {
    for (const cb of this.onTaskStartedHooks) {
      cb({
        signal,
        args,
      });
    }
  }

  private fireTaskAbortedInternal() {
    for (const cb of this.onTaskAbortedInternalHooks) {
      cb();
    }
  }

  private clearSeries(fallbackResolve?: boolean, fallbackResult?: any) {
    this.leadingTaskController = undefined;
    this.leadingTaskArgs = undefined;
    if (fallbackResolve) {
      this.currentSeriesPromiseResolve?.(fallbackResult);
    } else {
      this.currentSeriesPromiseReject?.(fallbackResult);
    }
    this.currentSeriesPromiseResolve = undefined;
    this.currentSeriesPromiseReject = undefined;
    this.currentSeriesPromise = undefined;
  }

  /**
   * @param options
   * - Если передан debounceMs, используется режим debounce (по умолчанию edge: trailing, как в lodash)
   * - Если передан throttleMs, используется режим throttle (по умолчанию edge: leading, как в lodash)
   * - После создания экземпляра опции изменить нельзя
   */
  constructor(
    task: TaskFn<R, Args>,
    options?: LastWinsAndCancelsPreviousOptions
  ) {
    this.task = task;
    if (!options) {
      this.delay = 0;
      this.edge = "trailing";
      this.debouncedOrThrottledRun = undefined;
      return;
    }

    if (isDebounceOptions(options)) {
      this.delay = options.debounceMs;
      this.edge = options.edge ?? "trailing";
      this.debouncedOrThrottledRun = debounce(
        this._run.bind(this),
        this.delay,
        {
          leading: this.edge === "leading" || this.edge === "both",
          trailing: this.edge === "trailing" || this.edge === "both",
        }
      );
    } else if (isThrottleOptions(options)) {
      this.delay = options.throttleMs;
      this.edge = options.edge ?? "leading";
      this.debouncedOrThrottledRun = throttle(
        this._run.bind(this),
        this.delay,
        {
          leading: this.edge === "leading" || this.edge === "both",
          trailing: this.edge === "trailing" || this.edge === "both",
        }
      );
    } else {
      this.delay = 0;
      this.edge = "trailing";
      this.debouncedOrThrottledRun = undefined;
    }
  }

  /**
   * Запускает новую задачу в очереди, отменяя предыдущую (если она была).
   *
   * Контракт:
   * - Если опции debounce/throttle не заданы, задача стартует немедленно, run возвращает промис с результатом задачи.
   * - Если задан debounce/throttle, задача может быть отложена или отменена согласно edge/таймингу.
   * - Если задача не была запущена (например, из-за отмены или отсутствия trailing/leading), промис из run резолвится в undefined.
   * - Каждый вызов run возвращает отдельный промис, который резолвится либо результатом задачи, либо undefined.
   *
   * Важно: после завершения всех задач (очередь пуста) геттер result возвращает undefined. Новый вызов run создаёт новый промис — старый становится невалидным.
   *
   * После создания экземпляра опции (debounce/throttle/edge) изменить нельзя.
   *
   * Если подписчик любого хука выбрасывает ошибку — эта ошибка "ломает" очередь (выбросится наружу из run/_run, дальнейшая работа не гарантируется).
   *
   * Порядок вызова хуков:
   * - onSeriesStarted → onTaskAborted/onSeriesFailed/onSeriesSucceeded (в зависимости от исхода задачи)
   * - onSeriesEnded вызывается после завершения серии (последней задачи)
   *
   * Метод abort отменяет и текущую задачу, и все отложенные (debounced/throttled).
   *
   * По умолчанию edge: debounce — trailing (как в lodash), throttle — leading (как в lodash).
   *
   * @param task Асинхронная функция, принимающая AbortSignal
   * @returns Промис с результатом задачи или undefined, если задача не была запущена
   */
  public async run(...args: Args): Promise<R> {
    if (!this.debouncedOrThrottledRun) {
      // No debounce/throttle — just call _run
      return this._run(args) as Promise<R>;
    }

    const [resultPromise, _resolveResultPromise, _rejectResultPromise] =
      resolvablePromiseFromOutside<R>();

    const nextTaskStartedPromise = this.nextTaskStartedPromise;

    //покрываем кейс когда текущий промис ушел в дефер, а в это время вызвали abort() => сняли деферед вызов => наши резолверы не будут вызваны
    //currentSeriesResult может быть undefined если серия еще не началась, когда эта таска ушла в дефер
    //а nextSeriesResult не заресолвиться если аборт случился пока не была начата серия
    const unsub = this.onTaskAbortedInternal(() => {
      this.fireTaskAborted(args);
      _rejectResultPromise(new TaskAbortedError());
      setTimeout(() => unsub(), 0);
    });

    const resolveResultPromise = (result: R | PromiseLike<R>) => {
      _resolveResultPromise(result);
      setTimeout(() => unsub(), 0);
    };

    const rejectResultPromise = (error: any) => {
      _rejectResultPromise(error);
      setTimeout(() => unsub(), 0);
    };
    /**
     * debouncedOrThrottledRun может
     * - запустить задачу немедленно и вернуть промис
     * - отменить задачу и вернуть undefined
     * - отложить задачу и вернуть undefined
     *  - и потом выполнить ее и выполнить resolve(R) позже
     *  - и потом отменить ее и выполнить resolve(undefined) - напр. это был trialing throttle и после этого вызова был еще вызов ближе к концу окна
     *
     *
     * Т.е. нам надо вернуть промис, который резолвится не позже ближайшей завершенной очереди
     */
    const [thisTaskStartedPromise, resolveThisTaskStarted] =
      resolvablePromiseFromOutside<typeof startedTaskSymbol>();

    const debouncedOrThrottledRunResult = this.debouncedOrThrottledRun!(
      args,
      () => {
        resolveThisTaskStarted(startedTaskSymbol);
      },
      resolveResultPromise,
      rejectResultPromise
    )?.catch(() => {});

    //@startedTaskSymbol || undefined || Promise<R> для старого значения
    //выполнение не было отложено только в первом случае
    const thisTaskVsPrevTaskOrDeferRace = await Promise.race([
      debouncedOrThrottledRunResult,
      thisTaskStartedPromise,
    ]);

    const wasDeferred = thisTaskVsPrevTaskOrDeferRace !== startedTaskSymbol;

    if (!wasDeferred) {
      if (!debouncedOrThrottledRunResult) {
        throw new Error(
          "debouncedOrThrottledRunResult is undefined although the task was not deferred"
        );
      }
      resolveResultPromise(debouncedOrThrottledRunResult as Promise<R>);
      return resultPromise;
    }

    this.fireTaskDeferred(args);

    if (this.edge === "leading") {
      this.fireTaskIgnored(args);
      rejectResultPromise(new TaskIgnoredError());
      return resultPromise;
    }

    Promise.race([nextTaskStartedPromise, thisTaskStartedPromise]).then(
      (thisTaskVsNextTaskRace) => {
        const wasIgnored = thisTaskVsNextTaskRace !== startedTaskSymbol;

        if (wasIgnored) {
          this.fireTaskIgnored(args);
          rejectResultPromise(new TaskIgnoredError());
        }
      }
    );

    return resultPromise;
  }

  /**
   * Запускает задачу немедленно, отменяя предыдущую. Используется только внутри run и обёрток debounce/throttle.
   * Не вызывайте напрямую — для пользователя предназначен только run.
   * @private
   */
  private async _run(
    args: Args,
    onTaskStarted?: () => void,
    onTaskCompleted?: (result: R) => void,
    onTaskFailed?: (error: any) => void
  ): Promise<R | undefined> {
    try {
      onTaskStarted?.();
      //серия уже идет
      if (this.leadingTaskController) {
        if (!this.currentSeriesPromise) {
          throw new Error("Has controller but no resultPromise");
        }

        if (this.leadingTaskController.signal.aborted) {
          this.fireTaskAborted(args, this.leadingTaskController.signal);
          throw new TaskAbortedError();
        }
        // Abort previous task and fire hooks
        this.leadingTaskController.abort();
        // If a new task starts, the series does not end
        this.fireTaskAborted(args, this.leadingTaskController.signal);
      }
      this.leadingTaskArgs = args;
      this.leadingTaskController = new AbortController();
      const signal = this.leadingTaskController.signal;
      this.fireTaskStarted(args, signal);
      //серия не шла, начинаем ее
      if (!this.currentSeriesPromise) {
        this.startSeries(args, signal);
      }
      try {
        const result = await this.task(signal, ...args);
        if (!signal.aborted) {
          this.currentSeriesPromiseResolve?.(result);
          // After successful completion — the series ends
          this.fireSeriesSucceeded(result, signal, args);
          onTaskCompleted?.(result);
          this.clearSeries(true, result);
          return result;
        }
        this.fireAbortedTaskFinished(signal, args, result);
        const error = new TaskAbortedError();
        onTaskFailed?.(error);
        throw error;
      } catch (err) {
        if (!signal.aborted) {
          this.currentSeriesPromiseReject?.(err);
          // After error — the series ends
          this.fireSeriesFailed(err, signal, args);
          this.clearSeries(false, err);
          onTaskFailed?.(err);
        }
        throw err;
      }
    } catch (err) {
      if (onTaskFailed) {
        onTaskFailed(err);
      } else {
        throw err;
      }
    }
  }

  /**
   * Промис последней "выигравшей" задачи (той, что реально стартовала).
   * Если очередь пуста (все задачи завершились/отменены) — undefined.
   * После нового run старый result становится невалидным (резолвится/отклоняется только последний).
   *
   * @returns Promise<R> | undefined
   */
  public get currentSeriesResult(): Promise<R> | undefined {
    return this.currentSeriesPromise;
  }

  private get nextTaskStartedPromise(): Promise<void> {
    return new Promise<void>((resolve) => {
      const unsub = this.onTaskStarted(() => {
        resolve();
        setTimeout(() => unsub(), 0);
      });
    });
  }

  /**
   * промис который завершается результатом серии, которая завершиться первой после вычисления этого геттера
   * если серия упадет с ошибкой - реджектнет
   */
  public get nextSeriesResult(): Promise<R | undefined> {
    return new Promise<R | undefined>((resolve, reject) => {
      const unsub = this.onSeriesEnded((result) => {
        if (result.aborted) {
          reject(result.signal);
        } else if (result.error) {
          reject(result.error);
        } else if (result.result) {
          resolve(result.result);
        } else {
          setTimeout(() => unsub(), 0);
          throw new Error("Unexpected result");
        }
        setTimeout(() => unsub(), 0);
      });
    });
  }
}
