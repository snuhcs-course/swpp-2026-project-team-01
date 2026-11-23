// The fallback /app and /app/notes stream while the server reads the host's
// session. It is the workspace's own quiet background, not the sign-in spread,
// so a fast load shows nothing that looks like another page. Screen readers hear
// the status at once; sighted hosts see the line only if loading takes longer
// than a moment (`.workspace-loading` in globals.css).
export function WorkspaceLoading() {
  return (
    <div className="workspace-loading" role="status">
      <p>Loading your workspace…</p>
    </div>
  );
}
