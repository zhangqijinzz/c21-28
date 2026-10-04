import {
  createEmptyProject,
  type LatencyProject,
  type WorkspaceDocument,
} from "../../shared/domain/types";

export function createProject(
  document: WorkspaceDocument,
  now = Date.now(),
): WorkspaceDocument {
  const project = createEmptyProject(now);
  return {
    ...document,
    activeProjectId: project.id,
    projects: [project, ...document.projects],
  };
}

export function selectProject(
  document: WorkspaceDocument,
  projectId: string,
): WorkspaceDocument {
  return document.projects.some((project) => project.id === projectId)
    ? { ...document, activeProjectId: projectId }
    : document;
}

export function renameProject(
  project: LatencyProject,
  title: string,
  now = Date.now(),
): LatencyProject {
  return { ...project, title: title.trim() || "未命名链路", updatedAt: now };
}

export function duplicateProject(
  document: WorkspaceDocument,
  project: LatencyProject,
  now = Date.now(),
): WorkspaceDocument {
  const idMap = new Map<string, string>();
  const clonedNodes = project.nodes.map((source) => {
    const id = crypto.randomUUID();
    idMap.set(source.id, id);
    return { ...source, id, dependencyIds: [], fallbackNodeId: undefined };
  });
  const copy: LatencyProject = {
    ...structuredClone(project),
    id: `project-${crypto.randomUUID()}`,
    title: `${project.title} · 副本`,
    createdAt: now,
    updatedAt: now,
    scenarios: [],
    nodes: clonedNodes.map((node, index) => {
      const source = project.nodes[index];
      if (!source) return node;
      const fallbackId = source.fallbackNodeId
        ? idMap.get(source.fallbackNodeId)
        : undefined;
      return {
        ...node,
        dependencyIds: source.dependencyIds
          .map((id) => idMap.get(id))
          .filter((id): id is string => Boolean(id)),
        ...(fallbackId ? { fallbackNodeId: fallbackId } : {}),
      };
    }),
  };
  return {
    ...document,
    activeProjectId: copy.id,
    projects: [copy, ...document.projects],
  };
}

export function removeProject(
  document: WorkspaceDocument,
  projectId: string,
): WorkspaceDocument {
  const projects = document.projects.filter(
    (project) => project.id !== projectId,
  );
  return {
    ...document,
    projects,
    activeProjectId:
      document.activeProjectId === projectId
        ? (projects[0]?.id ?? "")
        : document.activeProjectId,
  };
}

export function updateProject(
  document: WorkspaceDocument,
  project: LatencyProject,
): WorkspaceDocument {
  return {
    ...document,
    projects: document.projects.map((item) =>
      item.id === project.id ? project : item,
    ),
  };
}
