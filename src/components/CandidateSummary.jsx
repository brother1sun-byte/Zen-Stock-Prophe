export default function CandidateSummary({ children, ready }) {
  return (
    <section className={`jobs-brief actionable-insights ${ready ? 'ready' : 'watch'}`} data-testid="candidate-summary">
      {children}
    </section>
  );
}
