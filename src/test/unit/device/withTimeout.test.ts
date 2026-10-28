import { TimeoutError } from "../../../device/errors";
import { withTimeout } from "../../../device/withTimeout";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe("withTimeout()", () => {
  it("resolves with the value of a promise that settles in time", async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, "Task")).resolves.toBe(
      42,
    );
  });

  it("passes through the rejection of a promise that fails in time", async () => {
    await expect(
      withTimeout(Promise.reject(new Error("boom")), 1000, "Task"),
    ).rejects.toThrow("boom");
  });

  it("rejects with a TimeoutError naming the task once the time is up", async () => {
    const result = expect(
      withTimeout(new Promise(() => {}), 1000, "Reading Boardtree"),
    ).rejects.toThrow(
      expect.objectContaining({
        name: "TimeoutError",
        message: "Reading Boardtree took too long",
      }),
    );

    await jest.advanceTimersByTimeAsync(1000);
    await result;
  });

  it("rejects with an instance of TimeoutError", async () => {
    const result = expect(
      withTimeout(new Promise(() => {}), 1000, "Task"),
    ).rejects.toBeInstanceOf(TimeoutError);

    await jest.advanceTimersByTimeAsync(1000);
    await result;
  });

  it("does not reject before the time is up", async () => {
    const onSettled = jest.fn();
    withTimeout(new Promise(() => {}), 1000, "Task").catch(onSettled);

    await jest.advanceTimersByTimeAsync(999);

    expect(onSettled).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(onSettled).toHaveBeenCalled();
  });

  it("clears its timer once the promise has settled", async () => {
    await withTimeout(Promise.resolve("done"), 1000, "Task");

    expect(jest.getTimerCount()).toBe(0);
  });
});
