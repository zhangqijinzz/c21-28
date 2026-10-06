import { describe, expect, it } from "vitest";
import { IncrementalSimulationEngine } from "../src/shared/domain/incrementalSimulation";
import { simulateProject } from "../src/shared/domain/simulation";
import type {
  LatencyProject,
  RequestNode,
  SimulationMode,
} from "../src/shared/domain/types";

const names = ["a", "b", "c", "d", "e", "f", "g", "h"];
const numericFields = [
  "durationMs",
  "jitterMs",
  "timeoutMs",
  "retryCount",
  "failureRate",
] as const;

function randomProject(seedValue: number): LatencyProject {
  let seed = seedValue;
  const random = () => {
    seed = (seed * 1_664_525 + 1_013_904_223) % 2 ** 32;
    return seed / 2 ** 32;
  };
  const nodes: RequestNode[] = names.map((id, index) => ({
    id,
    name: id,
    durationMs: Math.floor(random() * 900) + 50,
    jitterMs: Math.floor(random() * 200),
    dependencyIds:
      index === 0
        ? []
        : names
            .slice(0, index)
            .filter(
              (_, dependencyIndex) =>
                random() > 0.62 || dependencyIndex === index - 1,
            ),
    timeoutMs: [0, 500, 900, 1500][Math.floor(random() * 4)] ?? 1500,
    retryCount: Math.floor(random() * 4),
    failureRate: Math.floor(random() * 30),
  }));
  for (const node of nodes) {
    const fallbackIndex = Math.floor(random() * nodes.length);
    const fallback = nodes[fallbackIndex];
    if (fallback && fallback.id !== node.id) node.fallbackNodeId = fallback.id;
  }
  return {
    id: "property-project",
    title: "property",
    nodes,
    concurrencyLimit: [null, 1, 2, 3][Math.floor(random() * 4)] ?? null,
    scenarios: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("incremental simulation equivalence", () => {
  it("matches full recalculation for randomized value and mode changes", () => {
    for (let seedValue = 1; seedValue <= 30; seedValue += 1) {
      let project = randomProject(seedValue);
      const engine = new IncrementalSimulationEngine();
      let nonce = 1;
      let mode: SimulationMode = "expected";
      let evaluation = engine.evaluate(project, mode, { nonce });
      expect(evaluation.result).toEqual(simulateProject(project, mode));

      for (let step = 0; step < 12; step += 1) {
        const roll = (seedValue * 31 + step * 17) % 7;
        if (roll === 0) {
          mode =
            mode === "expected" ? "high" : mode === "high" ? "low" : "expected";
        } else {
          const nodeIndex = (seedValue + step * 3) % project.nodes.length;
          const node = project.nodes[nodeIndex];
          if (!node) continue;
          const field =
            numericFields[(seedValue + step) % numericFields.length]!;
          const values =
            field === "retryCount"
              ? [0, 1, 2, 3, 4]
              : field === "failureRate"
                ? [0, 5, 15, 40]
                : field === "timeoutMs"
                  ? [0, 600, 1200, 2000]
                  : [80, 260, 620, 1200];
          const value = values[(seedValue + step * 2) % values.length]!;
          project = {
            ...project,
            nodes: project.nodes.map((item) =>
              item.id === node.id ? { ...item, [field]: value } : item,
            ),
          };
          evaluation = engine.evaluate(project, mode, {
            nonce: ++nonce,
            changedNodeIds: [node.id],
          });
          expect(
            evaluation.result,
            `seed ${seedValue}, step ${step}, field ${field}`,
          ).toEqual(simulateProject(project, mode));
          continue;
        }

        evaluation = engine.evaluate(project, mode, { nonce: ++nonce });
        expect(
          evaluation.result,
          `seed ${seedValue}, step ${step}, mode`,
        ).toEqual(simulateProject(project, mode));
      }
    }
  });
});
