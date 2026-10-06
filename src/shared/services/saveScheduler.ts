export type SaveOutcome = "saved" | "error";

/**
 * 合并式保存调度：写入串行执行；一次写入未结束时产生的新文档
 * 只保留最新一份排队，避免连续编辑触发一连串全量落盘。
 * 每次写入结束后回调 onSettled；isLatest 为 true 表示落盘的
 * 正是当前最新文档，界面可以据此切换“已保存 / 保存失败”。
 */
export class SaveScheduler<T> {
  private inFlight = false;
  private queued: { value: T; revision: number } | null = null;
  private revision = 0;

  constructor(
    private readonly save: (value: T) => Promise<void>,
    private readonly onSettled: (
      outcome: SaveOutcome,
      isLatest: boolean,
    ) => void,
  ) {}

  submit(value: T): void {
    this.revision += 1;
    const revision = this.revision;
    if (this.inFlight) {
      this.queued = { value, revision };
      return;
    }
    void this.flush(value, revision);
  }

  private async flush(value: T, revision: number): Promise<void> {
    this.inFlight = true;
    let outcome: SaveOutcome = "saved";
    try {
      await this.save(value);
    } catch {
      outcome = "error";
    }
    this.inFlight = false;
    this.onSettled(outcome, revision === this.revision);
    const queued = this.queued;
    if (queued) {
      this.queued = null;
      void this.flush(queued.value, queued.revision);
    }
  }
}
