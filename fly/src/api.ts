const BASE = 'https://api.machines.dev/v1';

async function request(
  token: string,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  query?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${BASE}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
  if (body && method !== 'GET') {
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url.toString(), init);
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return { success: true, status: res.status };
  }
  const text = await res.text();
  if (!text) return { success: true, status: res.status };
  return JSON.parse(text);
}

// ── Apps ────────────────────────────────────────────────────────────────────

export const listApps = (token: string, org_slug: string, app_role?: string) =>
  request(token, 'GET', '/apps', undefined, { org_slug, app_role });

export const createApp = (token: string, body: { name?: string; org_slug?: string; network?: string; enable_subdomains?: boolean }) =>
  request(token, 'POST', '/apps', body as Record<string, unknown>);

export const getApp = (token: string, app_name: string) =>
  request(token, 'GET', `/apps/${app_name}`);

export const destroyApp = (token: string, app_name: string) =>
  request(token, 'DELETE', `/apps/${app_name}`);

export const createDeployToken = (token: string, app_name: string, expiry?: string) =>
  request(token, 'POST', `/apps/${app_name}/deploy_token`, { expiry });

export const listIpAssignments = (token: string, app_name: string) =>
  request(token, 'GET', `/apps/${app_name}/ip_assignments`);

export const assignIp = (token: string, app_name: string, body: { network?: string; org_slug?: string; region?: string; service_name?: string; type?: string }) =>
  request(token, 'POST', `/apps/${app_name}/ip_assignments`, body as Record<string, unknown>);

export const removeIp = (token: string, app_name: string, ip: string) =>
  request(token, 'DELETE', `/apps/${app_name}/ip_assignments/${ip}`);

// ── Machines ─────────────────────────────────────────────────────────────────

export const listMachines = (token: string, app_name: string, q?: { region?: string; include_deleted?: boolean }) =>
  request(token, 'GET', `/apps/${app_name}/machines`, undefined, q as Record<string, unknown>);

export const createMachine = (token: string, app_name: string, body: Record<string, unknown>) =>
  request(token, 'POST', `/apps/${app_name}/machines`, body);

export const getMachine = (token: string, app_name: string, machine_id: string) =>
  request(token, 'GET', `/apps/${app_name}/machines/${machine_id}`);

export const updateMachine = (token: string, app_name: string, machine_id: string, body: Record<string, unknown>) =>
  request(token, 'POST', `/apps/${app_name}/machines/${machine_id}`, body);

export const deleteMachine = (token: string, app_name: string, machine_id: string, force?: boolean) =>
  request(token, 'DELETE', `/apps/${app_name}/machines/${machine_id}`, undefined, force !== undefined ? { force } : undefined);

export const startMachine = (token: string, app_name: string, machine_id: string) =>
  request(token, 'POST', `/apps/${app_name}/machines/${machine_id}/start`);

export const stopMachine = (token: string, app_name: string, machine_id: string, body?: { signal?: string; timeout?: number }) =>
  request(token, 'POST', `/apps/${app_name}/machines/${machine_id}/stop`, body as Record<string, unknown>);

export const restartMachine = (token: string, app_name: string, machine_id: string, body?: { force_stop?: boolean; signal?: string; timeout?: number }) =>
  request(token, 'POST', `/apps/${app_name}/machines/${machine_id}/restart`, body as Record<string, unknown>);

export const suspendMachine = (token: string, app_name: string, machine_id: string) =>
  request(token, 'POST', `/apps/${app_name}/machines/${machine_id}/suspend`);

export const cordonMachine = (token: string, app_name: string, machine_id: string) =>
  request(token, 'POST', `/apps/${app_name}/machines/${machine_id}/cordon`);

export const uncordonMachine = (token: string, app_name: string, machine_id: string) =>
  request(token, 'POST', `/apps/${app_name}/machines/${machine_id}/uncordon`);

export const signalMachine = (token: string, app_name: string, machine_id: string, signal: string) =>
  request(token, 'POST', `/apps/${app_name}/machines/${machine_id}/signal`, { signal });

export const execMachine = (token: string, app_name: string, machine_id: string, body: { cmd?: string[]; command?: string[]; timeout?: number }) =>
  request(token, 'POST', `/apps/${app_name}/machines/${machine_id}/exec`, body as Record<string, unknown>);

export const getMachineEvents = (token: string, app_name: string, machine_id: string) =>
  request(token, 'GET', `/apps/${app_name}/machines/${machine_id}/events`);

export const getMachineLease = (token: string, app_name: string, machine_id: string) =>
  request(token, 'GET', `/apps/${app_name}/machines/${machine_id}/lease`);

export const acquireMachineLease = (token: string, app_name: string, machine_id: string, body?: { description?: string; expires_in?: number }) =>
  request(token, 'POST', `/apps/${app_name}/machines/${machine_id}/lease`, body as Record<string, unknown>);

export const releaseMachineLease = (token: string, app_name: string, machine_id: string) =>
  request(token, 'DELETE', `/apps/${app_name}/machines/${machine_id}/lease`);

export const getMachineMemory = (token: string, app_name: string, machine_id: string) =>
  request(token, 'GET', `/apps/${app_name}/machines/${machine_id}/memory`);

export const updateMachineMemory = (token: string, app_name: string, machine_id: string, body: Record<string, unknown>) =>
  request(token, 'PUT', `/apps/${app_name}/machines/${machine_id}/memory`, body);

export const reclaimMachineMemory = (token: string, app_name: string, machine_id: string) =>
  request(token, 'POST', `/apps/${app_name}/machines/${machine_id}/memory/reclaim`);

export const getMachineMetadata = (token: string, app_name: string, machine_id: string) =>
  request(token, 'GET', `/apps/${app_name}/machines/${machine_id}/metadata`);

export const updateMachineMetadata = (token: string, app_name: string, machine_id: string, body: Record<string, unknown>) =>
  request(token, 'PUT', `/apps/${app_name}/machines/${machine_id}/metadata`, body);

export const getMachineMetadataKey = (token: string, app_name: string, machine_id: string, key: string) =>
  request(token, 'GET', `/apps/${app_name}/machines/${machine_id}/metadata/${key}`);

export const setMachineMetadataKey = (token: string, app_name: string, machine_id: string, key: string, value?: string) =>
  request(token, 'POST', `/apps/${app_name}/machines/${machine_id}/metadata/${key}`, value ? { value } : undefined);

export const deleteMachineMetadataKey = (token: string, app_name: string, machine_id: string, key: string) =>
  request(token, 'DELETE', `/apps/${app_name}/machines/${machine_id}/metadata/${key}`);

export const getMachineProcesses = (token: string, app_name: string, machine_id: string) =>
  request(token, 'GET', `/apps/${app_name}/machines/${machine_id}/ps`);

export const getMachineVersions = (token: string, app_name: string, machine_id: string) =>
  request(token, 'GET', `/apps/${app_name}/machines/${machine_id}/versions`);

export const waitForMachine = (token: string, app_name: string, machine_id: string, q?: { instance_id?: string; state?: string; timeout?: number }) =>
  request(token, 'GET', `/apps/${app_name}/machines/${machine_id}/wait`, undefined, q as Record<string, unknown>);

// ── Volumes ───────────────────────────────────────────────────────────────────

export const listVolumes = (token: string, app_name: string) =>
  request(token, 'GET', `/apps/${app_name}/volumes`);

export const createVolume = (token: string, app_name: string, body: Record<string, unknown>) =>
  request(token, 'POST', `/apps/${app_name}/volumes`, body);

export const getVolume = (token: string, app_name: string, volume_id: string) =>
  request(token, 'GET', `/apps/${app_name}/volumes/${volume_id}`);

export const updateVolume = (token: string, app_name: string, volume_id: string, body: Record<string, unknown>) =>
  request(token, 'PUT', `/apps/${app_name}/volumes/${volume_id}`, body);

export const deleteVolume = (token: string, app_name: string, volume_id: string) =>
  request(token, 'DELETE', `/apps/${app_name}/volumes/${volume_id}`);

export const extendVolume = (token: string, app_name: string, volume_id: string, size_gb: number) =>
  request(token, 'PUT', `/apps/${app_name}/volumes/${volume_id}/extend`, { size_gb });

export const listVolumeSnapshots = (token: string, app_name: string, volume_id: string) =>
  request(token, 'GET', `/apps/${app_name}/volumes/${volume_id}/snapshots`);

export const createVolumeSnapshot = (token: string, app_name: string, volume_id: string) =>
  request(token, 'POST', `/apps/${app_name}/volumes/${volume_id}/snapshots`);

// ── Secrets ───────────────────────────────────────────────────────────────────

export const listSecrets = (token: string, app_name: string) =>
  request(token, 'GET', `/apps/${app_name}/secrets`);

export const setSecrets = (token: string, app_name: string, secrets: Record<string, string>) =>
  request(token, 'POST', `/apps/${app_name}/secrets`, secrets as unknown as Record<string, unknown>);

export const getSecret = (token: string, app_name: string, secret_name: string) =>
  request(token, 'GET', `/apps/${app_name}/secrets/${secret_name}`);

export const setSecret = (token: string, app_name: string, secret_name: string, body: Record<string, unknown>) =>
  request(token, 'POST', `/apps/${app_name}/secrets/${secret_name}`, body);

export const deleteSecret = (token: string, app_name: string, secret_name: string) =>
  request(token, 'DELETE', `/apps/${app_name}/secrets/${secret_name}`);

export const listSecretKeys = (token: string, app_name: string) =>
  request(token, 'GET', `/apps/${app_name}/secretkeys`);

export const getSecretKey = (token: string, app_name: string, secret_name: string) =>
  request(token, 'GET', `/apps/${app_name}/secretkeys/${secret_name}`);

export const setSecretKey = (token: string, app_name: string, secret_name: string, body: Record<string, unknown>) =>
  request(token, 'POST', `/apps/${app_name}/secretkeys/${secret_name}`, body);

export const deleteSecretKey = (token: string, app_name: string, secret_name: string) =>
  request(token, 'DELETE', `/apps/${app_name}/secretkeys/${secret_name}`);

// ── TLS Certificates ──────────────────────────────────────────────────────────

export const listCertificates = (token: string, app_name: string) =>
  request(token, 'GET', `/apps/${app_name}/certificates`);

export const createAcmeCertificate = (token: string, app_name: string, body: Record<string, unknown>) =>
  request(token, 'POST', `/apps/${app_name}/certificates/acme`, body);

export const createCustomCertificate = (token: string, app_name: string, body: Record<string, unknown>) =>
  request(token, 'POST', `/apps/${app_name}/certificates/custom`, body);

export const getCertificate = (token: string, app_name: string, hostname: string) =>
  request(token, 'GET', `/apps/${app_name}/certificates/${hostname}`);

export const deleteCertificate = (token: string, app_name: string, hostname: string) =>
  request(token, 'DELETE', `/apps/${app_name}/certificates/${hostname}`);

export const checkCertificate = (token: string, app_name: string, hostname: string) =>
  request(token, 'POST', `/apps/${app_name}/certificates/${hostname}/check`);

// ── Organizations ─────────────────────────────────────────────────────────────

export const listOrgMachines = (token: string, org_slug: string, q?: { include_deleted?: boolean; region?: string; state?: string; updated_after?: string; cursor?: string; limit?: number }) =>
  request(token, 'GET', `/orgs/${org_slug}/machines`, undefined, q as Record<string, unknown>);

// ── Platform ──────────────────────────────────────────────────────────────────

export const getRegions = (token: string) =>
  request(token, 'GET', '/platform/regions');

export const getPlacements = (token: string, body: Record<string, unknown>) =>
  request(token, 'POST', '/platform/placements', body);

// ── Tokens ────────────────────────────────────────────────────────────────────

export const getCurrentToken = (token: string) =>
  request(token, 'GET', '/tokens/current');

export const createOidcToken = (token: string, body: Record<string, unknown>) =>
  request(token, 'POST', '/tokens/oidc', body);
