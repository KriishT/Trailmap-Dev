-- Compliance layer: scopes, overrides, attestations, vendors, audit log, API keys, exports,
-- share-link controls, PR drift events, repo policy, and job kinds for PR checks.
-- Every table has row-level security. Writes that must not come from a browser session
-- (API keys, drift events, audit rows) have no policy for `authenticated` and are done by the
-- service role from server code.

-- ---------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION repo_org(p_repo UUID) RETURNS UUID AS $$
  SELECT org_id FROM repos WHERE id = p_repo;
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

CREATE OR REPLACE FUNCTION can_access_repo(p_repo UUID) RETURNS BOOLEAN AS $$
  SELECT is_org_member(repo_org(p_repo));
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

CREATE OR REPLACE FUNCTION is_org_admin(org UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_members
    WHERE org_id = org AND user_id = auth.uid() AND role IN ('owner', 'admin')
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

CREATE OR REPLACE FUNCTION can_admin_repo(p_repo UUID) RETURNS BOOLEAN AS $$
  SELECT is_org_admin(repo_org(p_repo));
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

REVOKE ALL ON FUNCTION repo_org(UUID), can_access_repo(UUID), is_org_admin(UUID), can_admin_repo(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION repo_org(UUID), can_access_repo(UUID), is_org_admin(UUID), can_admin_repo(UUID)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------
-- Scopes
-- ---------------------------------------------------------------------------------------
CREATE TABLE scopes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  repo_id UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  description TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (repo_id, name)
);

CREATE TABLE scope_members (
  scope_id UUID NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
  -- Stable node id from the graph ("service:apps/api", "db:postgres"); survives rescans.
  node_id TEXT NOT NULL CHECK (length(node_id) > 0),
  added_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_id, node_id)
);

ALTER TABLE scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE scope_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY scopes_select ON scopes FOR SELECT USING (can_access_repo(repo_id));
CREATE POLICY scopes_insert ON scopes FOR INSERT WITH CHECK (can_admin_repo(repo_id) AND created_by = auth.uid());
CREATE POLICY scopes_update ON scopes FOR UPDATE USING (can_admin_repo(repo_id)) WITH CHECK (can_admin_repo(repo_id));
CREATE POLICY scopes_delete ON scopes FOR DELETE USING (can_admin_repo(repo_id));

CREATE POLICY scope_members_select ON scope_members FOR SELECT
  USING (EXISTS (SELECT 1 FROM scopes s WHERE s.id = scope_id AND can_access_repo(s.repo_id)));
CREATE POLICY scope_members_insert ON scope_members FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM scopes s WHERE s.id = scope_id AND can_admin_repo(s.repo_id)));
CREATE POLICY scope_members_delete ON scope_members FOR DELETE
  USING (EXISTS (SELECT 1 FROM scopes s WHERE s.id = scope_id AND can_admin_repo(s.repo_id)));

-- ---------------------------------------------------------------------------------------
-- Overrides: human decisions layered over scanner output
-- ---------------------------------------------------------------------------------------
CREATE TABLE graph_overrides (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  repo_id UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('confirm_edge', 'hide_edge', 'add_edge', 'set_data_class', 'hide_node')),
  payload JSONB NOT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  actor_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES users(id)
);
CREATE INDEX idx_graph_overrides_repo ON graph_overrides(repo_id) WHERE revoked_at IS NULL;

ALTER TABLE graph_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY overrides_select ON graph_overrides FOR SELECT USING (can_access_repo(repo_id));
CREATE POLICY overrides_insert ON graph_overrides FOR INSERT
  WITH CHECK (can_admin_repo(repo_id) AND actor_id = auth.uid() AND revoked_at IS NULL);
CREATE POLICY overrides_revoke ON graph_overrides FOR UPDATE
  USING (can_admin_repo(repo_id)) WITH CHECK (can_admin_repo(repo_id));
-- Only the revocation columns may change; the decision itself is immutable.
REVOKE UPDATE ON graph_overrides FROM anon, authenticated;
GRANT UPDATE (revoked_at, revoked_by) ON graph_overrides TO authenticated;

-- ---------------------------------------------------------------------------------------
-- PR drift events (one per PR head commit) and attestations
-- ---------------------------------------------------------------------------------------
CREATE TABLE drift_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  repo_id UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  pr_number INT NOT NULL,
  head_sha TEXT NOT NULL,
  base_snapshot_id UUID REFERENCES graph_snapshots(id) ON DELETE SET NULL,
  head_graph_hash TEXT NOT NULL,
  findings JSONB NOT NULL DEFAULT '[]',
  ignored JSONB NOT NULL DEFAULT '[]',
  fingerprint TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  -- Blast radius / owners for the PR, kept so the comment can be re-rendered without re-scanning.
  impact JSONB NOT NULL DEFAULT '{}',
  policy_errors JSONB NOT NULL DEFAULT '[]',
  conclusion TEXT NOT NULL CHECK (conclusion IN ('success', 'neutral', 'failure')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged')),
  check_run_id BIGINT,
  comment_id BIGINT,
  acknowledged_by TEXT,
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (repo_id, pr_number, head_sha)
);
CREATE INDEX idx_drift_events_repo ON drift_events(repo_id, created_at DESC);
CREATE TRIGGER drift_events_updated_at BEFORE UPDATE ON drift_events FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE drift_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY drift_events_select ON drift_events FOR SELECT USING (can_access_repo(repo_id));
-- inserts and status changes come from the worker (service role)

CREATE TABLE attestations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  repo_id UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('snapshot_review', 'drift_ack')),
  -- The attestation is bound to the exact graph content that was reviewed.
  graph_hash TEXT NOT NULL CHECK (length(graph_hash) > 0),
  snapshot_id UUID REFERENCES graph_snapshots(id) ON DELETE SET NULL,
  drift_event_id UUID REFERENCES drift_events(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Who, in words: the user's email or a GitHub login. Kept even if the user row goes away.
  actor_label TEXT NOT NULL CHECK (length(trim(actor_label)) > 0),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_attestations_repo ON attestations(repo_id, created_at DESC);

ALTER TABLE attestations ENABLE ROW LEVEL SECURITY;
CREATE POLICY attestations_select ON attestations FOR SELECT USING (can_access_repo(repo_id));
CREATE POLICY attestations_insert ON attestations FOR INSERT
  WITH CHECK (can_access_repo(repo_id) AND actor_user_id = auth.uid());
-- no UPDATE or DELETE policy: attestations are immutable

-- ---------------------------------------------------------------------------------------
-- Vendors: manual metadata for detected vendors
-- ---------------------------------------------------------------------------------------
CREATE TABLE vendors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vendor_id TEXT NOT NULL,
  purpose TEXT,
  region TEXT,
  dpa_on_file BOOLEAN,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'detected' CHECK (source IN ('detected', 'manual')),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, vendor_id)
);
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
CREATE POLICY vendors_select ON vendors FOR SELECT USING (is_org_member(org_id));
CREATE POLICY vendors_insert ON vendors FOR INSERT WITH CHECK (is_org_admin(org_id) AND updated_by = auth.uid());
CREATE POLICY vendors_update ON vendors FOR UPDATE USING (is_org_admin(org_id)) WITH CHECK (is_org_admin(org_id));

-- ---------------------------------------------------------------------------------------
-- Audit log: append-only
-- ---------------------------------------------------------------------------------------
CREATE TABLE audit_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Plain column, not a foreign key: audit rows must outlive what they describe.
  org_id UUID,
  repo_id UUID,
  actor_user_id UUID,
  actor_type TEXT NOT NULL DEFAULT 'user' CHECK (actor_type IN ('user', 'system', 'api_key', 'github')),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_events_org ON audit_events(org_id, created_at DESC);

CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% rejected)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON audit_events FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_events_select ON audit_events FOR SELECT USING (org_id IS NOT NULL AND is_org_member(org_id));
REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM anon, authenticated, service_role;
REVOKE INSERT ON audit_events FROM anon, authenticated;

-- Record changes to compliance tables automatically, so the trail does not depend on every
-- code path remembering to log. Secret columns never enter the log.
CREATE OR REPLACE FUNCTION audit_row_change() RETURNS TRIGGER AS $$
DECLARE
  row_json JSONB := to_jsonb(NEW) - 'key_hash' - 'password_hash';
  v_org UUID;
  v_repo UUID;
BEGIN
  IF row_json ? 'repo_id' THEN
    v_repo := (row_json ->> 'repo_id')::uuid;
    v_org := repo_org(v_repo);
  ELSIF TG_TABLE_NAME = 'scope_members' THEN
    SELECT s.repo_id INTO v_repo FROM scopes s WHERE s.id = NEW.scope_id;
    v_org := repo_org(v_repo);
  ELSIF row_json ? 'org_id' THEN
    v_org := (row_json ->> 'org_id')::uuid;
  END IF;
  INSERT INTO audit_events (org_id, repo_id, actor_user_id, actor_type, action, target_type, target_id, metadata)
  VALUES (
    v_org, v_repo, auth.uid(), CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'user' END,
    TG_TABLE_NAME || '.' || lower(TG_OP), TG_TABLE_NAME,
    COALESCE(row_json ->> 'id', row_json ->> 'node_id'),
    jsonb_build_object('row', row_json)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER scopes_audit AFTER INSERT OR UPDATE ON scopes FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER scope_members_audit AFTER INSERT ON scope_members FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER graph_overrides_audit AFTER INSERT OR UPDATE ON graph_overrides FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER attestations_audit AFTER INSERT ON attestations FOR EACH ROW EXECUTE FUNCTION audit_row_change();
-- An attestation is a signed-off statement; it can be superseded by a new one but never edited or removed.
-- Foreign-key actions (ON DELETE CASCADE / SET NULL, for example when a repo is deleted) run at
-- trigger depth 2 or more; a direct UPDATE or DELETE runs at depth 1 and is refused.
CREATE OR REPLACE FUNCTION reject_attestation_mutation() RETURNS TRIGGER AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'attestations is append-only (% rejected)', TG_OP USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER attestations_immutable BEFORE UPDATE OR DELETE ON attestations FOR EACH ROW EXECUTE FUNCTION reject_attestation_mutation();
CREATE TRIGGER vendors_audit AFTER INSERT OR UPDATE ON vendors FOR EACH ROW EXECUTE FUNCTION audit_row_change();

-- ---------------------------------------------------------------------------------------
-- API keys: only a hash is stored
-- ---------------------------------------------------------------------------------------
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  -- First characters of the key, shown so people can tell keys apart. Not enough to use the key.
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE CHECK (length(key_hash) = 64),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_keys_select ON api_keys FOR SELECT USING (is_org_admin(org_id));
REVOKE ALL ON api_keys FROM anon, authenticated;
GRANT SELECT (id, org_id, name, prefix, created_by, created_at, last_used_at, revoked_at) ON api_keys TO authenticated;
CREATE TRIGGER api_keys_audit AFTER INSERT OR UPDATE ON api_keys FOR EACH ROW EXECUTE FUNCTION audit_row_change();

-- Resolve a presented key (by hash) to its org. Server-side only.
CREATE OR REPLACE FUNCTION lookup_api_key(p_hash TEXT) RETURNS TABLE (id UUID, org_id UUID) AS $$
  UPDATE api_keys SET last_used_at = now()
  WHERE key_hash = p_hash AND revoked_at IS NULL
  RETURNING api_keys.id, api_keys.org_id;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;
REVOKE ALL ON FUNCTION lookup_api_key(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lookup_api_key(TEXT) TO service_role;

-- ---------------------------------------------------------------------------------------
-- Evidence pack exports
-- ---------------------------------------------------------------------------------------
CREATE TABLE exports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  repo_id UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  snapshot_id UUID REFERENCES graph_snapshots(id) ON DELETE SET NULL,
  graph_hash TEXT NOT NULL,
  framework TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('pdf', 'svg', 'json', 'csv', 'pack')),
  -- sha256 of the exported file, so the file in an auditor's hands can be matched to this record
  file_hash TEXT NOT NULL CHECK (length(file_hash) = 64),
  period_start DATE,
  period_end DATE,
  prepared_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE exports ENABLE ROW LEVEL SECURITY;
CREATE POLICY exports_select ON exports FOR SELECT USING (can_access_repo(repo_id));
CREATE POLICY exports_insert ON exports FOR INSERT WITH CHECK (can_access_repo(repo_id) AND prepared_by = auth.uid());
CREATE TRIGGER exports_audit AFTER INSERT ON exports FOR EACH ROW EXECUTE FUNCTION audit_row_change();

-- ---------------------------------------------------------------------------------------
-- Repo policy set in the app (overrides .trailmap.yml field by field)
-- ---------------------------------------------------------------------------------------
CREATE TABLE repo_policies (
  repo_id UUID PRIMARY KEY REFERENCES repos(id) ON DELETE CASCADE,
  config JSONB NOT NULL DEFAULT '{}',
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE repo_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY repo_policies_select ON repo_policies FOR SELECT USING (can_access_repo(repo_id));
CREATE POLICY repo_policies_insert ON repo_policies FOR INSERT WITH CHECK (can_admin_repo(repo_id) AND updated_by = auth.uid());
CREATE POLICY repo_policies_update ON repo_policies FOR UPDATE USING (can_admin_repo(repo_id)) WITH CHECK (can_admin_repo(repo_id));
CREATE TRIGGER repo_policies_audit AFTER INSERT OR UPDATE ON repo_policies FOR EACH ROW EXECUTE FUNCTION audit_row_change();

-- ---------------------------------------------------------------------------------------
-- Share links: revocation, watermark label, access log
-- ---------------------------------------------------------------------------------------
ALTER TABLE shared_maps ADD COLUMN revoked_at TIMESTAMPTZ;
ALTER TABLE shared_maps ADD COLUMN label TEXT;

GRANT SELECT (revoked_at, label) ON shared_maps TO authenticated;
GRANT INSERT (label) ON shared_maps TO authenticated;
DROP POLICY IF EXISTS shared_maps_update ON shared_maps;
CREATE POLICY shared_maps_update ON shared_maps FOR UPDATE USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());
GRANT UPDATE (revoked_at, expires_at, label) ON shared_maps TO authenticated;

CREATE TABLE shared_map_access (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shared_map_id UUID NOT NULL REFERENCES shared_maps(id) ON DELETE CASCADE,
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A salted hash of the visitor's address, not the address itself.
  ip_hash TEXT,
  user_agent TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('ok', 'bad_password', 'expired', 'revoked'))
);
CREATE INDEX idx_shared_map_access_map ON shared_map_access(shared_map_id, accessed_at DESC);
ALTER TABLE shared_map_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY shared_map_access_select ON shared_map_access FOR SELECT
  USING (EXISTS (SELECT 1 FROM shared_maps m WHERE m.id = shared_map_id AND m.created_by = auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON shared_map_access FROM anon, authenticated;

-- Public resolver now also hides revoked links and returns the watermark label.
DROP FUNCTION IF EXISTS get_shared_map(TEXT);
CREATE FUNCTION get_shared_map(p_slug TEXT)
RETURNS TABLE (
  shared_map_id UUID,
  snapshot_id UUID,
  repo_full_name TEXT,
  node_count INT,
  edge_count INT,
  scanned_at TIMESTAMPTZ,
  raw_json JSONB,
  requires_password BOOLEAN,
  label TEXT
) AS $$
  SELECT m.id, s.id, r.full_name, s.node_count, s.edge_count, s.scanned_at, s.raw_json,
         (m.password_hash IS NOT NULL), m.label
  FROM shared_maps m
  JOIN graph_snapshots s ON s.id = m.snapshot_id
  JOIN repos r ON r.id = s.repo_id
  WHERE m.slug = p_slug
    AND m.revoked_at IS NULL
    AND (m.expires_at IS NULL OR m.expires_at > now())
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;
REVOKE ALL ON FUNCTION get_shared_map(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_shared_map(TEXT) TO anon, authenticated, service_role;

-- For password checks and the access log: reveals the hash, so server-side only.
CREATE OR REPLACE FUNCTION get_shared_map_auth(p_slug TEXT)
RETURNS TABLE (id UUID, password_hash TEXT, expires_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ) AS $$
  SELECT m.id, m.password_hash, m.expires_at, m.revoked_at FROM shared_maps m WHERE m.slug = p_slug LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;
REVOKE ALL ON FUNCTION get_shared_map_auth(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_shared_map_auth(TEXT) TO service_role;

-- ---------------------------------------------------------------------------------------
-- Job kinds: scans, PR drift checks, and re-checks after an acknowledgement
-- ---------------------------------------------------------------------------------------
ALTER TABLE scan_logs ADD COLUMN kind TEXT NOT NULL DEFAULT 'scan' CHECK (kind IN ('scan', 'pr_check', 'pr_recheck'));
ALTER TABLE scan_logs ADD COLUMN payload JSONB NOT NULL DEFAULT '{}';

DROP FUNCTION IF EXISTS claim_scan_job();
CREATE FUNCTION claim_scan_job()
RETURNS TABLE (id UUID, repo_id UUID, kind TEXT, payload JSONB) AS $$
  UPDATE scan_logs
  SET status = 'running', started_at = now()
  WHERE scan_logs.id = (
    SELECT sl.id FROM scan_logs sl
    WHERE sl.status = 'pending'
    ORDER BY sl.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING scan_logs.id, scan_logs.repo_id, scan_logs.kind, scan_logs.payload;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;
REVOKE ALL ON FUNCTION claim_scan_job() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_scan_job() TO service_role;
