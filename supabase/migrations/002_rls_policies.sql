-- Row Level Security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE repos ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_maps ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;

-- Helper: is current user a member of this org?
CREATE OR REPLACE FUNCTION is_org_member(org UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_members
    WHERE org_id = org AND user_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Users: see and edit only yourself
CREATE POLICY users_select ON users FOR SELECT USING (id = auth.uid());
CREATE POLICY users_update ON users FOR UPDATE USING (id = auth.uid());

-- Organizations: visible to members; created by owner
CREATE POLICY orgs_select ON organizations FOR SELECT USING (is_org_member(id));
CREATE POLICY orgs_insert ON organizations FOR INSERT WITH CHECK (owner_user_id = auth.uid());
CREATE POLICY orgs_update ON organizations FOR UPDATE USING (owner_user_id = auth.uid());

-- Repos: org members only
CREATE POLICY repos_select ON repos FOR SELECT USING (is_org_member(org_id));
CREATE POLICY repos_insert ON repos FOR INSERT WITH CHECK (is_org_member(org_id));
CREATE POLICY repos_update ON repos FOR UPDATE USING (is_org_member(org_id));

-- Snapshots: org members only
CREATE POLICY snapshots_select ON graph_snapshots FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM repos WHERE repos.id = graph_snapshots.repo_id AND is_org_member(repos.org_id)
  ));

-- Shared maps: publicly readable (no auth required for public links)
CREATE POLICY shared_maps_select ON shared_maps FOR SELECT USING (true);
CREATE POLICY shared_maps_insert ON shared_maps FOR INSERT WITH CHECK (created_by = auth.uid());
CREATE POLICY shared_maps_delete ON shared_maps FOR DELETE USING (created_by = auth.uid());

-- Scan logs: org members only
CREATE POLICY scan_logs_select ON scan_logs FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM repos WHERE repos.id = scan_logs.repo_id AND is_org_member(repos.org_id)
  ));

-- Org members: visible to members of the same org
CREATE POLICY org_members_select ON org_members FOR SELECT USING (is_org_member(org_id));
