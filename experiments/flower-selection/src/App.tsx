import { useEffect, useMemo, useState } from "react";
import type { GardenConfig } from "./lib/types";
import { DEFAULT_CONFIG } from "./lib/palette";
import { randomSeed } from "./lib/seededRandom";
import { FlowerSelectionArticle } from "./components/FlowerSelectionArticle";
import { DebugPanel } from "./components/DebugPanel";

/** Live plant count, read off the DOM for the debug label (cheap, on rAF). */
function useLivePlantCount(seed: string) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setN(document.querySelectorAll(".garden-svg [data-plant]").length);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [seed]);
  return n;
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
  const plantCount = useLivePlantCount(cfg.seed);

  const patch = useMemo(() => (p: Partial<GardenConfig>) => setCfg((c) => ({ ...c, ...p })), []);
  const reseed = useMemo(() => () => setCfg((c) => ({ ...c, seed: randomSeed() })), []);

  return (
    <main className="garden-root">
      <FlowerSelectionArticle cfg={cfg} reduced={reduced} />
      <footer className="garden-footer">
        <p>Drag across any paragraph. Release to let it fold back in.</p>
      </footer>
      <DebugPanel
        cfg={cfg}
        onChange={patch}
        onReseed={reseed}
        plantCount={plantCount}
        systemReduced={systemReduced}
      />
    </main>
  );
}
