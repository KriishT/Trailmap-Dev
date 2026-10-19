import Link from "next/link";
import { Stamp } from "@trailmap/ui";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { landingData } from "@/lib/demo/landing";

export const dynamic = "force-static";

const PLANS = [
  { name: "Open source", who: "One engineer, one repository", points: ["CLI: scan, vendors, evidence, check", "GitHub Action for pull request drift", "MCP server for coding agents", "Self-host the web app and worker"] },
  { name: "Team", who: "A product team that gets asked for diagrams", points: ["Hosted workspace and GitHub App", "Three sheets, revisions and time travel", "Vendor inventory with DPA tracking", "Expiring, password-protected share links"] },
  { name: "Compliance", who: "A company with an assessment on the calendar", points: ["PCI DSS, SOC 2 and DORA requirement notes", "Scope editor and drift acknowledgement trail", "Auditor export with title block and graph hash", "Drata, Vanta and webhook delivery"] },
  { name: "Enterprise", who: "Many repositories and strict data rules", points: ["Single sign-on", "Dedicated or self-hosted deployment", "Retention and audit log export", "Support agreement"] },
];

export default async function LandingPage() {
  const d = await landingData();
  const finding = d.drift.findings[0];

  return (
    <>
      <header className="app-header">
        <div className="wrap">
          <Brand />
          <nav className="nav" aria-label="Main">
            <a href="#how">How it works</a>
            <a href="#pricing">Plans</a>
            <a href="#security">Security</a>
          </nav>
          <span className="spacer" />
          <ThemeToggle />
          <Link className="btn btn-small" href="/sign-in">Sign in</Link>
        </div>
      </header>

      <main id="main">
        <div className="wrap">
          <section className="hero" aria-labelledby="hero-title">
            <div>
              <p className="eyebrow">For PCI DSS, SOC 2 and DORA reviews</p>
              <h1 id="hero-title">The architecture diagram your assessor asks for, drawn from the code.</h1>
              <p className="lede">Trailmap reads your repositories and draws the system, data-flow and network sheets, with the file and line behind every box and arrow. When a pull request changes what is in scope, it says so before merge.</p>
              <div className="hero-actions">
                <Link className="btn btn-primary" href="/demo">Open the sample workspace</Link>
                <Link className="btn" href="/sign-up">Scan your own repository</Link>
              </div>
              <p className="hint" style={{ marginTop: 14 }}>No sign-in for the sample. It shows a made-up online shop.</p>
            </div>
            <figure className="fig">
              <div className="sheet-frame">
                <div className="sheet-scroll" style={{ maxHeight: 520 }} role="img" aria-label="System architecture sheet of the sample shop, with the payment scope hatched and new elements highlighted">
                  <div className="theme-light-only" dangerouslySetInnerHTML={{ __html: d.sheet.svg.light }} />
                  <div className="theme-dark-only" dangerouslySetInnerHTML={{ __html: d.sheet.svg.dark }} />
                </div>
              </div>
              <figcaption>The real system sheet for the sample repository acme/shop at its latest revision. Hatching marks the payment scope; the highlighter marks what changed since the previous revision. Line style shows confidence.</figcaption>
            </figure>
          </section>
        </div>

        <section className="band" id="how" aria-labelledby="how-title">
          <div className="wrap">
            <h2 id="how-title">What a reviewer gets</h2>
            <p className="muted" style={{ maxWidth: "62ch", marginBottom: 24 }}>Three sheets and an inventory, each tied to the commit it was drawn from and to a hash of the data behind it.</p>
            <div className="cols cols-3">
              <div><h3>System architecture</h3><p className="muted">Services, datastores, queues and outside services as boxes. Connections are drawn solid, dashed or dotted by how sure the scanner is.</p></div>
              <div><h3>Data flow</h3><p className="muted">Where PAN, PII, PHI and credentials travel, stamped on the connection. A stamp with a question mark is possible but not confirmed in code.</p></div>
              <div><h3>Network and exposure</h3><p className="muted">Security groups, load balancers and ingress rules from Terraform, CloudFormation, Kubernetes and Helm, with what is open to the internet.</p></div>
            </div>
            <div className="cols cols-2" style={{ marginTop: 32 }}>
              <div>
                <h3>Every claim has a footnote</h3>
                {d.firstVendor ? (
                  <p className="muted" style={{ margin: "8px 0 12px" }}>Select any box or line and see the code behind it. For example, {d.firstVendor.name} is in the inventory because of:</p>
                ) : null}
                {d.firstVendor ? <pre className="codeblock" tabIndex={0}>{`${d.firstVendor.cite}\n${d.firstVendor.kind}: ${d.firstVendor.detail}${d.firstVendor.snippet ? `\n  ${d.firstVendor.snippet}` : ""}`}</pre> : null}
              </div>
              <div>
                <h3>The history is kept</h3>
                <ol className="timeline" aria-label="Revisions of the sample repository">
                  {[...d.revisions].reverse().slice(0, 4).map((r) => (
                    <li key={r.label}><span className="rev">{r.label}</span><span><span className="mono faint">{r.date}</span> {r.summary}</span></li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        </section>

        <section className="band" aria-labelledby="drift-title">
          <div className="wrap cols cols-2">
            <div>
              <h2 id="drift-title">Drift is caught in the pull request</h2>
              <p className="muted" style={{ margin: "8px 0 16px", maxWidth: "52ch" }}>A check runs on every pull request and compares it with the merged architecture. New vendors, regulated data reaching a vendor, a datastore opened to the internet, or data crossing your scope boundary all show up as findings with the lines that caused them. A named person acknowledges accepted risk, and that is recorded.</p>
              <Link className="btn" href="/demo?tab=review">See the review queue</Link>
            </div>
            <div className="panel" aria-label="Example pull request check">
              <div className="panel-head"><strong>Trailmap scope drift</strong><Stamp tone="bad">{d.drift.conclusion}</Stamp></div>
              <div className="panel-body stack">
                <p>{d.drift.summary}</p>
                {finding ? (
                  <div className={`finding sev-${finding.severity}`}>
                    <strong>{finding.title}</strong>
                    <p className="muted">{finding.detail}</p>
                  </div>
                ) : null}
                <p className="hint">From pull request #{d.drift.prNumber} in the sample repository.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="band" aria-labelledby="cli-title">
          <div className="wrap">
            <h2 id="cli-title">Works in a terminal and in CI</h2>
            <p className="muted" style={{ margin: "8px 0 16px", maxWidth: "62ch" }}>The scanner runs locally. Nothing leaves your machine unless you choose to upload the graph.</p>
            <pre className="codeblock" tabIndex={0} aria-label="Command line output">{`$ npx trailmap vendors\n${d.vendorsOutput}`}</pre>
          </div>
        </section>

        <section className="band" id="pricing" aria-labelledby="plans-title">
          <div className="wrap">
            <h2 id="plans-title">Plans</h2>
            <p className="muted" style={{ margin: "8px 0 24px", maxWidth: "62ch" }}>Prices are not published yet. The open source tier is the whole scanner, CLI and self-hostable app.</p>
            <div className="cols cols-4">
              {PLANS.map((p) => (
                <div className="plan" key={p.name}>
                  <h3>{p.name}</h3>
                  <p className="muted">{p.who}</p>
                  <ul>{p.points.map((x) => <li key={x}>{x}</li>)}</ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="band" id="security" aria-labelledby="sec-title">
          <div className="wrap cols cols-2">
            <div>
              <h2 id="sec-title">What we keep, and what we do not</h2>
              <ul className="muted" style={{ paddingLeft: 18, display: "grid", gap: 6, marginTop: 12 }}>
                <li>Source code is cloned to a temporary folder for a scan and deleted afterwards, whether the scan succeeds or fails. Only the graph is stored.</li>
                <li>Evidence snippets are cut to 120 characters and have secrets masked before they are stored.</li>
                <li>Access is enforced by the database for every table, so a bug in a page cannot show you another company&apos;s data.</li>
                <li>API keys and share-link passwords are stored only as hashes. The audit log cannot be edited.</li>
                <li>You can run the CLI in CI and upload nothing at all.</li>
              </ul>
            </div>
            <div>
              <h2>What this is not</h2>
              <p className="muted" style={{ marginTop: 12 }}>Trailmap supports an assessment by showing what the code does. It does not certify anything, and the requirement notes say what a person must still verify. Code cannot show who has access to a system, how staff are trained, or whether a policy is followed.</p>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap row" style={{ justifyContent: "space-between" }}>
          <span>Trailmap Evidence</span>
          <span className="row"><Link href="/demo">Sample workspace</Link><Link href="/sign-in">Sign in</Link></span>
        </div>
      </footer>
    </>
  );
}
