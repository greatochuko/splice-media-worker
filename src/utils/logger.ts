const colors = {
  reset: "\x1b[0m",
  info: "\x1b[36m", // Cyan
  success: "\x1b[32m", // Green
  error: "\x1b[31m", // Red
  warn: "\x1b[33m", // Yellow
};

export const logger = {
  info: (...args: unknown[]) => {
    console.log(`${colors.info}[INFO]${colors.reset}`, ...args);
  },

  success: (...args: unknown[]) => {
    console.log(`${colors.success}[SUCCESS]${colors.reset}`, ...args);
  },

  warn: (...args: unknown[]) => {
    console.warn(`${colors.warn}[WARN]${colors.reset}`, ...args);
  },

  error: (...args: unknown[]) => {
    console.error(`${colors.error}[ERROR]${colors.reset}`, ...args);
  },
};
