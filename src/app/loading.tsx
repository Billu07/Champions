export default function AppLoading() {
  return (
    <main className="page">
      <div className="card grid" style={{ gap: 10 }}>
        <div className="loading-line loading-line-lg" />
        <div className="loading-line" />
        <div className="loading-line" />
      </div>
      <section className="kpi-grid" style={{ marginTop: 12 }}>
        {Array.from({ length: 4 }).map((_, index) => (
          <article className="card" key={index}>
            <div className="loading-line" />
            <div className="loading-line loading-line-lg" />
          </article>
        ))}
      </section>
    </main>
  );
}
