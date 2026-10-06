import { describe, expect, it } from "vitest";
import {
  SaveScheduler,
  type SaveOutcome,
} from "../src/shared/services/saveScheduler";

function createHarness(failures: Set<string> = new Set()) {
  const saves: { value: string; settle: () => void }[] = [];
  const settled: { outcome: SaveOutcome; isLatest: boolean }[] = [];
  const scheduler = new SaveScheduler<string>(
    (value) =>
      new Promise<void>((resolve, reject) => {
        saves.push({
          value,
          settle: () =>
            failures.has(value) ? reject(new Error("写入失败")) : resolve(),
        });
      }),
    (outcome, isLatest) => settled.push({ outcome, isLatest }),
  );
  let cursor = 0;
  const settleNext = async () => {
    saves[cursor]?.settle();
    cursor += 1;
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { scheduler, saves, settled, settleNext };
}

describe("save scheduler", () => {
  it("coalesces rapid submissions into the latest document", async () => {
    const { scheduler, saves, settled, settleNext } = createHarness();
    scheduler.submit("v1");
    scheduler.submit("v2");
    scheduler.submit("v3");
    expect(saves).toHaveLength(1);
    await settleNext();
    await settleNext();
    expect(saves.map((save) => save.value)).toEqual(["v1", "v3"]);
    expect(settled).toEqual([
      { outcome: "saved", isLatest: false },
      { outcome: "saved", isLatest: true },
    ]);
  });

  it("reports a failure only when the failed write is the latest one", async () => {
    const failures = new Set(["bad"]);
    const { scheduler, settled, settleNext } = createHarness(failures);
    scheduler.submit("bad");
    scheduler.submit("good");
    await settleNext();
    await settleNext();
    expect(settled).toEqual([
      { outcome: "error", isLatest: false },
      { outcome: "saved", isLatest: true },
    ]);
  });

  it("keeps the retried document consistent with what is on screen", async () => {
    const failures = new Set(["doc"]);
    const { scheduler, saves, settled, settleNext } = createHarness(failures);
    scheduler.submit("doc");
    await settleNext();
    expect(settled).toEqual([{ outcome: "error", isLatest: true }]);
    // 重试保存的是同一份最新文档，期间没有别的写入插队
    failures.delete("doc");
    scheduler.submit("doc");
    await settleNext();
    expect(saves.map((save) => save.value)).toEqual(["doc", "doc"]);
    expect(settled).toEqual([
      { outcome: "error", isLatest: true },
      { outcome: "saved", isLatest: true },
    ]);
  });
});
