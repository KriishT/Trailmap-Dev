import Link from "next/link";
import { Stamp, Table, Td, Th, Tr } from "@trailmap/ui";
import { ScanButton } from "./scan-button";

interface Snapshot {
  id: string;
  node_count: number;
  edge_count: number;
  scanned_at: string;
}

export interface RepoSummary {
  id: string;
  name: string;
  full_name: string;
  last_scanned_at: string | null;
  private: boolean;
  is_active: boolean;
  graph_snapshots: Snapshot[];
}

export function RepoList({ repos, local }: { repos: RepoSummary[]; local: boolean }) {
  return (
    <Table caption="Repositories">
      <thead>
        <tr><Th>Repository</Th><Th>Visibility</Th><Th>Last scan</Th><Th>Elements</Th><Th>Connections</Th><Th><span className="sr-only">Actions</span></Th></tr>
      </thead>
      <tbody>
        {repos.map((repo) => {
          const latest = repo.graph_snapshots?.[0];
          return (
            <Tr key={repo.id}>
              <Td><Link href={`/repos/${repo.id}`} className="mono"><strong>{repo.full_name}</strong></Link></Td>
              <Td>{repo.private ? <Stamp>Private</Stamp> : <Stamp tone="plain">Public</Stamp>}</Td>
              <Td className="mono">{latest ? latest.scanned_at.slice(0, 10) : "Not yet"}</Td>
              <Td className="mono">{latest ? latest.node_count : "-"}</Td>
              <Td className="mono">{latest ? latest.edge_count : "-"}</Td>
              <Td>
                <div className="row">
                  {latest ? <Link className="btn btn-small" href={`/repos/${repo.id}`}>Open</Link> : null}
                  <ScanButton repoId={repo.id} local={local} label={latest ? "Rescan" : "Run first scan"} />
                </div>
              </Td>
            </Tr>
          );
        })}
      </tbody>
    </Table>
  );
}
