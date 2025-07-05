# last-wins-and-cancels-prevs

Минималистичная асинхронная очередь задач, где выполняется только последняя задача, а все предыдущие автоматически отменяются через `AbortController`. Поддерживает debounce/throttle-режимы и гарантирует, что `.result` всегда отражает результат последней завершённой задачи.

---

## TL;DR
- **Только одна задача активна**: предыдущие отменяются при запуске новой
- **Отмена через AbortController**: задачи должны корректно реагировать на сигнал
- **Debounce/throttle**: гибко управляй частотой запуска задач
- **`.result`**: промис, который резолвится только результатом последней завершённой задачи
- **Без race-condition и утечек**: отменённые/ошибочные задачи не влияют на итог

---

## Жизненный цикл `queue.result`

- **До первого run:** `queue.result === undefined` — очередь пуста, нечего ожидать.
- **Во время работы задачи:** `queue.result` — это промис, который резолвится (или реджектится) результатом последней реально запущенной задачи.
- **После завершения последней задачи (и если не было новых run):** `queue.result === undefined` — очередь снова пуста.

**Пример:**
```ts
const queue = new LastWinsAndCancelsPrevious<number>();
console.log(queue.result); // undefined
queue.run(async () => 1);
console.log(typeof queue.result.then); // 'function' — это промис
await queue.result; // 1
console.log(queue.result); // undefined (очередь снова пуста)
```

> Это важно для контроля состояния: можно легко определить, есть ли сейчас активная задача, и ждать только актуальный результат.

---

## Пример использования

```ts
import { LastWinsAndCancelsPrevious } from 'last-wins-and-cancels-prevs';

const queue = new LastWinsAndCancelsPrevious<string>({ debounceMs: 300 });

queue.run(signal => fetch('/api?q=first', { signal }).then(r => r.text()));
queue.run(signal => fetch('/api?q=second', { signal }).then(r => r.text()));
queue.run(signal => fetch('/api?q=final', { signal }).then(r => r.text()));

const finalResult = await queue.result;
console.log(finalResult); // результат только последнего запроса
```

---

## Как это работает (аски-диаграммы)

### 1. Обычный режим (без debounce/throttle)

```
run(task1) ──────┬─► [task1 running]
                 │
run(task2) ──┬───┘   [task1 aborted, task2 running]
             │
run(task3) ──┘       [task2 aborted, task3 running]

queue.result ──────────────► резолвится, когда task3 завершится
```

### 2. Debounce (например, debounceMs: 300)

```
time:    0ms   100ms   200ms   300ms   400ms
calls:  run1   run2    run3

[debounce] ждёт 300мс после последнего run
               │
               ▼
         [task3 running]

queue.result ──────────────► резолвится, когда task3 завершится
```

### 3. Ошибки и отмены

```
run(task1) ──► [task1 running]
run(task2) ──► [task1 aborted, task2 running]

// Если task1 падает с ошибкой после отмены — .result не реджектится
// Если task2 падает — .result реджектится этой ошибкой

queue.result ──► всегда отражает только последнюю задачу
```

---


## Edge-cases и best practices

- **Отмена**: всегда проверяй `signal.aborted` внутри задачи
- **Ошибки**: если последняя задача упала — `.result` реджектится только этой ошибкой
- **Debounce/trailing=false**: если задача не была запущена, `run` вернёт `Promise.resolve(undefined)`
- **Без memory leak**: отменённые задачи не влияют на `.result`, даже если завершились позже


---

## Когда использовать?
- Автосохранение (только последний ввод пользователя сохраняется)
- Поисковые автокомплиты
- Загрузка данных с отменой старых запросов
- Сценарии, где важен только последний актуальный результат

---

## FAQ
- **Q:** Что если предыдущая задача завершится после новой?
  **A:** `.result` всегда отражает только последнюю завершённую задачу, даже если отменённая завершится позже.
- **Q:** Как обрабатываются ошибки?
  **A:** `.result` реджектится только ошибкой последней задачи. Ошибки отменённых задач игнорируются.
- **Q:** Как работает с debounce/throttle?
  **A:** Задачи запускаются по правилам lodash.debounce/throttle, отмена и резолв `.result` происходят только для реально запущенных задач.

---

## Контрибьютинг и тесты

- Покрытие edge-cases: отмена, ошибки, порядок завершения, debounce/throttle
- См. `test/basic.test.ts` для полного набора сценариев
- PR и вопросы приветствуются!

---

## License
MIT
