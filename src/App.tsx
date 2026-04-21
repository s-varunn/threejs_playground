import { useEffect, useRef, useState, useCallback } from "react";
import {
  initRenderer, setActiveTab, destroyRenderer, getFps,
  embeddingMorphTo, lorenzSetSpeed, lorenzReset,
  type TabId,
} from "./main";

function ErrorFallback({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center w-full h-full" style={{ background: "#020610", color: "#64d4ff" }}>
      <div className="text-center p-8">
        <div className="text-4xl mb-4" style={{ color: "rgba(100,212,255,0.3)" }}>⬡</div>
        <h2 className="text-xl font-bold mb-3 tracking-[0.2em] uppercase">WebGL Unavailable</h2>
        <p className="text-sm opacity-50 max-w-xs">{message}</p>
        <p className="text-xs mt-4 opacity-30 tracking-widest">Requires a WebGL2-capable browser</p>
      </div>
    </div>
  );
}

const TABS: { id: TabId; label: string; icon: string; color: string }[] = [
  { id: "physics",   label: "Particle Physics",   icon: "⬡", color: "#00d4ff" },
  { id: "embedding", label: "AI Embedding Space",  icon: "◈", color: "#a855f7" },
  { id: "lorenz",    label: "Lorenz Attractor",    icon: "∿", color: "#ff6b35" },
];

const SHAPE_NAMES = ["Sphere", "Grid", "Helix", "Galaxy"];

// ─── Scanline/Grid overlay ────────────────────────────────────────────────────
function ScanlineOverlay() {
  return (
    <div className="absolute inset-0 pointer-events-none z-5 overflow-hidden">
      <div style={{
        position: "absolute", inset: 0,
        backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,180,255,0.015) 3px, rgba(0,180,255,0.015) 4px)",
        backgroundSize: "100% 4px",
      }} />
      <div style={{
        position: "absolute", inset: 0,
        backgroundImage: "repeating-linear-gradient(90deg, transparent, transparent 40px, rgba(0,180,255,0.008) 40px, rgba(0,180,255,0.008) 41px)",
      }} />
    </div>
  );
}

// ─── Animated corner decorations ─────────────────────────────────────────────
function CornerDeco({ position }: { position: "tl" | "tr" | "bl" | "br" }) {
  const styles: Record<string, React.CSSProperties> = {
    tl: { top: 12, left: 12 },
    tr: { top: 12, right: 12 },
    bl: { bottom: 12, left: 12 },
    br: { bottom: 12, right: 12 },
  };
  const rotations = { tl: 0, tr: 90, bl: 270, br: 180 };
  return (
    <svg
      style={{ ...styles[position], position: "absolute", opacity: 0.25 }}
      width={24} height={24} viewBox="0 0 24 24"
      transform={`rotate(${rotations[position]})`}
    >
      <path d="M0 12 L0 0 L12 0" fill="none" stroke="#64d4ff" strokeWidth="1.5" />
      <circle cx="0" cy="0" r="2" fill="#64d4ff" />
    </svg>
  );
}

// ─── FPS counter ─────────────────────────────────────────────────────────────
function FpsCounter() {
  const [fps, setFps] = useState(60);
  useEffect(() => {
    const id = setInterval(() => setFps(getFps()), 500);
    return () => clearInterval(id);
  }, []);
  const color = fps >= 55 ? "#00ff88" : fps >= 30 ? "#ffaa00" : "#ff4444";
  return (
    <div style={{ color, fontSize: 11, fontFamily: "monospace", opacity: 0.7, letterSpacing: "0.05em" }}>
      {fps} <span style={{ opacity: 0.5 }}>fps</span>
    </div>
  );
}

// ─── Control panels per scene ─────────────────────────────────────────────────
function PhysicsControls() {
  return (
    <div className="flex flex-col gap-2">
      <div style={{ color: "rgba(100,212,255,0.5)", fontSize: 10, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 2 }}>
        Controls
      </div>
      <ControlRow icon="●" label="Left click" value="Attract" color="#00d4ff" />
      <ControlRow icon="●" label="Right click" value="Repel" color="#ff4060" />
      <ControlRow icon="✦" label="Double click" value="Explode" color="#ffcc00" />
      <div style={{ borderTop: "1px solid rgba(100,180,255,0.1)", marginTop: 4, paddingTop: 4 }}>
        <ControlRow icon="◎" label="Particles" value="65,536" color="#00d4ff" />
      </div>
    </div>
  );
}

function EmbeddingControls({ onShape }: { onShape: (i: number) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div style={{ color: "rgba(168,85,247,0.6)", fontSize: 10, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 2 }}>
        Morph To
      </div>
      {SHAPE_NAMES.map((name, i) => (
        <button
          key={i}
          onClick={() => onShape(i)}
          style={{
            background: "rgba(168,85,247,0.08)",
            border: "1px solid rgba(168,85,247,0.25)",
            borderRadius: 6,
            color: "rgba(200,150,255,0.85)",
            fontSize: 11,
            padding: "4px 10px",
            cursor: "pointer",
            textAlign: "left",
            letterSpacing: "0.05em",
            transition: "all 0.15s",
          }}
          onMouseEnter={e => { (e.target as HTMLElement).style.background = "rgba(168,85,247,0.2)"; }}
          onMouseLeave={e => { (e.target as HTMLElement).style.background = "rgba(168,85,247,0.08)"; }}
        >
          {name}
        </button>
      ))}
      <div style={{ borderTop: "1px solid rgba(168,85,247,0.1)", marginTop: 4, paddingTop: 4 }}>
        <ControlRow icon="◈" label="Vectors" value="12,000" color="#a855f7" />
      </div>
    </div>
  );
}

function LorenzControls({ onReset }: { onReset: () => void }) {
  const [speed, setSpeed] = useState(1.0);

  const handleSpeed = (v: number) => {
    setSpeed(v);
    lorenzSetSpeed(v);
  };

  return (
    <div className="flex flex-col gap-3">
      <div style={{ color: "rgba(255,107,53,0.6)", fontSize: 10, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 2 }}>
        Parameters
      </div>
      <div>
        <div style={{ color: "rgba(255,160,100,0.7)", fontSize: 10, marginBottom: 4, display: "flex", justifyContent: "space-between" }}>
          <span>Simulation Speed</span>
          <span style={{ color: "#ff9a5c" }}>{speed.toFixed(1)}×</span>
        </div>
        <input
          type="range" min={0.1} max={5} step={0.1} value={speed}
          onChange={e => handleSpeed(Number(e.target.value))}
          style={{ width: "100%", accentColor: "#ff6b35", cursor: "pointer" }}
        />
      </div>
      <button
        onClick={() => { onReset(); lorenzReset(); }}
        style={{
          background: "rgba(255,107,53,0.1)",
          border: "1px solid rgba(255,107,53,0.35)",
          borderRadius: 6,
          color: "#ff9a5c",
          fontSize: 11,
          padding: "5px 10px",
          cursor: "pointer",
          letterSpacing: "0.08em",
          transition: "all 0.15s",
        }}
        onMouseEnter={e => { (e.target as HTMLElement).style.background = "rgba(255,107,53,0.22)"; }}
        onMouseLeave={e => { (e.target as HTMLElement).style.background = "rgba(255,107,53,0.1)"; }}
      >
        ↺ Reset Trajectory
      </button>
      <div style={{ borderTop: "1px solid rgba(255,107,53,0.1)", marginTop: 2, paddingTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
        <ControlRow icon="∿" label="σ (sigma)" value="10" color="#ff6b35" />
        <ControlRow icon="∿" label="ρ (rho)" value="28" color="#ff6b35" />
        <ControlRow icon="∿" label="β (beta)" value="8/3" color="#ff6b35" />
        <ControlRow icon="●" label="Attractors" value="3" color="#ff6b35" />
      </div>
    </div>
  );
}

function ControlRow({ icon, label, value, color }: { icon: string; label: string; value: string; color: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11 }}>
      <span style={{ color: "rgba(160,200,220,0.5)", display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ color, fontSize: 8, opacity: 0.8 }}>{icon}</span>
        {label}
      </span>
      <span style={{ color: "rgba(200,230,255,0.7)", fontFamily: "monospace" }}>{value}</span>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [activeTab, setTab] = useState<TabId>("physics");
  const [webglError, setWebglError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [_resetKey, setResetKey] = useState(0);
  const initialized = useRef(false);

  useEffect(() => {
    if (!canvasRef.current || initialized.current) return;
    initialized.current = true;
    try {
      initRenderer(canvasRef.current);
      setActiveTab("physics");
    } catch (e: any) {
      setWebglError(e?.message ?? "WebGL failed to initialize");
    }
    return () => { destroyRenderer(); };
  }, []);

  const handleTabChange = useCallback((tab: TabId) => {
    setTab(tab);
    setActiveTab(tab);
  }, []);

  const currentTabInfo = TABS.find((t) => t.id === activeTab)!;

  if (webglError) return <ErrorFallback message={webglError} />;

  return (
    <div className="relative w-full h-screen overflow-hidden" style={{ background: "#020610", fontFamily: "monospace" }}>
      {/* Main canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ display: "block" }}
      />

      {/* Scanline overlay */}
      <ScanlineOverlay />

      {/* Corner decorations */}
      <CornerDeco position="tl" />
      <CornerDeco position="tr" />
      <CornerDeco position="bl" />
      <CornerDeco position="br" />

      {/* ─── TOP NAV ───────────────────────────────────────────────────── */}
      <div
        className="absolute top-0 left-0 right-0 z-20 flex flex-col items-center"
        style={{
          padding: "14px 16px 12px",
          background: "linear-gradient(180deg, rgba(2,6,16,0.97) 0%, rgba(2,6,16,0.0) 100%)",
        }}
      >
        {/* Title row */}
        <div style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* Animated hex icon */}
            <svg width={22} height={22} viewBox="0 0 24 24">
              <polygon points="12,2 22,7 22,17 12,22 2,17 2,7"
                fill="none" stroke="#64d4ff" strokeWidth="1.5"
                style={{ filter: "drop-shadow(0 0 6px rgba(100,212,255,0.8))" }}
              />
              <circle cx="12" cy="12" r="3" fill="#64d4ff"
                style={{ filter: "drop-shadow(0 0 4px rgba(100,212,255,1))" }}
              />
            </svg>
            <h1 style={{
              color: "#64d4ff",
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "0.35em",
              textTransform: "uppercase",
              textShadow: "0 0 20px rgba(100,212,255,0.7), 0 0 50px rgba(100,212,255,0.3)",
            }}>
              Visualizing with ThreeJS
            </h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <FpsCounter />
            <div style={{ fontSize: 9, color: "rgba(100,160,220,0.3)", letterSpacing: "0.12em", textTransform: "uppercase" }}>
              WebGL 2 · Three.js
            </div>
          </div>
        </div>

        {/* Tab bar */}
        <div style={{
          display: "flex",
          gap: 2,
          padding: 3,
          borderRadius: 12,
          background: "rgba(5,12,28,0.85)",
          backdropFilter: "blur(24px)",
          border: "1px solid rgba(100,180,255,0.12)",
          boxShadow: "0 8px 40px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)",
        }}>
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                style={{
                  position: "relative",
                  padding: "7px 18px",
                  borderRadius: 9,
                  fontSize: 12,
                  fontWeight: 500,
                  fontFamily: "monospace",
                  letterSpacing: "0.04em",
                  cursor: "pointer",
                  transition: "all 0.25s ease",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  background: isActive
                    ? `linear-gradient(135deg, ${tab.color}28 0%, ${tab.color}15 100%)`
                    : "transparent",
                  color: isActive ? tab.color : "rgba(140,180,220,0.55)",
                  border: isActive ? `1px solid ${tab.color}55` : "1px solid transparent",
                  boxShadow: isActive ? `0 0 20px ${tab.color}25, inset 0 1px 0 rgba(255,255,255,0.06)` : "none",
                  textShadow: isActive ? `0 0 12px ${tab.color}cc` : "none",
                }}
              >
                <span style={{ fontSize: 14, lineHeight: 1 }}>{tab.icon}</span>
                {tab.label}
                {isActive && (
                  <span style={{
                    position: "absolute", bottom: -3, left: "50%", transform: "translateX(-50%)",
                    width: 24, height: 2, borderRadius: 1,
                    background: `linear-gradient(90deg, transparent, ${tab.color}, transparent)`,
                    boxShadow: `0 0 8px ${tab.color}`,
                  }} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── SIDEBAR PANEL ─────────────────────────────────────────────── */}
      <div style={{
        position: "absolute",
        top: "50%",
        right: sidebarOpen ? 0 : -220,
        transform: "translateY(-50%)",
        width: 220,
        zIndex: 20,
        transition: "right 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
      }}>
        {/* Toggle tab */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          style={{
            position: "absolute",
            left: -28,
            top: "50%",
            transform: "translateY(-50%)",
            width: 28,
            height: 48,
            background: "rgba(5,12,28,0.85)",
            border: "1px solid rgba(100,180,255,0.15)",
            borderRight: "none",
            borderRadius: "6px 0 0 6px",
            color: "rgba(100,200,255,0.6)",
            cursor: "pointer",
            fontSize: 14,
            backdropFilter: "blur(12px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {sidebarOpen ? "›" : "‹"}
        </button>

        {/* Panel */}
        <div style={{
          background: "rgba(5,12,28,0.9)",
          backdropFilter: "blur(20px)",
          border: "1px solid rgba(100,180,255,0.12)",
          borderRight: "none",
          borderRadius: "12px 0 0 12px",
          padding: "16px 14px",
          boxShadow: "-8px 0 40px rgba(0,0,0,0.5)",
        }}>
          {/* Scene indicator */}
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            marginBottom: 14,
            paddingBottom: 10,
            borderBottom: `1px solid ${currentTabInfo.color}22`,
          }}>
            <span style={{ color: currentTabInfo.color, fontSize: 16 }}>{currentTabInfo.icon}</span>
            <span style={{ color: currentTabInfo.color, fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.85 }}>
              {currentTabInfo.label}
            </span>
          </div>

          {activeTab === "physics"   && <PhysicsControls />}
          {activeTab === "embedding" && <EmbeddingControls onShape={embeddingMorphTo} />}
          {activeTab === "lorenz"    && <LorenzControls onReset={() => setResetKey(k => k + 1)} />}
        </div>
      </div>

      {/* ─── BOTTOM STATUS BAR ─────────────────────────────────────────── */}
      <div style={{
        position: "absolute",
        bottom: 12,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "5px 20px",
        borderRadius: 20,
        background: "rgba(2,6,16,0.75)",
        backdropFilter: "blur(16px)",
        border: "1px solid rgba(100,180,255,0.1)",
        color: "rgba(100,160,220,0.4)",
        fontSize: 11,
        letterSpacing: "0.08em",
        whiteSpace: "nowrap",
      }}>
        {/* Pulsing dot */}
        <span style={{
          width: 5, height: 5, borderRadius: "50%",
          background: currentTabInfo.color,
          boxShadow: `0 0 6px ${currentTabInfo.color}`,
          animation: "pulse 2s ease-in-out infinite",
          flexShrink: 0,
        }} />

        {activeTab === "physics" && <>
          <span>65,536 particles</span>
          <Sep /><span>GPU GPGPU simulation</span>
          <Sep /><span>Left click attract · Right click repel · Double click explode</span>
        </>}
        {activeTab === "embedding" && <>
          <span>12,000 vectors</span>
          <Sep /><span>4 morph shapes: Sphere · Grid · Helix · Galaxy</span>
          <Sep /><span>Drag to orbit · Hover to attract</span>
        </>}
        {activeTab === "lorenz" && <>
          <span>3 simultaneous attractors</span>
          <Sep /><span>σ=10 ρ=28 β=8/3</span>
          <Sep /><span>Drag to orbit · R to reset · +/- speed</span>
        </>}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}

function Sep() {
  return <span style={{ width: 1, height: 10, background: "rgba(100,180,220,0.2)", flexShrink: 0 }} />;
}
