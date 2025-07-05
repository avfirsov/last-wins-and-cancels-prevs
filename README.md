# latest-cancels-previous

A minimal async task queue where only the latest task gets executed.
Automatically cancels previous ones using `AbortController`.

## Usage

```ts
const queue = new LatestCancelsPrevious<string>();

queue.run(signal => fetch('/api?q=test', { signal }).then(r => r.text()));
queue.run(signal => fetch('/api?q=final', { signal }).then(r => r.text()));

const finalResult = await queue.result;
```

## Features

- Only one task runs at a time
- Automatically aborts previous task using `AbortController`
- Supports debounce/throttle options
- `.result` getter always reflects the last completed task
