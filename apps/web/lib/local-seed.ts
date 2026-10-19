import type { LocalDb } from "@trailmap/localdb";
import { evaluateDrift, parsePolicy, prepareGraphForWrite, type DependencyGraph } from "@trailmap/graph";
import demo from "./demo/demo-data.json";
import { LOCAL_ORGS, LOCAL_REPOS, LOCAL_USERS } from "./local-mode";

interface DemoRevision { label: string; date: string; commit: string; graph: DependencyGraph }

const rev = () => (demo as unknown as { revisions: DemoRevision[] }).revisions;

/** Populate a fresh local database with a realistic demo org: history, a scope, overrides, vendor notes, a drift event and a review. */
export async function seedLocalDb(db: LocalDb): Promise<void> {
  const { kay, lee, mia } = LOCAL_USERS;
  for (const u of [kay, lee, mia]) {
    await db.admin(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`, [u!.id, u!.email, JSON.stringify({ full_name: u!.name, user_name: u!.email.split("@")[0] })]);
  }
  await db.admin(`INSERT INTO organizations (id, github_org_id, github_org_name, github_installation_id, owner_user_id) VALUES ($1, 1, 'acme', 4242, $2), ($3, 2, 'beta', 5252, $4) ON CONFLICT DO NOTHING`, [LOCAL_ORGS.acme, kay!.id, LOCAL_ORGS.beta, mia!.id]);
  await db.admin(`INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`, [LOCAL_ORGS.acme, lee!.id]);
  await db.admin(`INSERT INTO repos (id, org_id, github_repo_id, name, full_name, default_branch, private, is_active) VALUES ($1, $2, 1001, 'shop', 'acme/shop', 'main', true, true), ($3, $4, 2001, 'private', 'beta/private', 'main', true, true) ON CONFLICT DO NOTHING`, [LOCAL_REPOS.shop, LOCAL_ORGS.acme, LOCAL_REPOS.betaPrivate, LOCAL_ORGS.beta]);

  const snapshotIds: string[] = [];
  for (const r of rev()) {
    const graph = prepareGraphForWrite(r.graph);
    const row = await db.admin<{ id: string }>(
      `INSERT INTO graph_snapshots (repo_id, scanned_at, node_count, edge_count, total_files, language_breakdown, raw_json, commit_sha, branch) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'main') RETURNING id`,
      [LOCAL_REPOS.shop, r.date, graph.nodes.length, graph.edges.length, graph.meta.total_files, JSON.stringify(graph.meta.language_breakdown), JSON.stringify(graph), r.commit]
    );
    snapshotIds.push(row[0]!.id);
  }
  const latest = prepareGraphForWrite(rev().at(-1)!.graph);
  await db.admin(`UPDATE repos SET last_scanned_at = $2 WHERE id = $1`, [LOCAL_REPOS.shop, rev().at(-1)!.date]);
  const betaGraph = prepareGraphForWrite({ ...rev()[0]!.graph, meta: { ...rev()[0]!.graph.meta, repo: "beta/private" } });
  await db.admin(`INSERT INTO graph_snapshots (repo_id, raw_json, node_count, edge_count, commit_sha, branch) VALUES ($1, $2, $3, $4, 'beef00', 'main')`, [LOCAL_REPOS.betaPrivate, JSON.stringify(betaGraph), betaGraph.nodes.length, betaGraph.edges.length]);

  const d = demo as unknown as { scope: { name: string; nodeIds: string[] }; vendorMeta: Array<{ vendorId: string; purpose: string; region: string; dpaOnFile: boolean }>; pullRequest: { number: number; headSha: string; graph: DependencyGraph }; policy: string };
  const scope = await db.admin<{ id: string }>(`INSERT INTO scopes (repo_id, name, description, created_by) VALUES ($1, $2, 'Systems that store, process or transmit cardholder data', $3) RETURNING id`, [LOCAL_REPOS.shop, d.scope.name, kay!.id]);
  for (const id of d.scope.nodeIds) await db.admin(`INSERT INTO scope_members (scope_id, node_id, added_by) VALUES ($1, $2, $3)`, [scope[0]!.id, id, kay!.id]);

  const confirm = latest.edges.find((e) => e.from === "service:services/orders" && e.to === "vendor:twilio");
  if (confirm?.id) {
    await db.admin(`INSERT INTO graph_overrides (repo_id, kind, payload, reason, actor_id) VALUES ($1, 'confirm_edge', $2, 'Checked the notification code path: orders sends SMS on every order.', $3)`, [LOCAL_REPOS.shop, JSON.stringify({ edgeId: confirm.id }), kay!.id]);
  }
  for (const v of d.vendorMeta) {
    await db.admin(`INSERT INTO vendors (org_id, vendor_id, purpose, region, dpa_on_file, updated_by) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`, [LOCAL_ORGS.acme, v.vendorId, v.purpose, v.region, v.dpaOnFile, kay!.id]);
  }

  // Quarterly review of Rev E, signed off before the exposure change in Rev F.
  const revE = prepareGraphForWrite(rev()[4]!.graph);
  await db.admin(`INSERT INTO attestations (repo_id, kind, graph_hash, snapshot_id, actor_user_id, actor_label, note, created_at) VALUES ($1, 'snapshot_review', $2, $3, $4, $5, 'Q2 architecture review for the PCI scope confirmation.', $6)`, [LOCAL_REPOS.shop, revE.meta.graphHash, snapshotIds[4], kay!.id, kay!.email, "2026-06-02T10:00:00.000Z"]);

  // An evidence pack handed to the assessor after that review.
  await db.admin(`INSERT INTO exports (repo_id, snapshot_id, graph_hash, framework, format, file_hash, period_start, period_end, prepared_by, created_at) VALUES ($1, $2, $3, 'pci-dss', 'pdf', $4, '2025-07-01', '2026-06-30', $5, $6)`, [LOCAL_REPOS.shop, snapshotIds[4], revE.meta.graphHash, "e".repeat(64), kay!.id, "2026-06-03T09:00:00.000Z"]);

  // A pull request whose check already failed, waiting for someone to acknowledge it.
  const policy = parsePolicy(d.policy).policy;
  const base = latest;
  const head = prepareGraphForWrite(d.pullRequest.graph);
  const result = evaluateDrift({ base, head, scopes: [{ id: scope[0]!.id, name: d.scope.name, nodeIds: d.scope.nodeIds }], policy });
  await db.admin(
    `INSERT INTO drift_events (repo_id, pr_number, head_sha, base_snapshot_id, head_graph_hash, findings, ignored, fingerprint, summary, conclusion, status) VALUES ($1, $2, $3, $4, $5, $6, '[]', '', $7, $8, 'open')`,
    [LOCAL_REPOS.shop, d.pullRequest.number, d.pullRequest.headSha, snapshotIds.at(-1), head.meta.graphHash, JSON.stringify(result.findings), result.summary, result.conclusion]
  );
}
