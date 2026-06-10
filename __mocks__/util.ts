const actual = jest.requireActual<typeof import("util")>("util");

module.exports = {
  ...actual,
  promisify:
    (fn: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        fn(...args, (err: Error | null, stdout: string, stderr: string) => {
          if (err) {
            Object.assign(err, { stderr });
            reject(err);
          } else {
            resolve({ stdout, stderr });
          }
        });
      }),
};
