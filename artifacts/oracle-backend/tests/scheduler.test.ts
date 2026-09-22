/**
 * The scheduler's own behaviour, with the job stubbed.
 *
 * The window logic is tested elsewhere; what is tested here is the thing that
 * makes it safe to leave running for weeks — overlap suppression and the
 * property that an exception in the job does not kill the loop.
 */

import { expect } from "chai";

import { ChallengeWindowScheduler } from "../src/jobs/challengeWindowScheduler";
import { SecretRegistry } from "../src/security/redact";
import { SilentTestLogger } from "./helpers/silentLogger";
import type { JobRunSummary } from "../src/service/oracleService";

const EMPTY: JobRunSummary = { scanned: 0, results: [] };

describe("ChallengeWindowScheduler", () => {
  it("runs the job and returns its summary", async () => {
    let calls = 0;
    const scheduler = new ChallengeWindowScheduler({
      runJob: async () => {
        calls += 1;
        return EMPTY;
      },
      intervalMs: 1000,
      logger: new SilentTestLogger(),
      registry: new SecretRegistry(),
    });

    const summary = await scheduler.runOnce();

    expect(calls).to.equal(1);
    expect(summary).to.deep.equal(EMPTY);
  });

  it("does not run two ticks concurrently", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    let releaseJob: () => void = () => {};
    // The first run is held open on this promise until the test releases it.
    const held = new Promise<void>((resolve) => {
      releaseJob = resolve;
    });

    const scheduler = new ChallengeWindowScheduler({
      runJob: async () => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await held;
        concurrent -= 1;
        return EMPTY;
      },
      intervalMs: 1000,
      logger: new SilentTestLogger(),
      registry: new SecretRegistry(),
    });

    const first = scheduler.runOnce();
    // Give the first run a moment to reach its await.
    await new Promise((r) => setTimeout(r, 20));
    const second = await scheduler.runOnce();

    // The overlapping tick is skipped rather than queued or run twice.
    expect(second).to.equal(null);
    expect(maxConcurrent).to.equal(1);

    releaseJob();
    await first;
    expect(maxConcurrent).to.equal(1);
  });

  it("survives a throwing job and keeps running", async () => {
    let calls = 0;
    const logger = new SilentTestLogger();
    const scheduler = new ChallengeWindowScheduler({
      runJob: async () => {
        calls += 1;
        if (calls === 1) throw new Error("boom");
        return EMPTY;
      },
      intervalMs: 1000,
      logger,
      registry: new SecretRegistry(),
    });

    // The first run swallows the throw and reports nothing.
    expect(await scheduler.runOnce()).to.equal(null);
    expect(logger.text).to.contain("challenge window job threw");
    expect(logger.text).to.contain("boom");

    // The loop is still usable.
    expect(await scheduler.runOnce()).to.deep.equal(EMPTY);
    expect(calls).to.equal(2);
  });

  it("starts and stops its timer without leaking it", async () => {
    const scheduler = new ChallengeWindowScheduler({
      runJob: async () => EMPTY,
      intervalMs: 20,
      logger: new SilentTestLogger(),
      registry: new SecretRegistry(),
    });

    scheduler.start();
    // Starting twice is a no-op rather than a second timer.
    scheduler.start();
    await new Promise((r) => setTimeout(r, 70));
    scheduler.stop();

    expect(scheduler.isStopped).to.equal(true);
    // Stopping twice is safe.
    scheduler.stop();
  });
});
