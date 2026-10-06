import type { WorkspaceDocument } from "../domain/types";

export type SaveStatus = "saving" | "saved" | "error";

interface SaveJob {
  revision: number;
  document: WorkspaceDocument;
}

export class LastWriteSaveQueue {
  private pending?: SaveJob;
  private running?: SaveJob;
  private draining = false;
  private latestRevision = 0;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly write: (document: WorkspaceDocument) => Promise<void>,
    private readonly onStatusChange: (status: SaveStatus) => void,
    private readonly delayMs = 250,
  ) {}

  save(
    revision: number,
    document: WorkspaceDocument,
    immediate = false,
  ): void {
    this.latestRevision = revision;
    this.pending = { revision, document };
    this.onStatusChange("saving");
    if (this.draining) return;
    clearTimeout(this.timer);
    if (immediate) {
      void this.drain();
      return;
    }
    this.timer = setTimeout(() => {
      void this.drain();
    }, this.delayMs);
  }

  async flush(): Promise<void> {
    clearTimeout(this.timer);
    await this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    while (this.pending) {
      this.running = this.pending;
      this.pending = undefined;
      const job = this.running;
      try {
        await this.write(job.document);
        if (job.revision === this.latestRevision)
          this.onStatusChange("saved");
      } catch {
        if (job.revision === this.latestRevision)
          this.onStatusChange("error");
      } finally {
        this.running = undefined;
      }
    }
    this.draining = false;
  }
}
