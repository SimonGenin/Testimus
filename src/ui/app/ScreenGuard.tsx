import { Component, type ReactNode } from "react";
import { Button } from "../components/ui/Button.tsx";
import { EmptyState } from "../components/ui/EmptyState.tsx";

type Props = { children: ReactNode; route: string; onReload?: () => void };
type State = { error: Error | null };

// ponytail: a screen that throws while drawing (a doc.json the screen cannot read) leaves the shell standing — the
// rail, the bar and the dock stay, the screen says what broke and offers Reload, and going elsewhere tries again;
// React needs a class for this
export class ScreenGuard extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidUpdate(before: Props) {
    if (this.state.error && before.route !== this.props.route) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <EmptyState
        icon="alert-triangle"
        title="This screen could not be drawn"
        text={error.message || "An unexpected error."}
        actions={
          <Button
            variant="primary"
            icon="refresh"
            label="Reload"
            onClick={() => (this.props.onReload ? this.props.onReload() : window.location.reload())}
          />
        }
      />
    );
  }
}
