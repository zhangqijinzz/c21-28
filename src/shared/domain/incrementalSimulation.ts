import { analyzeGraph } from "./graph";
import {
  applyFallbackWeights,
  baseDurationMs,
  buildSimulationResult,
  chooseSlot,
  computeTimelineEntry,
  createSlots,
  recordEntry,
  slotCountFor,
  type SlotState,
} from "./simulation";
import type {
  LatencyProject,
  RequestNode,
  SimulationMode,
  SimulationResult,
  TimelineEntry,
} from "./types";

export interface SimulationRunStats {
  status: "identical" | "incremental" | "full";
  reusedEntries: number;
  computedEntries: number;
  durationCacheHits: number;
  durationCacheMisses: number;
}

interface NodeDurationMemo {
  fingerprint: string;
  value: number;
}

interface ScheduledSnapshot {
  order: string[];
  entries: TimelineEntry[];
  entriesById: Map<string, TimelineEntry>;
  durations: Map<string, number>;
  dependencyKeys: Map<string, string>;
  slotTimeline: SlotState[][];
  slotCount: number;
  nodeCount: number;
}

const EMPTY_STATS: SimulationRunStats = {
  status: "full",
  reusedEntries: 0,
  computedEntries: 0,
  durationCacheHits: 0,
  durationCacheMisses: 0,
};

function inputFingerprint(
  project: LatencyProject,
  mode: SimulationMode,
): string {
  return JSON.stringify([
    project.id,
    mode,
    project.concurrencyLimit,
    project.nodes.map((node) => [
      node.id,
      node.name,
      node.durationMs,
      node.jitterMs,
      node.timeoutMs,
      node.retryCount,
      node.failureRate,
      node.fallbackNodeId ?? null,
      node.dependencyIds,
    ]),
  ]);
}

function durationFingerprint(node: RequestNode, mode: SimulationMode): string {
  return JSON.stringify([
    mode,
    node.durationMs,
    node.jitterMs,
    node.timeoutMs,
    node.retryCount,
    node.failureRate,
  ]);
}

function dependencyKey(node: RequestNode): string {
  return node.dependencyIds.join("\u0001");
}

function snapshotSlots(slots: SlotState[]): SlotState[] {
  return slots.map((slot) => ({ ...slot }));
}

function slotsEqual(
  current: SlotState[],
  previous: SlotState[] | undefined,
): boolean {
  if (!previous || current.length !== previous.length) return false;
  return current.every((slot, index) => {
    const before = previous[index];
    return (
      before !== undefined &&
      slot.endMs === before.endMs &&
      slot.nodeId === before.nodeId
    );
  });
}

function entriesEqual(a: TimelineEntry, b: TimelineEntry): boolean {
  return (
    a.nodeId === b.nodeId &&
    a.startMs === b.startMs &&
    a.endMs === b.endMs &&
    a.modeledDurationMs === b.modeledDurationMs &&
    a.waitMs === b.waitMs &&
    a.criticalPredecessorId === b.criticalPredecessorId
  );
}

/**
 * 绑定单个项目的增量推演会话。
 *
 * - 输入完全相同时直接返回上次结果对象，不重复计算；
 * - 节点参数变化时只沿依赖链重算受影响的节点，其余节点复用上次的
 *   时序条目，输出与 simulateProject 整体重算逐节点一致；
 * - 会话只保存一个项目的中间结果：项目 id 变化即全部丢弃，
 *   切换项目后第一次推演必然是整体重算，中间结果不会跨项目串用。
 */
export class SimulationSession {
  private projectId: string | null = null;
  private lastProject: LatencyProject | null = null;
  private lastMode: SimulationMode | null = null;
  private lastFingerprint: string | null = null;
  private lastResult: SimulationResult | null = null;
  private snapshot: ScheduledSnapshot | null = null;
  private durationCache = new Map<string, NodeDurationMemo>();
  private stats: SimulationRunStats = EMPTY_STATS;

  get lastRunStats(): SimulationRunStats {
    return this.stats;
  }

  run(project: LatencyProject, mode: SimulationMode): SimulationResult {
    if (this.projectId !== project.id) this.resetForProject(project.id);
    if (
      this.lastResult &&
      this.lastProject === project &&
      this.lastMode === mode
    ) {
      return this.identical(this.lastResult);
    }
    const fingerprint = inputFingerprint(project, mode);
    if (this.lastResult && fingerprint === this.lastFingerprint) {
      return this.identical(this.lastResult);
    }

    const analysis = analyzeGraph(project);
    if (analysis.validation.errors.length) {
      const result: SimulationResult = {
        mode,
        completionMs: 0,
        criticalPath: [],
        entries: [],
        warnings: analysis.validation.errors,
      };
      this.snapshot = null;
      this.remember(project, mode, fingerprint, result);
      this.stats = EMPTY_STATS;
      return result;
    }

    // 节点级耗时缓存：参数与情境未变的节点不重算期望耗时。
    const baseDurations = new Map<string, number>();
    let durationCacheHits = 0;
    let durationCacheMisses = 0;
    const seenIds = new Set<string>();
    for (const node of project.nodes) {
      seenIds.add(node.id);
      const key = durationFingerprint(node, mode);
      const memo = this.durationCache.get(node.id);
      if (memo && memo.fingerprint === key) {
        baseDurations.set(node.id, memo.value);
        durationCacheHits += 1;
      } else {
        const value = baseDurationMs(node, mode);
        this.durationCache.set(node.id, { fingerprint: key, value });
        baseDurations.set(node.id, value);
        durationCacheMisses += 1;
      }
    }
    for (const id of [...this.durationCache.keys()]) {
      if (!seenIds.has(id)) this.durationCache.delete(id);
    }
    const durations = applyFallbackWeights(project, baseDurations);

    const slotCount = slotCountFor(project);
    const prev = this.snapshot;
    const byId = new Map(project.nodes.map((node) => [node.id, node]));
    // 两次运行槽位都不低于节点数时，必然存在空槽，资源排队不影响
    // 排布，时序条目只是（依赖图, 节点耗时）的纯函数，可按节点 id 复用；
    // 否则槽位会耦合不相关节点，必须沿拓扑位置比对槽位检查点。
    const resourceIndependent = Boolean(
      prev &&
      byId.size === project.nodes.length &&
      slotCount >= project.nodes.length &&
      prev.slotCount >= prev.nodeCount,
    );

    const slots = createSlots(slotCount);
    const entriesById = new Map<string, TimelineEntry>();
    const entries: TimelineEntry[] = [];
    const slotTimeline: SlotState[][] = [];
    const changedIds = new Set<string>();
    let reusedEntries = 0;
    let computedEntries = 0;

    for (let index = 0; index < analysis.order.length; index += 1) {
      const id = analysis.order[index]!;
      const node = byId.get(id);
      if (!node) continue;
      slotTimeline.push(snapshotSlots(slots));
      const duration = durations.get(id) ?? 0;
      const prevEntry = prev
        ? resourceIndependent
          ? prev.entriesById.get(id)
          : prev.order[index] === id
            ? prev.entries[index]
            : undefined
        : undefined;
      const reusable = Boolean(
        prev &&
        prevEntry &&
        prevEntry.nodeId === id &&
        prev.durations.get(id) === duration &&
        prev.dependencyKeys.get(id) === dependencyKey(node) &&
        !node.dependencyIds.some((dependencyId) =>
          changedIds.has(dependencyId),
        ) &&
        (resourceIndependent || slotsEqual(slots, prev.slotTimeline[index])),
      );
      let entry: TimelineEntry;
      if (reusable && prevEntry) {
        entry = prevEntry;
        reusedEntries += 1;
        const slot = chooseSlot(slots);
        slot.endMs = entry.endMs;
        slot.nodeId = id;
      } else {
        const fresh = computeTimelineEntry(node, slots, entriesById, duration);
        computedEntries += 1;
        const candidate = prev?.entriesById.get(id);
        if (candidate && entriesEqual(fresh, candidate)) {
          // 值收敛：传播到此为止，复用旧对象，下游节点不受影响。
          entry = candidate;
          reusedEntries += 1;
        } else {
          entry = fresh;
          changedIds.add(id);
        }
      }
      entries.push(entry);
      recordEntry(entriesById, entry);
    }

    const result = buildSimulationResult(
      project,
      mode,
      entries,
      analysis.validation.warnings,
    );
    this.snapshot = {
      order: analysis.order,
      entries,
      entriesById,
      durations,
      dependencyKeys: new Map(
        project.nodes.map((node) => [node.id, dependencyKey(node)]),
      ),
      slotTimeline,
      slotCount,
      nodeCount: project.nodes.length,
    };
    this.remember(project, mode, fingerprint, result);
    this.stats = {
      status: reusedEntries > 0 ? "incremental" : "full",
      reusedEntries,
      computedEntries,
      durationCacheHits,
      durationCacheMisses,
    };
    return result;
  }

  private resetForProject(projectId: string): void {
    this.projectId = projectId;
    this.lastProject = null;
    this.lastMode = null;
    this.lastFingerprint = null;
    this.lastResult = null;
    this.snapshot = null;
    this.durationCache.clear();
    this.stats = EMPTY_STATS;
  }

  private identical(result: SimulationResult): SimulationResult {
    this.stats = {
      status: "identical",
      reusedEntries: result.entries.length,
      computedEntries: 0,
      durationCacheHits: 0,
      durationCacheMisses: 0,
    };
    return result;
  }

  private remember(
    project: LatencyProject,
    mode: SimulationMode,
    fingerprint: string,
    result: SimulationResult,
  ): void {
    this.lastProject = project;
    this.lastMode = mode;
    this.lastFingerprint = fingerprint;
    this.lastResult = result;
  }
}
