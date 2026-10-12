// Placeholder for Stage S1. It exists so the public Vercel link works from day one;
// the real interface replaces it in Stage S6.
export default function Home() {
  return (
    <main>
      <h1>Partnership Scout</h1>
      <p className="muted">
        Find newly launched tools worth a partnership call, from Product Hunt&apos;s last 7 days.
      </p>
      <div className="card">
        <strong>Under construction.</strong> The scout is being built stage by stage. This page
        will soon list the best partnership candidates with a product-specific outreach angle.
      </div>
      <p className="muted" style={{ marginTop: 32 }}>
        <a href="https://www.producthunt.com" target="_blank" rel="noopener noreferrer">
          Powered by Product Hunt
        </a>
      </p>
    </main>
  );
}
