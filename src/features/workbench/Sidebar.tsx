import { useState } from "react";
import {
  ChevronDown,
  Plus,
  RadioTower,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { LatencyProject } from "../../shared/domain/types";
import type { LabModule } from "./useLatencyLab";

export interface NavigationItem {
  id: LabModule;
  label: string;
  sublabel: string;
  icon: LucideIcon;
}

interface Props {
  activeProject: LatencyProject;
  projects: LatencyProject[];
  activeModule: LabModule;
  navigation: NavigationItem[];
  onModule: (module: LabModule) => void;
  onChooseProject: (id: string) => void;
  onNewProject: () => void;
}

export default function Sidebar({
  activeProject,
  projects,
  activeModule,
  navigation,
  onModule,
  onChooseProject,
  onNewProject,
}: Props) {
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  return (
    <aside className="sidebar">
      <button
        className="brand-lockup"
        onClick={() => onModule("simulation")}
        aria-label="LatencyLab 首页"
      >
        <span className="brand-mark">
          <RadioTower size={19} />
        </span>
        <span>
          <b>
            Latency<span>Lab</span>
          </b>
          <small>REQUEST BUDGET STUDIO</small>
        </span>
      </button>
      <div className="workspace-switcher">
        <span className="workspace-kicker">WORKSPACE</span>
        <button onClick={() => setProjectMenuOpen((open) => !open)}>
          <i className="workspace-light" />
          <span>
            <b>{activeProject.title}</b>
            <small>本地工作区</small>
          </span>
          <ChevronDown size={15} className={projectMenuOpen ? "turn-up" : ""} />
        </button>
        {projectMenuOpen && (
          <div className="project-dropdown">
            {projects.map((project) => (
              <button
                key={project.id}
                onClick={() => {
                  onChooseProject(project.id);
                  setProjectMenuOpen(false);
                }}
                className={project.id === activeProject.id ? "current" : ""}
              >
                <span>{project.title}</span>
                <small>{project.nodes.length} nodes</small>
              </button>
            ))}
            <button
              className="dropdown-new"
              onClick={() => {
                onNewProject();
                setProjectMenuOpen(false);
              }}
            >
              <Plus size={14} /> 新建链路
            </button>
          </div>
        )}
      </div>
      <span className="nav-heading">链路工作台</span>
      <nav className="primary-nav">
        {navigation.map(({ id, label, sublabel, icon: Icon }, index) => (
          <button
            key={id}
            title={label}
            aria-label={label}
            onClick={() => onModule(id)}
            className={activeModule === id ? "active" : ""}
          >
            <span className="nav-index">0{index + 1}</span>
            <span className="nav-icon">
              <Icon size={17} strokeWidth={1.8} />
            </span>
            <span className="nav-copy">
              <b>{label}</b>
              <small>{sublabel}</small>
            </span>
            {activeModule === id && <i className="nav-selected" />}
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="budget-card">
          <div className="budget-card-head">
            <span>
              <Sparkles size={14} /> LAB NOTE
            </span>
            <span>01</span>
          </div>
          <p>页面变慢时，先找最晚完成的那条链路。</p>
          <button onClick={() => onModule("simulation")}>
            查看关键路径 <span>↗</span>
          </button>
        </div>
        <div className="sidebar-user">
          <span className="avatar-mark">LL</span>
          <span>
            <b>Local session</b>
            <small>仅此设备可见</small>
          </span>
          <SlidersHorizontal size={15} />
        </div>
      </div>
    </aside>
  );
}
