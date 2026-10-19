-- Security hardening: owner membership, shared-map isolation, atomic job claim.

-- 1. Owners must be members. Every org gets an 'owner' membership row.
CREATE OR REPLACE FUNCTION add_owner_as_member() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO org_members (org_id, user_id, role)
  VALUES (NEW.id, NEW.owner_user_id, 'owner')
  ON CONFLICT (org_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER organizations_add_owner_member
  AFTER INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION add_owner_as_member();

INSERT INTO org_members (org_id, user_id, role)
SELECT id, owner_user_id, 'owner' FROM organizations
ON CONFLICT (org_id, user_id) DO NOTHING;

-- 2. shared_maps: no more public listing. Owners see only their own rows, and the
--    password hash is never readable through the API roles.
DROP POLICY IF EXISTS shared_maps_select ON shared_maps;
CREATE POLICY shared_maps_select ON shared_maps FOR SELECT
  USING (created_by = auth.uid());

-- A user may only share a snapshot that belongs to one of their orgs.
DROP POLICY IF EXISTS shared_maps_insert ON shared_maps;
CREATE POLICY shared_maps_insert ON shared_maps FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM graph_snapshots s
      JOIN repos r ON r.id = s.repo_id
      WHERE s.id = shared_maps.snapshot_id AND is_org_member(r.org_id)
    )
  );

REVOKE ALL ON shared_maps FROM anon, authenticated;
GRANT SELECT (id, snapshot_id, slug, created_by, created_at, expires_at)
  ON shared_maps TO authenticated;
GRANT INSERT (snapshot_id, slug, created_by, expires_at) ON shared_maps TO authenticated;
GRANT DELETE ON shared_maps TO authenticated;

-- Public resolver: one slug in, only what the public page needs out.
-- Expired links resolve to nothing. The hash is reduced to a boolean.
CREATE OR REPLACE FUNCTION get_shared_map(p_slug TEXT)
RETURNS TABLE (
  snapshot_id UUID,
  repo_full_name TEXT,
  node_count INT,
  edge_count INT,
  scanned_at TIMESTAMPTZ,
  raw_json JSONB,
  requires_password BOOLEAN
) AS $$
  SELECT s.id, r.full_name, s.node_count, s.edge_count, s.scanned_at, s.raw_json,
         (m.password_hash IS NOT NULL)
  FROM shared_maps m
  JOIN graph_snapshots s ON s.id = m.snapshot_id
  JOIN repos r ON r.id = s.repo_id
  WHERE m.slug = p_slug
    AND (m.expires_at IS NULL OR m.expires_at > now())
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

REVOKE ALL ON FUNCTION get_shared_map(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_shared_map(TEXT) TO anon, authenticated, service_role;

-- 3. Atomic job claim: two workers can never receive the same scan_logs row.
CREATE OR REPLACE FUNCTION claim_scan_job()
RETURNS TABLE (id UUID, repo_id UUID) AS $$
  UPDATE scan_logs
  SET status = 'running', started_at = now()
  WHERE scan_logs.id = (
    SELECT sl.id FROM scan_logs sl
    WHERE sl.status = 'pending'
    ORDER BY sl.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING scan_logs.id, scan_logs.repo_id;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION claim_scan_job() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_scan_job() TO service_role;
