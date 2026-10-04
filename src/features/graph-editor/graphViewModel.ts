import { analyzeGraph, updateNode } from "../../shared/domain/graph";
import type { GraphAnalysis } from "../../shared/domain/graph";
import type { LatencyProject, RequestNode } from "../../shared/domain/types";

export type EditableNodeField =
  | "name"
  | "durationMs"
  | "jitterMs"
  | "timeoutMs"
  | "retryCount"
  | "failureRate";

export function getGraphAnalysis(project: LatencyProject): GraphAnalysis {
  return analyzeGraph(project);
}

export function addRequestNode(project: LatencyProject): LatencyProject {
  const index = project.nodes.length + 1;
  const node: RequestNode = {
    id: crypto.randomUUID(),
    name: `请求节点 ${index}`,
    durationMs: 400,
    jitterMs: 80,
    dependencyIds: [],
    timeoutMs: 1200,
    retryCount: 0,
    failureRate: 0,
  };
  return { ...project, nodes: [...project.nodes, node], updatedAt: Date.now() };
}

export function patchRequestNode(
  project: LatencyProject,
  id: string,
  patch: Partial<RequestNode>,
): LatencyProject {
  return {
    ...project,
    nodes: updateNode(project.nodes, id, patch),
    updatedAt: Date.now(),
  };
}

export function removeRequestNode(
  project: LatencyProject,
  id: string,
): LatencyProject {
  return {
    ...project,
    nodes: project.nodes
      .filter((node) => node.id !== id)
      .map((node) => ({
        ...node,
        dependencyIds: node.dependencyIds.filter(
          (dependencyId) => dependencyId !== id,
        ),
        fallbackNodeId:
          node.fallbackNodeId === id ? undefined : node.fallbackNodeId,
      })),
    updatedAt: Date.now(),
  };
}

export function toggleDependency(
  project: LatencyProject,
  nodeId: string,
  dependencyId: string,
): { project: LatencyProject; error?: string } {
  if (nodeId === dependencyId) return { project, error: "节点不能依赖自身" };
  const node = project.nodes.find((item) => item.id === nodeId);
  if (!node) return { project, error: "没有找到当前节点" };
  const dependencyIds = node.dependencyIds.includes(dependencyId)
    ? node.dependencyIds.filter((id) => id !== dependencyId)
    : [...node.dependencyIds, dependencyId];
  const next = {
    ...project,
    nodes: updateNode(project.nodes, nodeId, { dependencyIds }),
    updatedAt: Date.now(),
  };
  const cycle = analyzeGraph(next).cycle;
  return cycle.length
    ? { project, error: "这条连线会形成循环依赖，已撤销" }
    : { project: next };
}

export function setConcurrency(
  project: LatencyProject,
  value: number | null,
): LatencyProject {
  return { ...project, concurrencyLimit: value, updatedAt: Date.now() };
}
