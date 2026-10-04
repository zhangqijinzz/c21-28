import { useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  GitCompareArrows,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import type {
  LatencyProject,
  ScenarioSnapshot,
} from "../../shared/domain/types";
import type { ScenarioComparison } from "./scenarioViewModel";

interface Props {
  project: LatencyProject;
  onSave: (name: string) => boolean;
  onRemove: (id: string) => void;
  onRestore: (id: string) => void;
  baseline?: ScenarioSnapshot;
  comparison?: ScenarioSnapshot;
  comparisonResult?: ScenarioComparison;
  onSelectBaseline: (id: string) => void;
  onSelectComparison: (id: string) => void;
}

function formatDuration(value: number): string {
  return value < 1000
    ? `${Math.round(value)} ms`
    : `${(value / 1000).toFixed(2)} s`;
}

export default function ScenarioPanel({
  project,
  onSave,
  onRemove,
  onRestore,
  baseline,
  comparison,
  comparisonResult,
  onSelectBaseline,
  onSelectComparison,
}: Props) {
  const [name, setName] = useState("");
  const delta = comparisonResult?.deltaMs ?? 0;
  const outcome = comparisonResult?.outcome ?? "equal";
  const changes = comparisonResult?.changes ?? [];
  return (
    <section className="module-page scenarios-page">
      <div className="module-heading">
        <div>
          <span className="eyebrow">04 / SCENARIOS</span>
          <h1>方案对比</h1>
          <p>保存关键参数快照，判断一次调整是否真的缩短了等待。</p>
        </div>
      </div>
      <div className="save-scenario-bar">
        <div className="save-icon">
          <GitCompareArrows size={18} />
        </div>
        <div className="save-prompt">
          <strong>将当前推演保存为方案</strong>
          <small>保留节点、依赖、并发策略与完成预算。</small>
        </div>
        <input
          className="scenario-name-input"
          placeholder={`例如：${project.title} · 并发优化`}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <button
          className="button button-primary"
          onClick={() => {
            if (onSave(name)) setName("");
          }}
        >
          <Plus size={15} /> 保存快照
        </button>
      </div>
      {!project.scenarios.length ? (
        <div className="scenario-empty">
          <div className="empty-mark">A/B</div>
          <h3>还没有保存的方案</h3>
          <p>
            先在时序推演里调整并发或节点参数，再保存快照。之后可以在这里查看完成时间差异。
          </p>
        </div>
      ) : (
        <>
          <div className="compare-selectors">
            <div>
              <span className="compare-label">基准方案</span>
              <select
                value={baseline?.id ?? ""}
                onChange={(event) => onSelectBaseline(event.target.value)}
              >
                {project.scenarios.map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>
                    {scenario.name}
                  </option>
                ))}
              </select>
            </div>
            <span className="compare-vs">VS</span>
            <div>
              <span className="compare-label">对照方案</span>
              <select
                value={comparison?.id ?? ""}
                onChange={(event) => onSelectComparison(event.target.value)}
              >
                {project.scenarios.map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>
                    {scenario.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {baseline && comparison && (
            <div className="comparison-result">
              <article className="compare-card">
                <span>基准完成时间</span>
                <strong>{formatDuration(baseline.completionMs)}</strong>
                <small>
                  {baseline.name} · {baseline.nodes.length} 节点
                </small>
              </article>
              <div className="delta-card">
                <span>方案差异</span>
                <strong
                  className={outcome === "slower" ? "delta-bad" : "delta-good"}
                >
                  {outcome === "equal" ? null : outcome === "faster" ? (
                    <ArrowDownRight size={17} />
                  ) : (
                    <ArrowUpRight size={17} />
                  )}
                  {formatDuration(Math.abs(delta))}
                </strong>
                <small>
                  {outcome === "equal"
                    ? "两方案预算持平"
                    : outcome === "faster"
                      ? "对照方案更快"
                      : "对照方案更慢"}
                </small>
              </div>
              <article className="compare-card compare-card-accent">
                <span>对照完成时间</span>
                <strong>{formatDuration(comparison.completionMs)}</strong>
                <small>
                  {comparison.name} · {comparison.nodes.length} 节点
                </small>
              </article>
            </div>
          )}
          <div className="snapshot-list">
            <div className="snapshot-heading">
              <span className="section-label">已保存快照</span>
              <span>{project.scenarios.length} 个方案</span>
            </div>
            {project.scenarios.map((scenario) => (
              <div className="snapshot-row" key={scenario.id}>
                <span className="snapshot-badge">S</span>
                <div className="snapshot-info">
                  <strong>{scenario.name}</strong>
                  <small>
                    {new Date(scenario.createdAt).toLocaleString("zh-CN", {
                      month: "numeric",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    ·{" "}
                    {scenario.concurrencyLimit
                      ? `${scenario.concurrencyLimit} 路并发`
                      : "不限并发"}
                  </small>
                </div>
                <b className="snapshot-time">
                  {formatDuration(scenario.completionMs)}
                </b>
                <button
                  className="icon-button"
                  title="恢复此方案"
                  aria-label={`恢复方案 ${scenario.name}`}
                  onClick={() => onRestore(scenario.id)}
                >
                  <RotateCcw size={14} />
                </button>
                <button
                  className="icon-button danger-button"
                  title="删除方案"
                  aria-label={`删除方案 ${scenario.name}`}
                  onClick={() => onRemove(scenario.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          {changes.length > 0 && (
            <div className="change-summary">
              <strong>参数变化</strong>
              {changes.map((change) => (
                <span key={change}>{change}</span>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
