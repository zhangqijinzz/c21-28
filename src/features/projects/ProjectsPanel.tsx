import { Copy, FolderPlus, PencilLine, Play, Workflow } from "lucide-react";
import type { LatencyProject } from "../../shared/domain/types";

interface Props {
  projects: LatencyProject[];
  activeId: string;
  onChoose: (id: string) => void;
  onCreate: () => void;
  onRename: (name: string) => void;
  onDuplicate: () => void;
  onOpenEditor: () => void;
}

export default function ProjectsPanel({
  projects,
  activeId,
  onChoose,
  onCreate,
  onRename,
  onDuplicate,
  onOpenEditor,
}: Props) {
  const active = projects.find((project) => project.id === activeId);
  return (
    <section className="module-page projects-page">
      <div className="module-heading">
        <div>
          <span className="eyebrow">01 / PROJECTS</span>
          <h1>链路项目</h1>
          <p>从一条清晰的依赖图开始，逐步收紧首屏预算。</p>
        </div>
        <button className="button button-primary" onClick={onCreate}>
          <FolderPlus size={16} /> 新建链路
        </button>
      </div>
      <div className="project-workbench">
        <div className="project-list">
          <div className="section-label">
            我的项目 <span>{String(projects.length).padStart(2, "0")}</span>
          </div>
          {projects.map((project, index) => (
            <button
              className={`project-row ${project.id === activeId ? "selected" : ""}`}
              key={project.id}
              onClick={() => onChoose(project.id)}
            >
              <span className="project-index">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="project-row-copy">
                <strong>{project.title}</strong>
                <small>
                  {project.nodes.length} 个请求节点 · {project.scenarios.length}{" "}
                  个方案
                </small>
              </span>
              <span className="project-row-arrow">↗</span>
            </button>
          ))}
        </div>
        {active && (
          <div className="project-cover">
            <div className="cover-orbit orbit-a" />
            <div className="cover-orbit orbit-b" />
            <div className="cover-top">
              <span className="pill pill-light">
                <i className="status-dot" /> 本地工作区
              </span>
              <Workflow size={19} />
            </div>
            <div className="cover-art" aria-hidden="true">
              <div className="art-line line-one" />
              <div className="art-line line-two" />
              <div className="art-line line-three" />
              <i className="art-node node-one" />
              <i className="art-node node-two" />
              <i className="art-node node-three" />
              <i className="art-node node-four" />
              <i className="art-node node-five" />
            </div>
            <div className="cover-content">
              <span className="eyebrow eyebrow-light">CURRENT BLUEPRINT</span>
              <input
                aria-label="项目名称"
                className="cover-title-input"
                value={active.title}
                onChange={(event) => onRename(event.target.value)}
              />
              <p>为关键请求分配预算，观察依赖与等待如何塑造页面完成时间。</p>
            </div>
            <div className="cover-footer">
              <span>
                <b>{String(active.nodes.length).padStart(2, "0")}</b> 请求节点
              </span>
              <span>
                <b>{String(active.scenarios.length).padStart(2, "0")}</b>{" "}
                方案快照
              </span>
              <div className="cover-actions">
                <button
                  className="icon-button light"
                  title="复制项目"
                  aria-label="复制项目"
                  onClick={onDuplicate}
                >
                  <Copy size={15} />
                </button>
                <button className="button button-lime" onClick={onOpenEditor}>
                  打开工作台 <Play size={14} fill="currentColor" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="project-footnote">
        <PencilLine size={14} /> 所有修改会自动保存到本地
        IndexedDB，可离线继续推演。
      </div>
    </section>
  );
}
