import { describe, expect, it, vi } from "vitest";
import { LastWriteSaveQueue } from "../src/shared/repositories/saveQueue";
import {
  EXAMPLE_PROJECT,
  type WorkspaceDocument,
} from "../src/shared/domain/types";

function documentFor(title: string): WorkspaceDocument {
  return {
    version: 1,
    activeProjectId: EXAMPLE_PROJECT.id,
    projects: [{ ...structuredClone(EXAMPLE_PROJECT), title }],
  };
}

async function flushMicrotasks(times = 10): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

describe("last-write save queue", () => {
  it("coalesces revisions made before the debounce window", async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const write = vi.fn(async (document: WorkspaceDocument) => {
      writes.push(document.projects[0]?.title ?? "");
    });
    const onStatus = vi.fn();
    const queue = new LastWriteSaveQueue(write, onStatus);

    queue.save(1, documentFor("first"));
    queue.save(2, documentFor("second"));
    queue.save(3, documentFor("third"));
    expect(onStatus).toHaveBeenLastCalledWith("saving");
    expect(write).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(250);

    expect(write).toHaveBeenCalledTimes(1);
    expect(writes).toEqual(["third"]);
    expect(onStatus).toHaveBeenLastCalledWith("saved");
    vi.useRealTimers();
  });

  it("coalesces revisions made while an older write is in flight", async () => {
    const writes: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const write = vi.fn((document: WorkspaceDocument) => {
      writes.push(document.projects[0]?.title ?? "");
      return new Promise<void>((resolve) => {
        if (writes.length === 1) releaseFirst = () => resolve();
        else resolve();
      });
    });
    const onStatus = vi.fn();
    const queue = new LastWriteSaveQueue(write, onStatus, 0);

    queue.save(1, documentFor("first"));
    await flushMicrotasks();
    queue.save(2, documentFor("second"));
    queue.save(3, documentFor("third"));

    releaseFirst?.();
    await flushMicrotasks();

    expect(write).toHaveBeenCalledTimes(2);
    expect(writes).toEqual(["first", "third"]);
    expect(onStatus).toHaveBeenLastCalledWith("saved");
  });

  it("keeps showing saving while a stale failure is followed by a newer revision", async () => {
    const writes = vi
      .fn<(document: WorkspaceDocument) => Promise<void>>()
      .mockRejectedValueOnce(new Error("quota"))
      .mockResolvedValueOnce(undefined);
    const onStatus = vi.fn();
    const queue = new LastWriteSaveQueue(writes, onStatus, 0);

    queue.save(1, documentFor("first"));
    await flushMicrotasks();
    queue.save(2, documentFor("second"));
    await flushMicrotasks();

    expect(writes).toHaveBeenCalledTimes(2);
    expect(onStatus).not.toHaveBeenCalledWith("error");
    expect(onStatus).toHaveBeenLastCalledWith("saved");
  });
});
