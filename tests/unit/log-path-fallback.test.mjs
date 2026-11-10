import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "coolrouter-log-path-"));
const DATA_DIR = path.join(SANDBOX, "data");
const ORIGINAL_CWD = process.cwd();
const ORIGINAL_ENV = {
  DATA_DIR: process.env.DATA_DIR,
  APP_LOG_FILE_PATH: process.env.APP_LOG_FILE_PATH,
  APP_LOG_TO_FILE: process.env.APP_LOG_TO_FILE,
};

let importCounter = 0;
async function loadLogEnvFrom(cwd) {
  process.chdir(cwd);
  // logEnv captures process.cwd() at module load, so every scenario needs a fresh instance
  return import(`../../src/lib/logEnv.ts?scenario=${++importCounter}`);
}

test.beforeEach(() => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  process.env.DATA_DIR = DATA_DIR;
  delete process.env.APP_LOG_FILE_PATH;
  delete process.env.APP_LOG_TO_FILE;
});

test.afterEach(() => {
  process.chdir(ORIGINAL_CWD);
});

test.after(() => {
  process.chdir(ORIGINAL_CWD);
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(SANDBOX, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("default log file stays under the working directory when it is writable", async () => {
  const cwd = path.join(SANDBOX, "writable-install");
  fs.mkdirSync(cwd, { recursive: true });

  const logEnv = await loadLogEnvFrom(cwd);

  assert.equal(
    fs.realpathSync(path.dirname(logEnv.getAppLogFilePath())),
    fs.realpathSync(path.join(cwd, "logs", "application"))
  );
});

test("default log file falls back to the data directory when the working directory is not writable", async () => {
  // Stand-in for C:\Program Files\Cool Router\resources\app: logs/ cannot be created there.
  const cwd = path.join(SANDBOX, "readonly-install");
  fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(path.join(cwd, "logs"), "not a directory");

  const logEnv = await loadLogEnvFrom(cwd);

  assert.equal(logEnv.getAppLogFilePath(), path.join(DATA_DIR, "app-logs", "app.log"));
});

test("APP_LOG_FILE_PATH always wins over the default", async () => {
  const cwd = path.join(SANDBOX, "readonly-install-2");
  fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(path.join(cwd, "logs"), "not a directory");
  process.env.APP_LOG_FILE_PATH = path.join(SANDBOX, "custom", "router.log");

  const logEnv = await loadLogEnvFrom(cwd);

  assert.equal(logEnv.getAppLogFilePath(), path.join(SANDBOX, "custom", "router.log"));
});
