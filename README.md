# last-wins-and-cancels-prevs

![CI](https://github.com/avfirsov/last-wins-and-cancels-prevs/actions/workflows/ci.yml/badge.svg)
[![codecov](https://codecov.io/gh/avfirsov/last-wins-and-cancels-prevs/branch/main/graph/badge.svg)](https://codecov.io/gh/avfirsov/last-wins-and-cancels-prevs)
![TypeScript](https://img.shields.io/badge/types-100%25%20strict-blue?style=flat-square&logo=typescript)

A minimal async queue where only the latest task is executed, all previous are auto-cancelled via `AbortController`. Supports debounce/throttle, hooks for all task events, and guarantees that `.result` always reflects the last completed task.

---

## TL;DR
- **Only the latest task runs:** previous are cancelled automatically
- **AbortController-based:** tasks should always check `signal.aborted`
- **Debounce/throttle:** control execution frequency (like lodash)
- **`.result`:** promise resolves only when the last real task completes
- **No leaks or race-conditions:** cancelled/errored tasks do not affect the result
- **Hooks for all events:** subscribe to abort, error, complete for any task
- **Manual abort:** cancel any running task instantly

---

## `queue.result` lifecycle

- **Before first run:** `queue.result === undefined` — queue is empty, nothing to await
- **While task is running:** `queue.result` is a promise for the last (not-yet-cancelled) task
- **After last task completes (and no new run):** `queue.result === undefined` — queue is empty again

**Example:**
```ts
const queue = new LastWinsAndCancelsPrevious<number>();
console.log(queue.result); // undefined
queue.run(async () => 1);
console.log(typeof queue.result.then); // 'function' — it's a promise
await queue.result; // 1
console.log(queue.result); // undefined (queue is empty again)
```

---

## Usage Example

```ts
import { LastWinsAndCancelsPrevious } from 'last-wins-and-cancels-prevs';

const queue = new LastWinsAndCancelsPrevious<string>({ debounceMs: 300 });
console.log(queue.result) //undefined - the queue is empty
queue.run(signal => fetch('/api?q=first', { signal }).then(r => r.text()));
queue.run(signal => fetch('/api?q=second', { signal }).then(r => r.text()));
queue.run(signal => fetch('/api?q=final', { signal }).then(r => r.text()));

const finalResult = await queue.result;
console.log(finalResult); // result of the last request
```

---

## Vue Example: Debounced Search with Loading and Abort

```vue
<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue';
import { LastWinsAndCancelsPrevious } from 'last-wins-and-cancels-prevs';

const searchQuery = ref('');
const results = ref<string[]>([]);
const isLoading = ref(false);

// Create queue with 500ms debounce
const queue = new LastWinsAndCancelsPrevious<string[]>({ debounceMs: 500 });

queue.onSeriesStarted(() => {
  isLoading.value = true;
});
queue.onAborted(({ isSeriesEnd }) => {
  if (isSeriesEnd) isLoading.value = false;
});
queue.onError(({ isSeriesEnd }) => {
  if (isSeriesEnd) isLoading.value = false;

queue.onComplete(({ result, isSeriesEnd }) => {
  if (isSeriesEnd) {
    isLoading.value = false;
    if (result) results.value = result;
  }
});

watch(searchQuery, (q) => {
  queue.run(async (signal) => {
    // Simulate API call with abort support
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal });
    return await res.json();
  });
});

onUnmounted(() => {
  queue.abort(); // Cancel any pending request when component unmounts
});
</script>

<template>
  <input v-model="searchQuery" placeholder="Search..." />
  <span v-if="isLoading">Loading...</span>
  <ul>
    <li v-for="item in results" :key="item">{{ item }}</li>
  </ul>
</template>
```

---

## Hooks and abort

```ts
const queue = new LastWinsAndCancelsPrevious<number>();
queue.onAborted(({ signal, isSeriesEnd }) => {
  console.log('Aborted!', signal, 'isSeriesEnd:', isSeriesEnd);
  if (isSeriesEnd) {
    // All tasks are done/cancelled, queue is now idle
    cleanupOrNotify();
  }
});
queue.onError(({ error, isSeriesEnd }) => {
  console.error('Task error:', error, 'isSeriesEnd:', isSeriesEnd);
  if (isSeriesEnd) {
    // Show global error or reset UI
  }
});
queue.onComplete(({ result, isSeriesEnd }) => {
  console.log('Completed with', result, 'isSeriesEnd:', isSeriesEnd);
  if (isSeriesEnd) {
    // Final UI update, e.g. loading spinner off
  }
});

queue.run(async signal => {
  await doSomething(signal);
  return 42;
});

// Manual abort of queue.result 
queue.abort();
```

---

## API

### Class: `LastWinsAndCancelsPrevious<R>`

- `run(task: (signal: AbortSignal) => Promise<R>): Promise<R | undefined>` — start a new task, cancels previous
- `result: Promise<R> | undefined` — promise for last task, or undefined if idle
- `abort(): void` — manually abort current task
- `onAborted(cb)` — subscribe to any task abort
- `onError(cb)` — subscribe to any task error
- `onComplete(cb)` — subscribe to any task completion

#### Hook signature:
```ts
(args: { result?: R; error?: any; aborted: boolean; signal: AbortSignal; isSeriesEnd: boolean }) => void
```
- `isSeriesEnd: boolean` — true if this event marks the end of the current run series (queue is now idle), false if another task is queued or running.

---

## What is `isSeriesEnd`?

- `isSeriesEnd: true` — This event marks the end of a "series" (all tasks are done/cancelled, queue is idle)
- `isSeriesEnd: false` — This event is intermediate (another task is queued or running)

Use this to distinguish between final/finalizing UI actions vs. intermediate (e.g. loading spinners, notifications, analytics, etc).

---

## Edge-cases & Best Practices

- Always check `signal.aborted` in your tasks to avoid work after cancellation
- If the last task throws — `.result` is rejected with that error
- If debounce/trailing=false and the task is not executed — `run` returns `Promise.resolve(undefined)`
- Cancelled tasks never affect `.result`, even if they finish later
- Use hooks for logging, UI, analytics, or global error handling
- Use `abort()` to cancel on navigation or user action

---

## FAQ

- **Q:** What if a previous task finishes after a new one?
  **A:** `.result` always reflects only the last completed task, cancelled ones are ignored.
- **Q:** How are errors handled?
  **A:** `.result` is rejected only with the last task's error. Errors from cancelled tasks are ignored.
- **Q:** How does debounce/throttle affect execution?
  **A:** Tasks are executed according to lodash.debounce/throttle rules. `.result` and hooks fire only for actually started tasks.
- **Q:** Can I unsubscribe hooks?
  **A:** Not yet. For advanced use, wrap your callback and filter manually.

---

## Tests & Coverage

- 100% test coverage (see badge)
- All edge-cases covered: abort, errors, execution order, debounce/throttle
- See `test/basic.test.ts` for scenarios

---

## Contributing

- PRs and issues are welcome!
- Please add tests for new features or bugfixes

---

## License
MIT