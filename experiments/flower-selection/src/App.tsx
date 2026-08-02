import { useEffect, useMemo, useState } from "react";
import type { GardenConfig } from "./lib/types";
import { DEFAULT_CONFIG } from "./lib/palette";
import { randomSeed } from "./lib/seededRandom";
import { FlowerSelectionArticle } from "./components/FlowerSelectionArticle";
import { DebugPanel } from "./components/DebugPanel";

/** Live plant count + phase, read off the DOM for the debug label (cheap, on rAF). */
function useLiveStatus(seed: string) {
  const [status, setStatus] = useState({ count: 0, phase: "idle" });
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const count = document.querySelectorAll(".garden-botanical [data-plant]").length;
      const phase = document.querySelector("[data-garden]")?.getAttribute("data-phase") ?? "idle";
      setStatus((s) => (s.count === count && s.phase === phase ? s : { count, phase }));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [seed]);
  return status;
}

export function App() {
  // Seed is randomized once per load, then fixed for the session (no flicker).
  const [cfg, setCfg] = useState<GardenConfig>(() => ({ ...DEFAULT_CONFIG, seed: randomSeed() }));

  const [systemReduced, setSystemReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setSystemReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const reduced = systemReduced || cfg.reducedPreview;
  const { count: plantCount, phase } = useLiveStatus(cfg.seed);

  // Expose the selection colour to the ::highlight() rule for the committed state.
  useEffect(() => {
    document.documentElement.style.setProperty("--garden-sel", cfg.selColor);
  }, [cfg.selColor]);

  const patch = useMemo(() => (p: Partial<GardenConfig>) => setCfg((c) => ({ ...c, ...p })), []);
  const reseed = useMemo(() => () => setCfg((c) => ({ ...c, seed: randomSeed() })), []);

  return (
    <main className="garden-root">
      <FlowerSelectionArticle cfg={cfg} reduced={reduced} />
      <footer className="garden-footer">
        <p>Drag across any paragraph. Release, and it commits to a highlight as the garden clears.</p>
      </footer>
      <DebugPanel
        cfg={cfg}
        onChange={patch}
        onReseed={reseed}
        plantCount={plantCount}
        phase={phase}
        systemReduced={systemReduced}
      />
    </main>
  );
}
