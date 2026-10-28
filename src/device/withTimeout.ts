import { TimeoutError } from "./errors";

/**
 * Rejects with a TimeoutError if `promise` does not settle within `ms`.
 * The timer is always cleared, so it never keeps running after the race ends.
 * Note that the underlying work is not cancelled — it just stops being awaited.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new TimeoutError(`${label} took too long`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
