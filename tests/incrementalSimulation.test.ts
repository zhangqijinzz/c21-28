import { describe, expect, it } from "vitest";
import { SimulationSession } from "../src/shared/domain/incrementalSimulation";
import { simulateProject } from "../src/shared/domain/simulation";
import {
  EXAMPLE_PROJECT,
  type LatencyProject,
  type RequestNode,
  type SimulationMode,
} from "../src/shared/domain/types";
import {
  addRequestNode,
  patchRequestNode,
  removeRequestNode,
  setConcurrency,
  toggleDependency,
} from "../src/features/graph-editor/graphViewModel";

const modes: SimulationMode[] = ["low", "expected", "high"];

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomProject(rand: () => number, id: string): LatencyProject {
  const count = 2 + Math.floor(rand() * 10);
  const nodes: RequestNode[] = [];
  for (let index = 0; index < count; index += 1) {
    const dependencyIds = nodes
      .filter(() => rand() < 0.35)
      .map((node) => node.id);
    const fallbackPool = nodes[Math.floor(rand() * nodes.length)];
    nodes.push({
      id: `node-${id}-${index}-${Math.floor(rand() * 1e9)}`,
      name: `节点${index}`,
      durationMs: Math.floor(rand() * 900),
      jitterMs: Math.floor(rand() * 300),
      dependencyIds,
      timeoutMs: rand() < 0.8 ? 500 + Math.floor(rand() * 1500) : 0,
      retryCount: Math.floor(rand() * 4),
      failureRate: Math.floor(rand() * 60),
      ...(rand() < 0.25 && fallbackPool
        ? { fallbackNodeId: fallbackPool.id }
        : {}),
    });
  }
  return {
    id,
    title: "随机链路",
    nodes,
    concurrencyLimit: rand() < 0.5 ? null : 1 + Math.floor(rand() * 4),
    scenarios: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

function mutateProject(
  project: LatencyProject,
  rand: () => number,
): LatencyProject {
  const nodes = project.nodes;
  const roll = rand();
  if (roll < 0.45 && nodes.length) {
    const target = nodes[Math.floor(rand() * nodes.length)]!;
    if (rand() < 0.15)
      return patchRequestNode(project, target.id, {
        name: `改名${Math.floor(rand() * 100)}`,
      });
    const fields = [
      "durationMs",
      "jitterMs",
      "timeoutMs",
      "retryCount",
      "failureRate",
    ] as const;
    const field = fields[Math.floor(rand() * fields.length)]!;
    const patch: Partial<RequestNode> = {};
    patch[field] =
      field === "retryCount"
        ? Math.floor(rand() * 5)
        : Math.floor(rand() * 1000);
    return patchRequestNode(project, target.id, patch);
  }
  if (roll < 0.6 && nodes.length > 1) {
    const owner = nodes[Math.floor(rand() * nodes.length)]!;
    const dependency = nodes[Math.floor(rand() * nodes.length)]!;
    if (owner.id === dependency.id) return project;
    const outcome = toggleDependency(project, owner.id, dependency.id);
    return outcome.error ? project : outcome.project;
  }
  if (roll < 0.7)
    return setConcurrency(
      project,
      rand() < 0.5 ? null : 1 + Math.floor(rand() * 4),
    );
  if (roll < 0.8) return addRequestNode(project);
  if (roll < 0.9 && nodes.length > 1)
    return removeRequestNode(
      project,
      nodes[Math.floor(rand() * nodes.length)]!.id,
    );
  if (nodes.length > 1) {
    const owner = nodes[Math.floor(rand() * nodes.length)]!;
    const target = nodes[Math.floor(rand() * nodes.length)]!;
    return patchRequestNode(project, owner.id, {
      fallbackNodeId: target.id === owner.id ? undefined : target.id,
    });
  }
  return project;
}

describe("incremental simulation session", () => {
  it("returns the cached result object for identical inputs", () => {
    const session = new SimulationSession();
    const project = structuredClone(EXAMPLE_PROJECT);
    const first = session.run(project, "expected");
    expect(session.lastRunStats.status).toBe("full");
    expect(session.run(project, "expected")).toBe(first);
    expect(session.lastRunStats.status).toBe("identical");
    expect(session.lastRunStats.computedEntries).toBe(0);
    // 内容相同但引用不同（例如重新解析过的文档）同样命中
    expect(session.run(structuredClone(project), "expected")).toBe(first);
    expect(session.lastRunStats.status).toBe("identical");
  });

  it("recomputes only affected nodes when one parameter changes", () => {
    const session = new SimulationSession();
    const project = structuredClone(EXAMPLE_PROJECT);
    const first = session.run(project, "expected");
    const patched = patchRequestNode(project, "catalog", { durationMs: 980 });
    const second = session.run(patched, "expected");
    expect(second).toEqual(simulateProject(patched, "expected"));
    // catalog 自身 + 以它为降级目标的 recommend，其余节点复用
    expect(session.lastRunStats.computedEntries).toBe(2);
    expect(session.lastRunStats.reusedEntries).toBe(3);
    const before = new Map(first.entries.map((entry) => [entry.nodeId, entry]));
    for (const entry of second.entries) {
      if (["session", "flags", "profile"].includes(entry.nodeId))
        expect(entry).toBe(before.get(entry.nodeId));
    }
  });

  it("reuses every entry for name-only edits and stays consistent", () => {
    const session = new SimulationSession();
    const project = structuredClone(EXAMPLE_PROJECT);
    session.run(project, "expected");
    const renamed = patchRequestNode(project, "session", {
      name: "会话校验 v2",
    });
    const result = session.run(renamed, "expected");
    expect(session.lastRunStats.computedEntries).toBe(0);
    expect(session.lastRunStats.reusedEntries).toBe(project.nodes.length);
    expect(result).toEqual(simulateProject(renamed, "expected"));
  });

  it("matches full recomputation across edit kinds", () => {
    const base = structuredClone(EXAMPLE_PROJECT);
    const edits: ((project: LatencyProject) => LatencyProject)[] = [
      (project) => patchRequestNode(project, "profile", { jitterMs: 400 }),
      (project) => patchRequestNode(project, "profile", { timeoutMs: 100 }),
      (project) => patchRequestNode(project, "profile", { retryCount: 4 }),
      (project) => patchRequestNode(project, "profile", { failureRate: 40 }),
      (project) =>
        patchRequestNode(project, "recommend", { fallbackNodeId: "profile" }),
      (project) =>
        patchRequestNode(project, "recommend", { fallbackNodeId: undefined }),
      (project) => toggleDependency(project, "catalog", "flags").project,
      (project) => addRequestNode(project),
      (project) => removeRequestNode(project, "session"),
      (project) => setConcurrency(project, 1),
      (project) => setConcurrency(project, 2),
      (project) => setConcurrency(project, null),
      (project) => ({
        ...project,
        nodes: structuredClone(EXAMPLE_PROJECT.nodes),
      }),
    ];
    for (const edit of edits) {
      const session = new SimulationSession();
      session.run(base, "expected");
      const mutated = edit(base);
      for (const mode of modes) {
        expect(session.run(mutated, mode)).toEqual(
          simulateProject(mutated, mode),
        );
      }
    }
  });

  it("stays exact while the concurrency limit changes back and forth", () => {
    const session = new SimulationSession();
    const base = structuredClone(EXAMPLE_PROJECT);
    let project = base;
    for (const limit of [null, 1, 2, null, 3, 1] as const) {
      project = setConcurrency(project, limit);
      expect(session.run(project, "expected")).toEqual(
        simulateProject(project, "expected"),
      );
      project = patchRequestNode(project, "catalog", {
        durationMs: 600 + (limit ?? 7) * 13,
      });
      expect(session.run(project, "expected")).toEqual(
        simulateProject(project, "expected"),
      );
    }
  });

  it("never carries intermediate results across projects", () => {
    const rand = mulberry32(7);
    const session = new SimulationSession();
    const projectA = randomProject(rand, "a");
    const projectB = randomProject(rand, "b");
    session.run(projectA, "expected");

    const firstB = session.run(projectB, "expected");
    expect(session.lastRunStats.status).toBe("full");
    expect(session.lastRunStats.reusedEntries).toBe(0);
    expect(firstB).toEqual(simulateProject(projectB, "expected"));

    const editedB = patchRequestNode(projectB, projectB.nodes[0]!.id, {
      durationMs: 1234,
    });
    expect(session.run(editedB, "expected")).toEqual(
      simulateProject(editedB, "expected"),
    );

    // 切回 A 也必须整体重算，不能复用 B 的任何中间结果
    const backToA = session.run(projectA, "expected");
    expect(session.lastRunStats.status).toBe("full");
    expect(session.lastRunStats.reusedEntries).toBe(0);
    expect(backToA).toEqual(simulateProject(projectA, "expected"));
  });

  it("matches full recomputation for randomized edit sequences", () => {
    for (const seed of [11, 23, 42]) {
      const rand = mulberry32(seed);
      const session = new SimulationSession();
      let project = randomProject(rand, `seed-${seed}`);
      let mode: SimulationMode = "expected";
      for (let round = 0; round < 60; round += 1) {
        if (rand() < 0.25) mode = modes[Math.floor(rand() * modes.length)]!;
        if (rand() < 0.85) project = mutateProject(project, rand);
        const incremental = session.run(project, mode);
        const full = simulateProject(project, mode);
        expect(incremental).toEqual(full);
        expect(incremental.completionMs).toBe(full.completionMs);
      }
    }
  });

  it("matches full recomputation when edits are applied and reverted", () => {
    const session = new SimulationSession();
    const project = structuredClone(EXAMPLE_PROJECT);
    const baseline = session.run(project, "high");
    const edited = patchRequestNode(project, "recommend", {
      failureRate: 60,
      retryCount: 3,
    });
    expect(session.run(edited, "high")).toEqual(
      simulateProject(edited, "high"),
    );
    const reverted = session.run(project, "high");
    expect(reverted).toEqual(simulateProject(project, "high"));
    expect(reverted).toEqual(baseline);
  });
});
