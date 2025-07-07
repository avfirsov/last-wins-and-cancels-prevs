import { TaskFn } from "../src";

// Общий util для асинхронных тестов
export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const makeTask: TaskFn<number, [number, number[], number?]> = async (_signal: AbortSignal, value: number, log: number[], delayMs?: number) => {
  log.push(value);
  if (delayMs) {
    await wait(delayMs);
  }
  return value;
};
