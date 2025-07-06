// Общий util для асинхронных тестов
export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const makeTask = (value: number, log: number[], delayMs?: number) => async (signal: AbortSignal) => {
  log.push(value);
  if (delayMs) {
    await wait(delayMs);
  }
  return value;
};
