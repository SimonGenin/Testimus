import { memo } from "react";
import type { Screen } from "../lib/app.ts";
import { DoctorScreen } from "../screens/doctor/DoctorScreen.tsx";
import { DocumentsScreen } from "../screens/documents/DocumentsScreen.tsx";
import { GenerateScreen } from "../screens/generate/GenerateScreen.tsx";
import { JobsScreen } from "../screens/jobs/JobsScreen.tsx";
import { KitScreen } from "../screens/kit/KitScreen.tsx";
import { ReviewScreen } from "../screens/review/ReviewScreen.tsx";
import { RunScreen } from "../screens/run/RunScreen.tsx";
import { SettingsScreen } from "../screens/settings/SettingsScreen.tsx";
import { FirstRunScreen } from "../screens/setup/FirstRunScreen.tsx";
import { TestsScreen } from "../screens/tests/TestsScreen.tsx";

const SCREEN: Record<Screen, () => React.JSX.Element> = {
  tests: TestsScreen,
  documents: DocumentsScreen,
  generate: GenerateScreen,
  review: ReviewScreen,
  run: RunScreen,
  jobs: JobsScreen,
  doctor: DoctorScreen,
  kit: KitScreen,
  settings: SettingsScreen,
  setup: FirstRunScreen,
};

// ponytail: the routes — one screen per hash; the shell drawing itself again (the dock resized, a job started) does not
// draw the screen again, only what the screen reads does
export const Screens = memo(function Screens({ screen }: { screen: Screen }) {
  const Shown = SCREEN[screen];
  return <Shown />;
});
