import { describe, expect, it } from "vitest";
import { IncrementalSimulationEngine } from "../src/shared/domain/incrementalSimulation";
import { analyzeGraph } from "../src/shared/domain/graph";
import { simulateProject } from "../src/shared/domain/simulation";
import {
  EXAMPLE_PROJECT,
  type LatencyProject,
} from "../src/shared/domain/types";

function patchNode(
  project: LatencyProject,
  id: string,
  patch: Partial<LatencyProject["nodes"][number]>,
): LatencyProject {
  return {
    ...project,
    nodes: project.nodes.map((node) =>
      node.id === id ? { ...node, ...patch } : node,
    ),
  };
}

describe("incremental simulation engine", () => {
  it("returns exactly the same result as a full simulation after node value edits", () => {
    const engine = new IncrementalSimulationEngine();
    const initial = structuredClone(EXAMPLE_PROJECT);
    const first = engine.evaluate(initial, "expected", { nonce: 1 });

    expect(first.result).toEqual(simulateProject(initial, "expected"));
    expect(first.analysis).toMatchObject(analyzeGraph(initial));

    const slower = patchNode(initial, "profile", { durationMs: 680 });
    const incremental = engine.evaluate(slower, "expected", {
      nonce: 2,
      changedNodeIds: ["profile"],
    });

    expect(incremental.result).toEqual(simulateProject(slower, "expected"));

    const withFallbackChange = patchNode(slower, "recommend", {
      failureRate: 20,
    });
    const later = engine.evaluate(withFallbackChange, "expected", {
      nonce: 3,
      changedNodeIds: ["recommend"],
    });
    expect(later.result).toEqual(
      simulateProject(withFallbackChange, "expected"),
    );
  });

  it("replays only scheduling suffixes and preserves untouched prefix entries", () => {
    const engine = new IncrementalSimulationEngine();
    const serial = {
      ...structuredClone(EXAMPLE_PROJECT),
      concurrencyLimit: 1,
    };
    const initial = engine.evaluate(serial, "expected", {
      nonce: 1,
      fullSimulation: true,
    });
    const changed = patchNode(serial, "session", { durationMs: 400 });
    const updated = engine.evaluate(changed, "expected", {
      nonce: 2,
      changedNodeIds: ["session"],
    });

    expect(updated.result).toEqual(simulateProject(changed, "expected"));
    expect(updated.result.entries[0]).not.toBe(initial.result.entries[0]);
  });

  it("returns the same values when an edit does not affect calculations", () => {
    const engine = new IncrementalSimulationEngine();
    const initialProject = structuredClone(EXAMPLE_PROJECT);
    const initial = engine.evaluate(initialProject, "expected", { nonce: 1 });
    const renamed = patchNode(initialProject, "session", {
      name: "登录态校验",
    });
    const updated = engine.evaluate(renamed, "expected", {
      nonce: 2,
      changedNodeIds: ["session"],
    });

    expect(updated.result).toEqual(initial.result);
  });

  it("rebuilds all modes without changing deterministic results", () => {
    const engine = new IncrementalSimulationEngine();
    const project = structuredClone(EXAMPLE_PROJECT);
    engine.evaluate(project, "expected", { nonce: 1 });
    for (const mode of ["low", "expected", "high"] as const) {
      const updated = engine.evaluate(project, mode, { nonce: 2 });
      expect(updated.result).toEqual(simulateProject(project, mode));
    }
  });

  it("does not reuse intermediate state after switching to another project", () => {
    const engine = new IncrementalSimulationEngine();
    const first = structuredClone(EXAMPLE_PROJECT);
    const second: LatencyProject = {
      ...structuredClone(EXAMPLE_PROJECT),
      id: "project-second",
      title: "第二个项目",
      nodes: [
        {
          id: "only",
          name: "唯一请求",
          durationMs: 123,
          jitterMs: 0,
          dependencyIds: [],
          timeoutMs: 500,
          retryCount: 0,
          failureRate: 0,
        },
      ],
    };

    const firstResult = engine.evaluate(first, "expected", { nonce: 1 });
    const secondResult = engine.evaluate(second, "expected", {
      nonce: 2,
      fullSimulation: true,
    });
    expect(secondResult.result).toEqual(simulateProject(second, "expected"));

    const firstAgain = engine.evaluate(first, "expected", {
      nonce: 3,
      fullSimulation: true,
    });
    expect(firstAgain.result).toEqual(firstResult.result);
    expect(firstAgain.result.completionMs).not.toBe(
      secondResult.result.completionMs,
    );
  });

  it("matches full calculations across structural and concurrency changes", () => {
    const engine = new IncrementalSimulationEngine();
    const initial = structuredClone(EXAMPLE_PROJECT);
    engine.evaluate(initial, "expected", { nonce: 1 });
    const withDependency = patchNode(initial, "catalog", {
      dependencyIds: ["session", "flags"],
    });
    const structural = engine.evaluate(withDependency, "expected", {
      nonce: 2,
      structure: true,
      changedNodeIds: ["catalog"],
    });
    expect(structural.result).toEqual(
      simulateProject(withDependency, "expected"),
    );

    const serial = { ...withDependency, concurrencyLimit: 1 };
    const concurrencyChange = engine.evaluate(serial, "expected", {
      nonce: 3,
      fullSimulation: true,
    });
    expect(concurrencyChange.result).toEqual(
      simulateProject(serial, "expected"),
    );
  });

  it("updates validation errors incrementally", () => {
    const engine = new IncrementalSimulationEngine();
    const project = structuredClone(EXAMPLE_PROJECT);
    engine.evaluate(project, "expected", { nonce: 1 });
    const invalid = patchNode(project, "session", { name: " " });
    const evaluated = engine.evaluate(invalid, "expected", {
      nonce: 2,
      changedNodeIds: ["session"],
    });

    expect(evaluated.result.entries).toEqual([]);
    expect(evaluated.result.warnings.join(" ")).toContain("节点名称不能为空");
  });

  it("does not run fallback node calculations more than necessary", () => {
    const engine = new IncrementalSimulationEngine();
    const project = structuredClone(EXAMPLE_PROJECT);
    const initial = engine.evaluate(project, "high", { nonce: 1 });
    const next = patchNode(project, "flags", { name: "开关服务" });
    const updated = engine.evaluate(next, "high", {
      nonce: 2,
      changedNodeIds: ["flags"],
    });

    expect(updated.result).toEqual(initial.result);
  });
});
