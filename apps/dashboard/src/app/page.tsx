import { DEFAULT_RING_DISTANCES } from "@adsb/shared";

export default function Home() {
  return (
    <main style={{ padding: "2rem", maxWidth: "800px", margin: "0 auto" }}>
      <h1>ADS-B Arrival Sequencing POC</h1>
      <p>Historical arrival sequence analysis and replay dashboard.</p>

      <section style={{ marginTop: "2rem" }}>
        <h2>Status</h2>
        <p>
          Dashboard is running. Pipeline implementation in progress.
        </p>
        <p>
          Default ring distances: {DEFAULT_RING_DISTANCES.join(", ")} NM
        </p>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2>Features (Planned)</h2>
        <ul>
          <li>Map view with aircraft positions</li>
          <li>Timeline scrubber for replay</li>
          <li>Rank visualization</li>
          <li>Sequence list sorted by churn score</li>
          <li>Kinematic data display</li>
        </ul>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2>Documentation</h2>
        <p>
          See <code>docs/</code> for architecture and data contracts.
        </p>
      </section>
    </main>
  );
}
