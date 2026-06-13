/** Settings — Layer 1 shell. Feature content ships in a later layer. */
export default function Page() {
  return (
    <div>
      <h1 className="font-display text-4xl tracking-wider">SETTINGS</h1>
      <p className="text-ink-muted text-sm mt-2">
        Layer 1 navigation shell. Business logic lands in the next layer.
      </p>
      <div className="mt-8 rounded-card border border-glass-border bg-surface shadow-depth-1 p-10 text-ink-dim text-sm">
        Settings content area
      </div>
    </div>
  );
}
