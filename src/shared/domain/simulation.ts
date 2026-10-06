import {
  analyzeProjectGraph,
  validateNode,
  type DetailedGraphAnalysis,
} from "./graph";
import type {
  LatencyProject,
  RequestNode,
  SimulationMode,
  SimulationResult,
  TimelineEntry,
  ValidationResult,
} from "./types";

export const TIMEOUT_WARNING = "部分节点会触发超时截断，已计入重试与退避预算";

interface SchedulerSlot {
  endMs: number;
  nodeId?: string;
  order: number[];
}

export interface SchedulerState {
  slots: SchedulerSlot[];
  entriesByOrder: TimelineEntry[];
  orderIndex: Map<string, number>;
}

export function jitterFactor(mode: SimulationMode): number {
  return mode === "low" ? 0 : mode === "high" ? 1 : 0.5;
}

export function expectedAttempts(
  node: RequestNode,
  mode: SimulationMode,
): number {
  const jitter = jitterFactor(mode);
  const serviceMs = Math.min(
    node.durationMs + node.jitterMs * jitter,
    node.timeoutMs || Number.POSITIVE_INFINITY,
  );
  const failure = node.failureRate / 100;
  let elapsed = 0;
  let priorFailures = 1;
  for (let attempt = 0; attempt <= node.retryCount; attempt += 1) {
    elapsed += priorFailures * serviceMs;
    priorFailures *= failure;
    if (attempt < node.retryCount)
      elapsed += priorFailures * Math.min(200 * 2 ** attempt, 2_000);
  }
  return elapsed;
}

export function modeledDuration(
  node: RequestNode,
  fallback: RequestNode | undefined,
  baseDurations: Map<string, number>,
  mode: SimulationMode,
): number {
  const base = expectedAttempts(node, mode);
  if (!fallback) return base;
  const terminalFailure = (node.failureRate / 100) ** (node.retryCount + 1);
  return base + (baseDurations.get(fallback.id) ?? 0) * terminalFailure;
}

export function timeoutWarningCount(
  project: LatencyProject,
  mode: SimulationMode,
): number {
  const jitter = jitterFactor(mode);
  return project.nodes.reduce(
    (count, node) =>
      node.timeoutMs > 0 &&
      node.durationMs + node.jitterMs * jitter > node.timeoutMs
        ? count + 1
        : count,
    0,
  );
}

export function createSchedulerState(
  analysis: Pick<DetailedGraphAnalysis, "order">,
  concurrency: number,
): SchedulerState {
  return {
    slots: Array.from({ length: Math.max(1, concurrency) }, () => ({
      endMs: 0,
      nodeId: undefined,
      order: [],
    })),
    entriesByOrder: new Array(analysis.order.length),
    orderIndex: new Map(analysis.order.map((id, index) => [id, index])),
  };
}

export function scheduleNodeAt(
  state: SchedulerState,
  orderIndex: number,
  id: string,
  project: LatencyProject,
  durations: Map<string, number>,
): TimelineEntry {
  const node = project.nodes.find((item) => item.id === id);
  const slot = state.slots.reduce(
    (best, candidate) => (candidate.endMs < best.endMs ? candidate : best),
    state.slots[0]!,
  );
  let latestDependency: TimelineEntry | undefined;
  for (const dependencyId of node?.dependencyIds ?? []) {
    const dependencyOrder = state.orderIndex.get(dependencyId);
    if (dependencyOrder === undefined || dependencyOrder >= orderIndex)
      continue;
    const entry = state.entriesByOrder[dependencyOrder];
    if (entry && (!latestDependency || entry.endMs > latestDependency.endMs))
      latestDependency = entry;
  }
  const startMs = Math.max(slot.endMs, latestDependency?.endMs ?? 0);
  const resourceBlocked = slot.endMs > (latestDependency?.endMs ?? 0);
  const predecessor = resourceBlocked ? slot.nodeId : latestDependency?.nodeId;
  const modeledDurationMs = durations.get(id) ?? 0;
  const endMs = startMs + modeledDurationMs;
  const entry: TimelineEntry = {
    nodeId: id,
    startMs,
    endMs,
    modeledDurationMs,
    waitMs: Math.max(0, startMs - (latestDependency?.endMs ?? 0)),
    ...(predecessor ? { criticalPredecessorId: predecessor } : {}),
  };
  state.entriesByOrder[orderIndex] = entry;
  slot.endMs = endMs;
  slot.nodeId = id;
  slot.order.push(orderIndex);
  return entry;
}

export function runScheduler(
  project: LatencyProject,
  analysis: DetailedGraphAnalysis,
  durations: Map<string, number>,
  state: SchedulerState = createSchedulerState(
    analysis,
    Math.max(
      1,
      Math.min(
        project.concurrencyLimit ?? Math.max(1, project.nodes.length),
        project.nodes.length || 1,
      ),
    ),
  ),
): {
  entries: TimelineEntry[];
  lastEntry?: TimelineEntry;
  state: SchedulerState;
} {
  const entries: TimelineEntry[] = [];
  let lastEntry: TimelineEntry | undefined;
  for (let index = 0; index < analysis.order.length; index += 1) {
    const id = analysis.order[index];
    if (!id) continue;
    const entry = scheduleNodeAt(state, index, id, project, durations);
    entries.push(entry);
    if (!lastEntry || entry.endMs > lastEntry.endMs) lastEntry = entry;
  }
  return { entries, lastEntry, state };
}

export function criticalPathFromEntry(
  entries: TimelineEntry[],
  lastEntry?: TimelineEntry,
): string[] {
  if (!lastEntry) return [];
  const byId = new Map(entries.map((entry) => [entry.nodeId, entry]));
  const path: string[] = [];
  let current: TimelineEntry | undefined = lastEntry;
  while (current) {
    path.unshift(current.nodeId);
    current = current.criticalPredecessorId
      ? byId.get(current.criticalPredecessorId)
      : undefined;
  }
  return path;
}

export function simulationWarnings(
  analysis: DetailedGraphAnalysis,
  project: LatencyProject,
  mode: SimulationMode,
): string[] {
  return [
    ...analysis.validation.warnings,
    ...(timeoutWarningCount(project, mode) > 0 ? [TIMEOUT_WARNING] : []),
  ];
}

export function simulateProject(
  project: LatencyProject,
  mode: SimulationMode = "expected",
): SimulationResult {
  const analysis = analyzeProjectGraph(project);
  if (analysis.validation.errors.length) {
    return {
      mode,
      completionMs: 0,
      criticalPath: [],
      entries: [],
      warnings: analysis.validation.errors,
    };
  }

  const byId = new Map(project.nodes.map((node) => [node.id, node]));
  const baseDurations = new Map(
    project.nodes.map((node) => [node.id, expectedAttempts(node, mode)]),
  );
  const durations = new Map(
    project.nodes.map((node) => [
      node.id,
      modeledDuration(
        node,
        node.fallbackNodeId ? byId.get(node.fallbackNodeId) : undefined,
        baseDurations,
        mode,
      ),
    ]),
  );
  const { entries, lastEntry } = runScheduler(project, analysis, durations);
  return {
    mode,
    completionMs: lastEntry?.endMs ?? 0,
    criticalPath: criticalPathFromEntry(entries, lastEntry),
    entries,
    warnings: simulationWarnings(analysis, project, mode),
  };
}

export function validateProjectNode(
  node: RequestNode,
  project: LatencyProject,
): ValidationResult {
  return validateNode(node, new Set(project.nodes.map((item) => item.id)));
}
