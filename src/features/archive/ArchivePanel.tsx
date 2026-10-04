import { useState } from "react";
import { Archive, Copy, Database, HardDrive, Trash2 } from "lucide-react";
import type { LatencyProject } from "../../shared/domain/types";

interface Props {
  projects: LatencyProject[];
  activeId: string;
  storageState: "saving" | "saved" | "error";
  notice: string;
  onChoose: (id: string) => void;
  onDuplicate: () => void;
  onDelete: (id: string) => void;
  onRetrySave: () => void;
}

export default function ArchivePanel({
  projects,
  activeId,
  storageState,
  notice,
  onChoose,
  onDuplicate,
  onDelete,
  onRetrySave,
}: Props) {
  const [pendingDelete, setPendingDelete] = useState<LatencyProject | null>(
    null,
  );
  return (
    <section className="module-page archive-page">
      <div className="module-heading">
        <div>
          <span className="eyebrow">05 / LOCAL ARCHIVE</span>
          <h1>本地项目区</h1>
          <p>链路项目和方案快照只保存在当前设备的浏览器中。</p>
        </div>
      </div>
      <div className="storage-overview">
        <div className="storage-graphic">
          <div className="storage-ring">
            <Database size={23} />
            <span />
          </div>
        </div>
        <div className="storage-copy">
          <span className="eyebrow">DEVICE STORAGE</span>
          <h2>离线工作区</h2>
          <p>
            IndexedDB
            持久化项目数据，并保留本地恢复副本。刷新或重新打开后自动载入最近项目。
          </p>
          <div className="storage-status">
            <i className={storageState === "error" ? "status-error" : ""} />
            {storageState === "saving"
              ? "正在保存更改…"
              : storageState === "error"
                ? "保存遇到问题"
                : "所有更改已保存"}
          </div>
          {storageState === "error" && (
            <button className="text-action" onClick={onRetrySave}>
              重试保存 →
            </button>
          )}
        </div>
        <div className="storage-stat">
          <span>
            <HardDrive size={15} />
            项目数
          </span>
          <strong>{String(projects.length).padStart(2, "0")}</strong>
        </div>
      </div>
      {notice && (
        <div className="archive-notice">
          <Archive size={15} />
          {notice}
        </div>
      )}
      <div className="archive-table">
        <div className="archive-table-head">
          <span>项目名称</span>
          <span>请求节点</span>
          <span>方案快照</span>
          <span>最后修改</span>
          <span>操作</span>
        </div>
        {projects.map((project) => (
          <div
            className={`archive-table-row ${project.id === activeId ? "is-active" : ""}`}
            key={project.id}
          >
            <button
              className="archive-project-name"
              onClick={() => onChoose(project.id)}
            >
              <i />
              {project.title}
              {project.id === activeId && <em>当前</em>}
            </button>
            <span>{String(project.nodes.length).padStart(2, "0")}</span>
            <span>{String(project.scenarios.length).padStart(2, "0")}</span>
            <span>
              {new Date(project.updatedAt).toLocaleDateString("zh-CN", {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </span>
            <span className="archive-actions">
              <button
                className="icon-button"
                title="复制当前项目"
                aria-label="复制当前项目"
                onClick={onDuplicate}
              >
                <Copy size={14} />
              </button>
              <button
                className="icon-button danger-button"
                title="删除项目"
                aria-label={`删除项目 ${project.title}`}
                onClick={() => setPendingDelete(project)}
                disabled={projects.length < 2}
              >
                <Trash2 size={14} />
              </button>
            </span>
          </div>
        ))}
      </div>
      <div className="privacy-note">
        <span className="privacy-symbol">⌑</span>
        <span>
          <strong>本地优先</strong>{" "}
          不需要帐号，不发送网络请求，项目数据留在这台设备上。
        </span>
      </div>
      {pendingDelete && (
        <div className="dialog-backdrop" role="presentation">
          <div
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-project-title"
          >
            <span className="dialog-icon">
              <Trash2 size={18} />
            </span>
            <h2 id="delete-project-title">删除这个链路项目？</h2>
            <p>“{pendingDelete.title}”及其方案快照将从此设备移除。</p>
            <div>
              <button
                className="button button-neutral"
                onClick={() => setPendingDelete(null)}
              >
                取消
              </button>
              <button
                className="button button-danger"
                onClick={() => {
                  onDelete(pendingDelete.id);
                  setPendingDelete(null);
                }}
              >
                删除项目
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
