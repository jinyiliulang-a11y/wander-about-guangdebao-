"use client";
import { useState } from "react";
import { Compass, Plus, Minus, Coins, MapPin, Maximize2 } from "lucide-react";
import type { Task } from "@/lib/game-types";
export function MallMap({
  tasks,
  selected,
  onSelect,
  floor,
  onFloor,
}: {
  tasks: Task[];
  selected: string | null;
  onSelect: (t: Task) => void;
  floor: string;
  onFloor: (f: string) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const visible = tasks.filter((t) => t.floor === floor);
  return (
    <section className="map-panel">
      <div className="map-toolbar">
        <div className="floor-tabs">
          {["B1", "F1", "F2", "F3"].map((f) => (
            <button
              key={f}
              className={floor === f ? "active" : ""}
              onClick={() => onFloor(f)}
            >
              {f}
            </button>
          ))}
        </div>
        <span className="map-meta">
          <span className="status-dot" />
          {visible.length} 个宝藏等待发现
        </span>
      </div>
      <div className="map-canvas">
        <div className="map-grid" />
        <div className="mall-plan" style={{ transform: `scale(${zoom})` }}>
          <svg
            viewBox="0 0 900 600"
            role="img"
            aria-label={`${floor}商场探索示意图，圆圈表示大致探索范围`}
          >
            <defs>
              <pattern
                id="tiles"
                width="14"
                height="14"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M14 0H0V14"
                  fill="none"
                  stroke="#385057"
                  strokeWidth=".4"
                />
              </pattern>
            </defs>
            <path
              d="M170 70H690L760 140V445L650 520H185L105 440V160Z"
              fill="#172a31"
              stroke="#507071"
              strokeWidth="2"
            />
            <path
              d="M182 86H680L741 146V434L641 501H194L124 432V168Z"
              fill="url(#tiles)"
            />
            <g fill="#223c44" stroke="#496367" strokeWidth="1.5">
              <rect x="185" y="99" width="116" height="89" rx="5" />
              <rect x="313" y="99" width="116" height="89" rx="5" />
              <rect x="441" y="99" width="117" height="89" rx="5" />
              <path d="M570 99H673L721 149V188H570Z" />
              <rect x="137" y="223" width="107" height="98" rx="5" />
              <rect x="137" y="336" width="107" height="87" rx="5" />
              <rect x="633" y="223" width="95" height="98" rx="5" />
              <rect x="633" y="336" width="95" height="87" rx="5" />
              <path d="M184 452H298V487H198Z" />
              <rect x="311" y="432" width="116" height="55" rx="5" />
              <rect x="441" y="432" width="116" height="55" rx="5" />
              <path d="M570 452H685L636 487H570Z" />
            </g>
            <path
              d="M276 255C280 220 327 207 354 220L410 246H479L536 220C574 199 612 228 610 263V356C610 397 571 408 537 387L480 362H414L353 388C312 408 276 386 276 351Z"
              fill="#12212a"
              stroke="#456264"
              strokeWidth="2"
            />
            <path
              d="M389 273H497V333H389Z"
              fill="#243b3e"
              stroke="#62736c"
              strokeWidth="1.5"
            />
            <path d="M396 304H490" stroke="#88917c" strokeWidth="2" />
            <g
              fill="#94ada8"
              textAnchor="middle"
              fontFamily="sans-serif"
              fontSize="14"
            >
              <text x="371" y="148">
                生活好物
              </text>
              <text x="499" y="148">
                潮流零售
              </text>
              <text x="644" y="148">
                轻食茶饮
              </text>
              <text x="190" y="270">
                生活方式
              </text>
              <text x="680" y="377">
                休闲空间
              </text>
              <text x="445" y="299">
                中 庭
              </text>
              <text x="442" y="460">
                创意生活
              </text>
            </g>
            <path
              d="M180 385H210L197 399H167Z M667 269H697L684 283H654Z"
              stroke="#88a69c"
              strokeWidth="2"
              fill="none"
            />
            {visible.map((t) => (
              <g
                key={t.id}
                className="svg-zone"
                onClick={() => onSelect(t)}
                role="button"
                tabIndex={0}
                aria-label={`选择宝藏 ${t.title}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(t);
                  }
                }}
              >
                <circle
                  cx={t.x * 9}
                  cy={t.y * 6}
                  r="69"
                  fill={selected === t.id ? "#e6a93a20" : "#e6a93a10"}
                  stroke="#d8ad50"
                  strokeWidth={selected === t.id ? 2 : 1.3}
                  strokeDasharray="5 7"
                />
                <circle
                  cx={t.x * 9}
                  cy={t.y * 6}
                  r="23"
                  fill="#f6c663"
                  stroke="#ffdf94"
                  strokeWidth="3"
                />
                <text
                  x={t.x * 9}
                  y={t.y * 6 + 6}
                  textAnchor="middle"
                  fontSize="23"
                  fontWeight="bold"
                  fill="#49350e"
                >
                  ✦
                </text>
              </g>
            ))}
          </svg>
        </div>
        <div className="map-compass">
          <Compass size={25} />
          <span>N</span>
        </div>
        <div className="map-controls">
          <button
            aria-label="放大地图"
            onClick={() => setZoom(Math.min(zoom + 0.15, 1.6))}
          >
            <Plus size={18} />
          </button>
          <button
            aria-label="缩小地图"
            onClick={() => setZoom(Math.max(zoom - 0.15, 0.7))}
          >
            <Minus size={18} />
          </button>
          <button aria-label="恢复地图比例" onClick={() => setZoom(1)}>
            <Maximize2 size={17} />
          </button>
        </div>
        {!visible.length && (
          <div className="map-empty">
            <MapPin size={25} />
            <strong>这一层暂时没有宝藏</strong>
            <span>切换到 F1 或 F2 继续探索</span>
          </div>
        )}
        <div className="map-bottom">
          <span>
            <Coins size={15} />
            宝藏的大致范围
          </span>
          <span>楼层示意图 · 非实时定位</span>
        </div>
      </div>
    </section>
  );
}
