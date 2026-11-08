import { lazy, memo, Suspense } from "react";
import type { Screen } from "../lib/app.ts";

// ponytail: one chunk per screen, read the first time it is shown (the shell and the kit are in the page's own); the
// imports are written out so the bundler sees each one
const SCREEN: Record<Screen, React.LazyExoticComponent<() => React.JSX.Element>> = {
  tests: lazy(() => import("../screens/tests/TestsScreen.tsx").then((m) => ({ default: m.TestsScreen }))),
  documents: lazy(() =>
    import("../screens/documents/DocumentsScreen.tsx").then((m) => ({ default: m.DocumentsScreen })),
  ),
  generate: lazy(() => import("../screens/generate/GenerateScreen.tsx").then((m) => ({ default: m.GenerateScreen }))),
  review: lazy(() => import("../screens/review/ReviewScreen.tsx").then((m) => ({ default: m.ReviewScreen }))),
  run: lazy(() => import("../screens/run/RunScreen.tsx").then((m) => ({ default: m.RunScreen }))),
  jobs: lazy(() => import("../screens/jobs/JobsScreen.tsx").then((m) => ({ default: m.JobsScreen }))),
  doctor: lazy(() => import("../screens/doctor/DoctorScreen.tsx").then((m) => ({ default: m.DoctorScreen }))),
  kit: lazy(() => import("../screens/kit/KitScreen.tsx").then((m) => ({ default: m.KitScreen }))),
  settings: lazy(() => import("../screens/settings/SettingsScreen.tsx").then((m) => ({ default: m.SettingsScreen }))),
  setup: lazy(() => import("../screens/setup/FirstRunScreen.tsx").then((m) => ({ default: m.FirstRunScreen }))),
};

// ponytail: the routes — one screen per hash; the shell drawing itself again (the dock resized, a job started) does not
// draw the screen again, only what the screen reads does. While a screen's chunk arrives (a few ms from this PC) the
// pane stays empty: a skeleton would only flash
export const Screens = memo(function Screens({ screen }: { screen: Screen }) {
  const Shown = SCREEN[screen];
  return (
    <Suspense fallback={null}>
      <Shown />
    </Suspense>
  );
});
