import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProjectRepository } from "../../shared/repositories/projectRepository";
import { LastWriteSaveQueue } from "../../shared/repositories/saveQueue";
import type { IncrementalChange } from "../../shared/domain/incrementalSimulation";
import { IncrementalSimulationEngine } from "../../shared/domain/incrementalSimulation";
import type {
  LatencyProject,
  SimulationMode,
  WorkspaceDocument,
} from "../../shared/domain/types";
import {
  createProject,
  duplicateProject,
  renameProject,
  selectProject,
} from "../projects/projectViewModel";
import {
  addRequestNode,
  patchRequestNode,
  removeRequestNode,
  setConcurrency,
  toggleDependency,
} from "../graph-editor/graphViewModel";
import {
  compareScenarios,
  removeScenario,
  restoreScenario,
  saveScenario,
  type ScenarioComparison,
} from "../scenarios/scenarioViewModel";
import { removeProject, updateProject } from "../projects/projectViewModel";

export type LabStatus =
  "loading" | "ready" | "editing" | "simulating" | "error" | "completed";
export type LabModule =
  "projects" | "graph" | "simulation" | "scenarios" | "archive";

function structuralNodeChange(
  previous: LatencyProject | undefined,
  next: LatencyProject,
): boolean {
  if (!previous || previous.nodes.length !== next.nodes.length) return true;
  if (previous.nodes.some((node, index) => node.id !== next.nodes[index]?.id))
    return true;
  const previousById = new Map(previous.nodes.map((node) => [node.id, node]));
  return next.nodes.some((node) => {
    const old = previousById.get(node.id);
    return !old || old.dependencyIds.join("|") !== node.dependencyIds.join("|");
  });
}

function changedNodeIds(
  previous: LatencyProject | undefined,
  next: LatencyProject,
): string[] {
  const previousById = new Map(previous?.nodes.map((node) => [node.id, node]));
  return next.nodes
    .filter((node) => node !== previousById.get(node.id))
    .map((node) => node.id);
}

function valuePatchTouchesStructure(
  patch: Partial<LatencyProject["nodes"][number]>,
): boolean {
  return (
    Object.prototype.hasOwnProperty.call(patch, "dependencyIds") ||
    Object.prototype.hasOwnProperty.call(patch, "id")
  );
}

export function useLatencyLab() {
  const repository = useMemo(() => new ProjectRepository(), []);
  const [document, setDocument] = useState<WorkspaceDocument | null>(null);
  const documentRef = useRef<WorkspaceDocument | null>(null);
  const savedDocumentRef = useRef<WorkspaceDocument | null>(null);
  const activeProjectRef = useRef<LatencyProject | undefined>(undefined);
  const simulationValidRef = useRef(false);
  const [status, setStatus] = useState<LabStatus>("loading");
  const [module, setModule] = useState<LabModule>("simulation");
  const [mode, setMode] = useState<SimulationMode>("expected");
  const [comparisonIds, setComparisonIds] = useState<{
    baselineId: string;
    comparisonId: string;
  }>({ baselineId: "", comparisonId: "" });
  const [notice, setNotice] = useState("");
  const [persisted, setPersisted] = useState<"saving" | "saved" | "error">(
    "saved",
  );
  const revision = useRef(0);
  const changeNonce = useRef(0);
  const pendingChange = useRef<IncrementalChange | undefined>(undefined);
  const saveQueue = useMemo(
    () =>
      new LastWriteSaveQueue(
        (nextDocument) => repository.save(nextDocument),
        (saveStatus) => {
          setPersisted(saveStatus);
          if (saveStatus === "saved") {
            savedDocumentRef.current = documentRef.current;
            setStatus(simulationValidRef.current ? "completed" : "error");
          }
          if (saveStatus === "error") {
            setStatus("error");
            setNotice("保存失败。数据仍保留在当前页面，请重试保存。");
          }
        },
      ),
    [repository],
  );
  const activeProject =
    document?.projects.find(
      (project) => project.id === document.activeProjectId,
    ) ?? document?.projects[0];
  const engine = useMemo(() => new IncrementalSimulationEngine(), []);
  const change = pendingChange.current;
  pendingChange.current = undefined;
  const evaluation = useMemo(
    () =>
      activeProject ? engine.evaluate(activeProject, mode, change) : undefined,
    // The nonce identifies document edits; engine is an explicit incremental cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeProject, mode, engine, change?.nonce],
  );
  const result = evaluation?.result;
  const graphAnalysis = evaluation?.analysis;
  activeProjectRef.current = activeProject;

  const scenarioList = activeProject?.scenarios ?? [];
  const baselineScenario =
    scenarioList.find((scenario) => scenario.id === comparisonIds.baselineId) ??
    scenarioList[1] ??
    scenarioList[0];
  const comparisonScenario =
    scenarioList.find(
      (scenario) => scenario.id === comparisonIds.comparisonId,
    ) ?? scenarioList[0];
  const scenarioComparison: ScenarioComparison | undefined =
    baselineScenario && comparisonScenario
      ? compareScenarios(baselineScenario, comparisonScenario)
      : undefined;
  const simulationValid =
    Boolean(activeProject) &&
    result?.entries.length === activeProject?.nodes.length;
  simulationValidRef.current = simulationValid;

  useEffect(() => {
    if (!activeProject || !result) return;
    if (result.entries.length !== activeProject.nodes.length)
      setStatus("error");
    else if (status === "simulating") setStatus("completed");
  }, [activeProject, result, status]);

  const selectComparisonScenario = useCallback(
    (side: "baselineId" | "comparisonId", id: string) => {
      setComparisonIds((current) => ({ ...current, [side]: id }));
    },
    [],
  );

  useEffect(() => {
    let mounted = true;
    void repository
      .load()
      .then(({ document: loaded, recovered }) => {
        if (!mounted) return;
        documentRef.current = loaded;
        savedDocumentRef.current = loaded;
        setDocument(loaded);
        setStatus("ready");
        if (recovered)
          setNotice("已载入示例工作区；后续修改会自动保存到此设备。");
      })
      .catch(() => {
        if (!mounted) return;
        setStatus("error");
        setNotice("本地项目读取失败，刷新页面可再次尝试。");
      });
    return () => {
      mounted = false;
    };
  }, [repository]);

  const commit = useCallback(
    (
      next: WorkspaceDocument,
      nextStatus: LabStatus = "editing",
      nextChange?: Omit<IncrementalChange, "nonce">,
    ) => {
      const currentRevision = ++revision.current;
      const nonce = ++changeNonce.current;
      pendingChange.current = { nonce, ...nextChange };
      documentRef.current = next;
      setDocument(next);
      if (nextStatus !== "ready") setStatus(nextStatus);
      setNotice("");
      setPersisted("saving");
      saveQueue.save(currentRevision, next);
    },
    [saveQueue],
  );

  const editProject = useCallback(
    (
      project: LatencyProject,
      changeHint?: Omit<IncrementalChange, "nonce">,
    ) => {
      const current = documentRef.current;
      if (!current) return;
      const active = activeProjectRef.current;
      const previous = current.projects.find((item) => item.id === project.id);
      const hint =
        changeHint ??
        (project.id === active?.id
          ? {
              structure: structuralNodeChange(previous, project),
              changedNodeIds: changedNodeIds(previous, project),
            }
          : undefined);
      commit(updateProject(current, project), "editing", hint);
    },
    [commit],
  );

  const chooseProject = useCallback(
    (id: string) => {
      const current = documentRef.current;
      if (current)
        commit(selectProject(current, id), "ready", { fullSimulation: true });
    },
    [commit],
  );

  const newProject = useCallback(() => {
    const current = documentRef.current;
    if (current) commit(createProject(current), "editing", { structure: true });
  }, [commit]);

  const renameActive = useCallback(
    (title: string) => {
      if (activeProjectRef.current)
        editProject(renameProject(activeProjectRef.current, title));
    },
    [editProject],
  );

  const duplicateActive = useCallback(() => {
    const current = documentRef.current;
    const active = activeProjectRef.current;
    if (current && active)
      commit(duplicateProject(current, active), "editing", { structure: true });
  }, [commit]);

  const deleteProject = useCallback(
    (id: string) => {
      const current = documentRef.current;
      if (current && current.projects.length > 1)
        commit(removeProject(current, id), "editing", { structure: true });
      else setNotice("至少保留一个链路项目。");
    },
    [commit],
  );

  const addNode = useCallback(() => {
    const active = activeProjectRef.current;
    if (active) editProject(addRequestNode(active), { structure: true });
  }, [editProject]);
  const patchNode = useCallback(
    (id: string, patch: Parameters<typeof patchRequestNode>[2]) => {
      const active = activeProjectRef.current;
      if (!active) return;
      editProject(patchRequestNode(active, id, patch), {
        changedNodeIds: [id],
        structure: valuePatchTouchesStructure(patch),
      });
    },
    [editProject],
  );
  const deleteNode = useCallback(
    (id: string) => {
      const active = activeProjectRef.current;
      if (active)
        editProject(removeRequestNode(active, id), {
          structure: true,
          changedNodeIds: active.nodes
            .filter((node) => node.id === id || node.dependencyIds.includes(id))
            .map((node) => node.id),
        });
    },
    [editProject],
  );
  const setNodeDependency = useCallback(
    (id: string, dependencyId: string) => {
      const active = activeProjectRef.current;
      if (!active) return;
      const outcome = toggleDependency(active, id, dependencyId);
      if (outcome.error) setNotice(outcome.error);
      else
        editProject(outcome.project, {
          structure: true,
          changedNodeIds: [id],
        });
    },
    [editProject],
  );
  const setLimit = useCallback(
    (limit: number | null) => {
      const active = activeProjectRef.current;
      if (active)
        editProject(setConcurrency(active, limit), { fullSimulation: true });
    },
    [editProject],
  );

  const simulate = useCallback(
    (nextMode = mode) => {
      if (!activeProjectRef.current) return;
      setStatus("simulating");
      setMode(nextMode);
    },
    [mode],
  );

  const saveSnapshot = useCallback(
    (name: string): boolean => {
      const active = activeProjectRef.current;
      if (!active || !result) return false;
      if (result.entries.length !== active.nodes.length) {
        setNotice(result.warnings[0] ?? "请先修复链路配置再保存方案。");
        return false;
      }
      const next = saveScenario(active, result, name);
      editProject(next, { changedNodeIds: [] });
      setComparisonIds({
        baselineId: next.scenarios[1]?.id ?? next.scenarios[0]?.id ?? "",
        comparisonId: next.scenarios[0]?.id ?? "",
      });
      setNotice("方案快照已保存。");
      return true;
    },
    [editProject, result],
  );

  const removeSavedScenario = useCallback(
    (id: string) => {
      const active = activeProjectRef.current;
      if (active) editProject(removeScenario(active, id));
    },
    [editProject],
  );
  const restoreSavedScenario = useCallback(
    (id: string) => {
      const active = activeProjectRef.current;
      if (!active) return;
      const restored = restoreScenario(active, id);
      editProject(restored, {
        structure: structuralNodeChange(active, restored),
        changedNodeIds: changedNodeIds(active, restored),
      });
    },
    [editProject],
  );

  const retrySave = useCallback(() => {
    const current = documentRef.current;
    if (!current) return;
    const currentRevision = ++revision.current;
    pendingChange.current = {
      nonce: ++changeNonce.current,
      changedNodeIds: [],
    };
    setPersisted("saving");
    saveQueue.save(currentRevision, current, true);
  }, [saveQueue]);

  return {
    document,
    activeProject,
    result,
    graphAnalysis,
    simulationValid,
    status,
    module,
    setModule,
    mode,
    setMode,
    notice,
    setNotice,
    persisted,
    chooseProject,
    newProject,
    renameActive,
    duplicateActive,
    deleteProject,
    addNode,
    patchNode,
    deleteNode,
    setNodeDependency,
    setLimit,
    simulate,
    saveSnapshot,
    removeSavedScenario,
    restoreSavedScenario,
    retrySave,
    scenarioList,
    baselineScenario,
    comparisonScenario,
    scenarioComparison,
    selectComparisonScenario,
  };
}
