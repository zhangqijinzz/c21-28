import {
  analyzeProjectGraph,
  buildGraphValidation,
  validateNode,
  type DetailedGraphAnalysis,
} from "./graph";
import {
  TIMEOUT_WARNING,
  createSchedulerState,
  criticalPathFromEntry,
  expectedAttempts,
  jitterFactor,
  modeledDuration,
  runScheduler,
  scheduleNodeAt,
  type SchedulerState,
} from "./simulation";
import type {
  LatencyProject,
  RequestNode,
  SimulationMode,
  SimulationResult,
  TimelineEntry,
} from "./types";

export interface IncrementalChange {
  nonce: number;
  changedNodeIds?: readonly string[];
  structure?: boolean;
  fullSimulation?: boolean;
}

export interface Evaluation {
  analysis: DetailedGraphAnalysis;
  result: SimulationResult;
}

type ReverseEdges = Map<string, Set<string>>;

function buildReverseEdges(
  project: LatencyProject,
  getTargetIds: (node: RequestNode) => readonly string[] | undefined,
): ReverseEdges {
  const edges = new Map(
    project.nodes.map((node) => [node.id, new Set<string>()]),
  );
  for (const node of project.nodes) {
    for (const targetId of getTargetIds(node) ?? []) {
      edges.get(targetId)?.add(node.id);
    }
  }
  return edges;
}

function timeoutTriggered(node: RequestNode, mode: SimulationMode): boolean {
  return (
    node.timeoutMs > 0 &&
    node.durationMs + node.jitterMs * jitterFactor(mode) > node.timeoutMs
  );
}

function lastIndexBefore(index: number, order: number[]): number {
  let low = 0;
  let high = order.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((order[middle] ?? Number.POSITIVE_INFINITY) < index) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

export class IncrementalSimulationEngine {
  private projectId = "";
  private mode: SimulationMode = "expected";
  private project?: LatencyProject;
  private analysis?: DetailedGraphAnalysis;
  private nodesById = new Map<string, RequestNode>();
  private baseDurations = new Map<string, number>();
  private durations = new Map<string, number>();
  private dependencyDependents: ReverseEdges = new Map();
  private fallbackDependents: ReverseEdges = new Map();
  private schedulerState?: SchedulerState;
  private lastEntry?: TimelineEntry;
  private criticalPath: string[] = [];
  private timeoutCount = 0;
  private appliedNonce = 0;

  evaluate(
    project: LatencyProject,
    mode: SimulationMode,
    change?: IncrementalChange,
  ): Evaluation {
    if (project.id !== this.projectId) this.reset(project.id);
    if (
      change &&
      change.nonce === this.appliedNonce &&
      mode === this.mode &&
      this.analysis
    )
      return this.current();
    this.appliedNonce = change?.nonce ?? ++this.appliedNonce;

    const effectiveChange: IncrementalChange = change ?? {
      nonce: this.appliedNonce + 1,
    };
    const modeChanged = mode !== this.mode;
    if (!this.analysis || !this.project) {
      this.analyzeFully(project);
    } else if (effectiveChange.structure) {
      this.analyzeFully(project);
    } else if (
      !modeChanged &&
      !effectiveChange.fullSimulation &&
      !effectiveChange.changedNodeIds?.length
    ) {
      return this.current();
    }

    const previousMode = this.mode;
    const previousProject = this.project;
    const currentAnalysis =
      effectiveChange.changedNodeIds?.length && !effectiveChange.structure
        ? this.updateAnalysis(project, effectiveChange.changedNodeIds)
        : this.analysis;
    if (!currentAnalysis) {
      this.analyzeFully(project);
      return this.evaluate(project, mode, effectiveChange);
    }

    if (currentAnalysis.validation.errors.length) {
      this.project = project;
      this.mode = mode;
      this.schedulerState = undefined;
      this.lastEntry = undefined;
      this.criticalPath = [];
      return {
        analysis: currentAnalysis,
        result: this.errorResult(mode),
      };
    }

    this.mode = mode;
    if (modeChanged) {
      this.timeoutCount = project.nodes.reduce(
        (count, node) => count + (timeoutTriggered(node, mode) ? 1 : 0),
        0,
      );
    }

    if (
      modeChanged ||
      !this.schedulerState ||
      !previousProject ||
      effectiveChange.structure ||
      effectiveChange.fullSimulation
    ) {
      this.simulateFully(project, mode, currentAnalysis);
      return this.current();
    }
    if (effectiveChange.changedNodeIds?.length) {
      this.simulateIncrement(
        project,
        mode,
        effectiveChange.changedNodeIds,
        previousMode,
        previousProject,
      );
    } else {
      this.project = project;
      this.mode = mode;
      this.reuseSchedule(mode);
    }
    return this.current();
  }

  private reset(projectId: string): void {
    this.projectId = projectId;
    this.mode = "expected";
    this.project = undefined;
    this.analysis = undefined;
    this.nodesById = new Map();
    this.baseDurations = new Map();
    this.durations = new Map();
    this.dependencyDependents = new Map();
    this.fallbackDependents = new Map();
    this.schedulerState = undefined;
    this.lastEntry = undefined;
    this.criticalPath = [];
    this.timeoutCount = 0;
    this.appliedNonce = 0;
  }

  private current(): Evaluation {
    if (!this.analysis) throw new Error("Simulation engine has no analysis");
    const result: SimulationResult = this.schedulerState
      ? {
          mode: this.mode,
          completionMs: this.lastEntry?.endMs ?? 0,
          criticalPath: [...this.criticalPath],
          entries: [...this.schedulerState.entriesByOrder],
          warnings: this.successfulWarnings(),
        }
      : this.errorResult(this.mode);
    return { analysis: this.analysis, result };
  }

  private errorResult(mode: SimulationMode): SimulationResult {
    return {
      mode,
      completionMs: 0,
      criticalPath: [],
      entries: [],
      warnings: this.analysis?.validation.errors ?? [],
    };
  }

  private successfulWarnings(): string[] {
    return [
      ...(this.analysis?.validation.warnings ?? []),
      ...(this.timeoutCount > 0 ? [TIMEOUT_WARNING] : []),
    ];
  }

  private analyzeFully(project: LatencyProject): void {
    this.analysis = analyzeProjectGraph(project);
  }

  private updateAnalysis(
    project: LatencyProject,
    changedNodeIds: readonly string[],
  ): DetailedGraphAnalysis {
    if (!this.analysis || !this.project) {
      const full = analyzeProjectGraph(project);
      this.analysis = full;
      return full;
    }

    const previous = this.analysis;
    const nodeIds = new Set(project.nodes.map((node) => node.id));
    const nodeIssues = new Map(previous.nodeIssues);
    for (const id of changedNodeIds) {
      const node = project.nodes.find((item) => item.id === id);
      if (node) nodeIssues.set(id, validateNode(node, nodeIds));
    }
    const updated: DetailedGraphAnalysis = {
      ...previous,
      nodeIssues,
      validation: buildGraphValidation(
        project,
        previous,
        nodeIssues,
        previous.hasMultipleEntries,
      ),
    };
    this.analysis = updated;
    return updated;
  }

  private simulateFully(
    project: LatencyProject,
    mode: SimulationMode,
    analysis: DetailedGraphAnalysis,
  ): void {
    this.analysis = analysis;
    this.nodesById = new Map(project.nodes.map((node) => [node.id, node]));
    this.project = project;
    this.baseDurations = new Map(
      project.nodes.map((node) => [node.id, expectedAttempts(node, mode)]),
    );
    this.durations = new Map(
      project.nodes.map((node) => [
        node.id,
        modeledDuration(
          node,
          node.fallbackNodeId
            ? this.nodesById.get(node.fallbackNodeId)
            : undefined,
          this.baseDurations,
          mode,
        ),
      ]),
    );
    this.dependencyDependents = buildReverseEdges(
      project,
      (node) => node.dependencyIds,
    );
    this.fallbackDependents = buildReverseEdges(project, (node) =>
      node.fallbackNodeId ? [node.fallbackNodeId] : [],
    );
    const concurrency = Math.max(
      1,
      Math.min(
        project.concurrencyLimit ?? Math.max(1, project.nodes.length),
        project.nodes.length || 1,
      ),
    );
    this.schedulerState = createSchedulerState(this.analysis, concurrency);
    const scheduled = runScheduler(
      project,
      this.analysis,
      this.durations,
      this.schedulerState,
    );
    this.lastEntry = scheduled.lastEntry;
    this.criticalPath = criticalPathFromEntry(
      scheduled.entries,
      scheduled.lastEntry,
    );
    this.timeoutCount = project.nodes.reduce(
      (count, node) => count + (timeoutTriggered(node, mode) ? 1 : 0),
      0,
    );
  }

  private simulateIncrement(
    project: LatencyProject,
    mode: SimulationMode,
    changedNodeIds: readonly string[],
    previousMode: SimulationMode,
    previousProject: LatencyProject,
  ): void {
    if (!this.analysis || !this.schedulerState) return;
    const analysis = this.analysis;
    const previousNodes = new Map(
      previousProject.nodes.map((node) => [node.id, node]),
    );
    const currentNodes = new Map(project.nodes.map((node) => [node.id, node]));
    let timeoutCount = this.timeoutCount;
    const durationDirty = new Set<string>();
    for (const id of changedNodeIds) {
      const previous = previousNodes.get(id);
      const current = currentNodes.get(id);
      if (!previous || !current) {
        this.simulateFully(project, mode, analysis);
        return;
      }
      timeoutCount +=
        Number(timeoutTriggered(current, mode)) -
        Number(timeoutTriggered(previous, previousMode));
      const oldBase = this.baseDurations.get(id) ?? 0;
      const newBase = expectedAttempts(current, mode);
      if (oldBase !== newBase) this.baseDurations.set(id, newBase);
    }

    for (const id of changedNodeIds) {
      const previousFallback = previousNodes.get(id)?.fallbackNodeId;
      if (previousFallback)
        this.fallbackDependents.get(previousFallback)?.delete(id);
      const currentFallback = currentNodes.get(id)?.fallbackNodeId;
      if (currentFallback)
        this.fallbackDependents.get(currentFallback)?.add(id);
    }

    const recomputeIds = new Set(changedNodeIds);
    for (const id of changedNodeIds) {
      for (const dependentId of this.fallbackDependents.get(id) ?? [])
        recomputeIds.add(dependentId);
    }
    for (const id of recomputeIds) {
      const node = currentNodes.get(id);
      if (!node) continue;
      const previousDuration = this.durations.get(id) ?? 0;
      const nextDuration = modeledDuration(
        node,
        node.fallbackNodeId ? currentNodes.get(node.fallbackNodeId) : undefined,
        this.baseDurations,
        mode,
      );
      this.durations.set(id, nextDuration);
      if (previousDuration !== nextDuration) durationDirty.add(id);
    }

    this.nodesById = currentNodes;
    this.project = project;
    this.timeoutCount = Math.max(0, timeoutCount);

    if (!durationDirty.size) {
      this.resultWithCurrentWarnings(mode);
      return;
    }

    const affected = new Set<string>();
    const visit = (id: string): void => {
      if (affected.has(id)) return;
      affected.add(id);
      for (const dependentId of this.dependencyDependents.get(id) ?? [])
        visit(dependentId);
    };
    durationDirty.forEach(visit);

    let firstDirty = Number.POSITIVE_INFINITY;
    for (const id of affected) {
      const index = this.schedulerState.orderIndex.get(id);
      if (index !== undefined) firstDirty = Math.min(firstDirty, index);
    }
    if (!Number.isFinite(firstDirty)) {
      this.resultWithCurrentWarnings(mode);
      return;
    }

    this.replayFrom(project, firstDirty);
  }

  private replayFrom(project: LatencyProject, firstDirty: number): void {
    if (!this.analysis || !this.schedulerState) return;
    const state = this.schedulerState;
    let prefixLast: TimelineEntry | undefined;
    for (const slot of state.slots) {
      const boundary = lastIndexBefore(firstDirty, slot.order);
      if (boundary < 0) {
        slot.endMs = 0;
        slot.nodeId = undefined;
        slot.order = [];
        continue;
      }
      const orderIndex = slot.order[boundary];
      if (orderIndex === undefined) continue;
      const entry = state.entriesByOrder[orderIndex];
      if (!entry) continue;
      slot.endMs = entry.endMs;
      slot.nodeId = entry.nodeId;
      slot.order = slot.order.slice(0, boundary + 1);
      if (
        !prefixLast ||
        entry.endMs > prefixLast.endMs ||
        (entry.endMs === prefixLast.endMs &&
          orderIndex < firstDirty &&
          (state.orderIndex.get(prefixLast.nodeId) ??
            Number.POSITIVE_INFINITY) > orderIndex)
      )
        prefixLast = entry;
    }

    let lastEntry = prefixLast;
    for (
      let index = firstDirty;
      index < this.analysis.order.length;
      index += 1
    ) {
      const id = this.analysis.order[index];
      if (!id) continue;
      const scheduled = scheduleNodeAt(
        state,
        index,
        id,
        project,
        this.durations,
      );
      if (!lastEntry || scheduled.endMs > lastEntry.endMs)
        lastEntry = scheduled;
    }
    this.lastEntry = lastEntry;
    this.criticalPath = criticalPathFromEntry(
      [...state.entriesByOrder],
      lastEntry,
    );
  }

  private resultWithCurrentWarnings(mode: SimulationMode): void {
    this.mode = mode;
  }

  private reuseSchedule(mode: SimulationMode): void {
    this.mode = mode;
  }
}
