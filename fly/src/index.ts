import express, { NextFunction, Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import * as api from './api.js';

const MCP_API_KEY = process.env.MCP_API_KEY;
const PORT = parseInt(process.env.PORT || '3800');

function createMcpServer(flyToken: string): McpServer {
  const server = new McpServer({ name: 'fly-mcp', version: '1.0.0' });

  // ── Apps ──────────────────────────────────────────────────────────────────

  server.tool(
    'list_apps',
    'List all Fly.io apps for an organization. Use this to see all apps under an org slug.',
    {
      org_slug: z.string().describe('Organization slug (e.g. "personal" or your org name)'),
      app_role: z.string().optional().describe('Filter apps by role'),
    },
    async (p) => ({
      content: [{ type: 'text', text: JSON.stringify(await api.listApps(flyToken, p.org_slug, p.app_role), null, 2) }],
    }),
  );

  server.tool(
    'create_app',
    'Create a new Fly.io app under an organization.',
    {
      name: z.string().optional().describe('App name'),
      org_slug: z.string().optional().describe('Organization slug'),
      network: z.string().optional().describe('Network name'),
      enable_subdomains: z.boolean().optional().describe('Enable subdomains for the app'),
    },
    async (p) => ({
      content: [{ type: 'text', text: JSON.stringify(await api.createApp(flyToken, p), null, 2) }],
    }),
  );

  server.tool(
    'get_app',
    'Get details about a specific Fly.io app by name.',
    { app_name: z.string().describe('Fly app name') },
    async (p) => ({
      content: [{ type: 'text', text: JSON.stringify(await api.getApp(flyToken, p.app_name), null, 2) }],
    }),
  );

  server.tool(
    'destroy_app',
    'Permanently delete a Fly.io app by name. This is irreversible.',
    { app_name: z.string().describe('Fly app name to destroy') },
    async (p) => ({
      content: [{ type: 'text', text: JSON.stringify(await api.destroyApp(flyToken, p.app_name), null, 2) }],
    }),
  );

  server.tool(
    'create_deploy_token',
    'Create a deploy token for a Fly.io app.',
    {
      app_name: z.string().describe('Fly app name'),
      expiry: z.string().optional().describe('Token expiry (e.g. "720h")'),
    },
    async (p) => ({
      content: [{ type: 'text', text: JSON.stringify(await api.createDeployToken(flyToken, p.app_name, p.expiry), null, 2) }],
    }),
  );

  server.tool(
    'list_ip_assignments',
    'List all IP assignments (IPv4/IPv6) for a Fly.io app.',
    { app_name: z.string().describe('Fly app name') },
    async (p) => ({
      content: [{ type: 'text', text: JSON.stringify(await api.listIpAssignments(flyToken, p.app_name), null, 2) }],
    }),
  );

  server.tool(
    'assign_ip',
    'Assign a new IP address (IPv4 or IPv6) to a Fly.io app.',
    {
      app_name: z.string().describe('Fly app name'),
      type: z.string().optional().describe('IP type: "v4", "v6", or "private_v6"'),
      region: z.string().optional().describe('Region for the IP'),
      network: z.string().optional().describe('Network name'),
      org_slug: z.string().optional().describe('Organization slug'),
      service_name: z.string().optional().describe('Service name'),
    },
    async (p) => {
      const { app_name, ...body } = p;
      return { content: [{ type: 'text', text: JSON.stringify(await api.assignIp(flyToken, app_name, body), null, 2) }] };
    },
  );

  server.tool(
    'remove_ip',
    'Remove an IP assignment from a Fly.io app.',
    {
      app_name: z.string().describe('Fly app name'),
      ip: z.string().describe('IP address to remove'),
    },
    async (p) => ({
      content: [{ type: 'text', text: JSON.stringify(await api.removeIp(flyToken, p.app_name, p.ip), null, 2) }],
    }),
  );

  // ── Machines ──────────────────────────────────────────────────────────────

  server.tool(
    'list_machines',
    'List all Machines (VMs) for a Fly.io app. Can filter by region or include deleted machines.',
    {
      app_name: z.string().describe('Fly app name'),
      region: z.string().optional().describe('Filter by region code (e.g. "ord", "sjc")'),
      include_deleted: z.boolean().optional().describe('Include deleted machines'),
    },
    async (p) => {
      const { app_name, ...q } = p;
      return { content: [{ type: 'text', text: JSON.stringify(await api.listMachines(flyToken, app_name, q), null, 2) }] };
    },
  );

  server.tool(
    'create_machine',
    'Create a new Machine (VM) in a Fly.io app. Specify region and Docker image config.',
    {
      app_name: z.string().describe('Fly app name'),
      region: z.string().optional().describe('Region to deploy the machine (e.g. "sjc", "ord")'),
      name: z.string().optional().describe('Machine name'),
      config: z.record(z.unknown()).describe('Machine config object (image, env, services, guest, etc.)'),
      skip_launch: z.boolean().optional().describe('Create but do not start the machine'),
      lease_ttl: z.number().optional().describe('Lease TTL in seconds for the new machine'),
    },
    async (p) => {
      const { app_name, ...body } = p;
      return { content: [{ type: 'text', text: JSON.stringify(await api.createMachine(flyToken, app_name, body as Record<string, unknown>), null, 2) }] };
    },
  );

  server.tool(
    'get_machine',
    'Get details and current state of a specific Machine.',
    {
      app_name: z.string().describe('Fly app name'),
      machine_id: z.string().describe('Machine ID'),
    },
    async (p) => ({
      content: [{ type: 'text', text: JSON.stringify(await api.getMachine(flyToken, p.app_name, p.machine_id), null, 2) }],
    }),
  );

  server.tool(
    'update_machine',
    'Update the configuration of an existing Machine.',
    {
      app_name: z.string().describe('Fly app name'),
      machine_id: z.string().describe('Machine ID'),
      config: z.record(z.unknown()).describe('Updated machine configuration'),
      region: z.string().optional().describe('Region'),
      name: z.string().optional().describe('Machine name'),
    },
    async (p) => {
      const { app_name, machine_id, ...body } = p;
      return { content: [{ type: 'text', text: JSON.stringify(await api.updateMachine(flyToken, app_name, machine_id, body as Record<string, unknown>), null, 2) }] };
    },
  );

  server.tool(
    'delete_machine',
    'Destroy/delete a Machine. Set force=true to delete even if running.',
    {
      app_name: z.string().describe('Fly app name'),
      machine_id: z.string().describe('Machine ID'),
      force: z.boolean().optional().describe('Force delete even if machine is running'),
    },
    async (p) => ({
      content: [{ type: 'text', text: JSON.stringify(await api.deleteMachine(flyToken, p.app_name, p.machine_id, p.force), null, 2) }],
    }),
  );

  server.tool(
    'start_machine',
    'Start a stopped Machine.',
    {
      app_name: z.string().describe('Fly app name'),
      machine_id: z.string().describe('Machine ID'),
    },
    async (p) => ({
      content: [{ type: 'text', text: JSON.stringify(await api.startMachine(flyToken, p.app_name, p.machine_id), null, 2) }],
    }),
  );

  server.tool(
    'stop_machine',
    'Stop a running Machine. Optionally send a signal before stopping.',
    {
      app_name: z.string().describe('Fly app name'),
      machine_id: z.string().describe('Machine ID'),
      signal: z.string().optional().describe('Signal to send before stopping (e.g. "SIGTERM")'),
      timeout: z.number().optional().describe('Timeout in seconds to wait before force stopping'),
    },
    async (p) => {
      const { app_name, machine_id, ...body } = p;
      return { content: [{ type: 'text', text: JSON.stringify(await api.stopMachine(flyToken, app_name, machine_id, body), null, 2) }] };
    },
  );

  server.tool(
    'restart_machine',
    'Restart a Machine. Optionally force-stop, send a signal, or set a timeout.',
    {
      app_name: z.string().describe('Fly app name'),
      machine_id: z.string().describe('Machine ID'),
      force_stop: z.boolean().optional().describe('Force stop before restarting'),
      signal: z.string().optional().describe('Signal to send before restarting'),
      timeout: z.number().optional().describe('Timeout in seconds'),
    },
    async (p) => {
      const { app_name, machine_id, ...body } = p;
      return { content: [{ type: 'text', text: JSON.stringify(await api.restartMachine(flyToken, app_name, machine_id, body), null, 2) }] };
    },
  );

  server.tool(
    'suspend_machine',
    'Suspend a running Machine (checkpoint to disk).',
    {
      app_name: z.string().describe('Fly app name'),
      machine_id: z.string().describe('Machine ID'),
    },
    async (p) => ({
      content: [{ type: 'text', text: JSON.stringify(await api.suspendMachine(flyToken, p.app_name, p.machine_id), null, 2) }],
    }),
  );

  server.tool(
    'cordon_machine',
    'Cordon a Machine to prevent new connections from being routed to it.',
    {
      app_name: z.string().describe('Fly app name'),
      machine_id: z.string().describe('Machine ID'),
    },
    async (p) => ({
      content: [{ type: 'text', text: JSON.stringify(await api.cordonMachine(flyToken, p.app_name, p.machine_id), null, 2) }],
    }),
  );

  server.tool(
    'uncordon_machine',
    'Uncordon a Machine to allow connections to be routed to it again.',
    {
      app_name: z.string().describe('Fly app name'),
      machine_id: z.string().describe('Machine ID'),
    },
    async (p) => ({
      content: [{ type: 'text', text: JSON.stringify(await api.uncordonMachine(flyToken, p.app_name, p.machine_id), null, 2) }],
    }),
  );

  server.tool(
    'signal_machine',
    'Send a POSIX signal to a running Machine.',
    {
      app_name: z.string().describe('Fly app name'),
      machine_id: z.string().describe('Machine ID'),
      signal: z.string().describe('Signal name (e.g. "SIGTERM", "SIGHUP", "SIGKILL")'),
    },
    async (p) => ({
      content: [{ type: 'text', text: JSON.stringify(await api.signalMachine(flyToken, p.app_name, p.machine_id, p.signal), null, 2) }],
    }),
  );

  server.tool(
    'exec_machine',
    'Execute a command inside a running Machine and return output.',
    {
      app_name: z.string().describe('Fly app name'),
      machine_id: z.string().describe('Machine ID'),
      command: z.array(z.string()).describe('Command and arguments as array (e.g. ["ls", "-la"])'),
      timeout: z.number().optional().describe('Execution timeout in seconds'),
    },
    async (p) => {
      const { app_name, machine_id, command, timeout } = p;
      return { content: [{ type: 'text', text: JSON.stringify(await api.execMachine(flyToken, app_name, machine_id, { command, timeout }), null, 2) }] };
    },
  );

  server.tool(
    'get_machine_events',
    'Get recent lifecycle events for a Machine (start, stop, restart, etc.).',
    {
      app_name: z.string().describe('Fly app name'),
      machine_id: z.string().describe('Machine ID'),
    },
    async (p) => ({
      content: [{ type: 'text', text: JSON.stringify(await api.getMachineEvents(flyToken, p.app_name, p.machine_id), null, 2) }],
    }),
  );

  server.tool(
    'get_machine_lease',
    'Get the current lease info for a Machine.',
    {
      app_name: z.string().describe('Fly app name'),
      machine_id: z.string().describe('Machine ID'),
    },
    async (p) => ({
      content: [{ type: 'text', text: JSON.stringify(await api.getMachineLease(flyToken, p.app_name, p.machine_id), null, 2) }],
    }),
  );

  server.tool(
    'acquire_machine_lease',
    'Acquire an exclusive lease on a Machine to prevent concurrent updates.',
    {
      app_name: z.string().describe('Fly app name'),
      machine_id: z.string().describe('Machine ID'),
      description: z.string().optional().describe('Lease description'),
      expires_in: z.number().optional().describe('Lease TTL in seconds'),
    },
    async (p) => {
      const { app_name, machine_id, ...body } = p;
      return { content: [{ type: 'text', text: JSON.stringify(await api.acquireMachineLease(flyToken, app_name, machine_id, body), null, 2) }] };
    },
  );

  server.tool(
    'release_machine_lease',
    'Release a held lease on a Machine.',
    {
      app_name: z.string().describe('Fly app name'),
      machine_id: z.string().describe('Machine ID'),
    },
    async (p) => ({
      content: [{ type: 'text', text: JSON.stringify(await api.releaseMachineLease(flyToken, p.app_name, p.machine_id), null, 2) }],
    }),
  );

  server.tool(
    'get_machine_memory',
    'Get current memory configuration for a Machine.',
    {
      app_name: z.string().describe('Fly app name'),
      machine_id: z.string().describe('Machine ID'),
    },
    async (p) => ({
      content: [{ type: 'text', text: JSON.stringify(await api.getMachineMemory(flyToken, p.app_name, p.machine_id), null, 2) }],
    }),
  );

  server.tool(
    'update_machine_memory',
    'Update memory allocation for a running Machine.',
    {
      app_name: z.string().describe('Fly app name'),
      machine_id: z.string().describe('Machine ID'),
      memory_mb: z.number().describe('Memory in MB to allocate'),
    },
    async (p) => ({
      content: [{ type: 'text', text: JSON.stringify(await api.updateMachineMemory(flyToken, p.app_name, p.machine_id, { memory_mb: p.memory_mb }), null, 2) }],
    }),
  );

  server.tool(
    'reclaim_machine_memory',
    'Reclaim unused memory from a Machine.',
    {
      app_name: z.string().describe('Fly app name'),
      machine_id: z.string().describe('Machine ID'),
    },
    async (p) => ({
      content: [{ type: 'text', text: JSON.stringify(await api.reclaimMachineMemory(flyToken, p.app_name, p.machine_id), null, 2) }],
    }),
  );

  server.tool(
    'get_machine_metadata',
    'Get all metadata key-value pairs for a Machine.',
    {
      app_name: z.string().describe('Fly app name'),
      machine_id: z.string().describe('Machine ID'),
    },
    async (p) => ({
      content: [{ type: 'text', text: JSON.stringify(await api.getMachineMetadata(flyToken, p.app_name, p.machine_id), null, 2) }],
    }),
  );

  server.tool(
    'set_machine_metadata',
    'Set (bulk replace) all metadata on a Machine.',
    {
      app_name: z.string().describe('Fly app name'),
      machine_id: z.string().describe('Machine ID'),
      metadata: z.record(z.string()).describe('Metadata key-value pairs to set'),
    },
    async (p) => ({
      content: [{ type: 'text', text: JSON.stringify(await api.updateMachineMetadata(flyToken, p.app_name, p.machine_id, p.metadata as Record<string, unknown>), null, 2) }],
    }),
  );

  server.tool(
    'set_machine_metadata_key',
    'Set a single metadata key on a Machine.',
    {
      app_name: z.string().describe('Fly app name'),
      machine_id: z.string().describe('Machine ID'),
      key: z.string().describe('Metadata key'),
      value: z.string().optional().describe('Metadata value'),
    },
    async (p) => ({
      content: [{ type: 'text', text: JSON.stringify(await api.setMachineMetadataKey(flyToken, p.app_name, p.machine_id, p.key, p.value), null, 2) }],
    }),
  );

  server.tool(
    'delete_machine_metadata_key',
    'Delete a single metadata key from a Machine.',
    {
      app_name: z.string().describe('Fly app name'),
      machine_id: z.string().describe('Machine ID'),
      key: z.string().describe('Metadata key to delete'),
    },
    async (p) => ({
      content: [{ type: 'text', text: JSON.stringify(await api.deleteMachineMetadataKey(flyToken, p.app_name, p.machine_id, p.key), null, 2) }],
    }),
  );

  server.tool(
    'get_machine_processes',
    'Get running processes inside a Machine.',
    {
      app_name: z.string().describe('Fly app name'),
      machine_id: z.string().describe('Machine ID'),
    },
    async (p) => ({
      content: [{ type: 'text', text: JSON.stringify(await api.getMachineProcesses(flyToken, p.app_name, p.machine_id), null, 2) }],
    }),
  );

  server.tool(
    'get_machine_versions',
    'List all previous versions/configurations of a Machine.',
    {
      app_name: z.string().describe('Fly app name'),
      machine_id: z.string().describe('Machine ID'),
    },
    async (p) => ({
      content: [{ type: 'text', text: JSON.stringify(await api.getMachineVersions(flyToken, p.app_name, p.machine_id), null, 2) }],
    }),
  );

  server.tool(
    'wait_for_machine',
    'Wait until a Machine reaches a desired state (started, stopped, destroyed, etc.).',
    {
      app_name: z.string().describe('Fly app name'),
      machine_id: z.string().describe('Machine ID'),
      state: z.string().optional().describe('Desired state to wait for: "started", "stopped", "destroyed", "suspended"'),
      instance_id: z.string().optional().describe('Specific instance ID to wait for'),
      timeout: z.number().optional().describe('Timeout in seconds (max 60)'),
    },
    async (p) => {
      const { app_name, machine_id, ...q } = p;
      return { content: [{ type: 'text', text: JSON.stringify(await api.waitForMachine(flyToken, app_name, machine_id, q), null, 2) }] };
    },
  );

  // ── Volumes ───────────────────────────────────────────────────────────────

  server.tool(
    'list_volumes',
    'List all persistent volumes for a Fly.io app.',
    { app_name: z.string().describe('Fly app name') },
    async (p) => ({
      content: [{ type: 'text', text: JSON.stringify(await api.listVolumes(flyToken, p.app_name), null, 2) }],
    }),
  );

  server.tool(
    'create_volume',
    'Create a persistent volume for a Fly.io app.',
    {
      app_name: z.string().describe('Fly app name'),
      name: z.string().describe('Volume name'),
      region: z.string().describe('Region where to create the volume'),
      size_gb: z.number().describe('Volume size in GB'),
      encrypted: z.boolean().optional().describe('Encrypt the volume'),
      snapshot_id: z.string().optional().describe('Create from snapshot ID'),
      snapshot_retention: z.number().optional().describe('Snapshot retention days'),
    },
    async (p) => {
      const { app_name, ...body } = p;
      return { content: [{ type: 'text', text: JSON.stringify(await api.createVolume(flyToken, app_name, body as Record<string, unknown>), null, 2) }] };
    },
  );

  server.tool(
    'get_volume',
    'Get details about a specific volume.',
    {
      app_name: z.string().describe('Fly app name'),
      volume_id: z.string().describe('Volume ID'),
    },
    async (p) => ({
      content: [{ type: 'text', text: JSON.stringify(await api.getVolume(flyToken, p.app_name, p.volume_id), null, 2) }],
    }),
  );

  server.tool(
    'update_volume',
    'Update a volume (e.g. snapshot retention settings).',
    {
      app_name: z.string().describe('Fly app name'),
      volume_id: z.string().describe('Volume ID'),
      snapshot_retention: z.number().optional().describe('Snapshot retention in days'),
    },
    async (p) => {
      const { app_name, volume_id, ...body } = p;
      return { content: [{ type: 'text', text: JSON.stringify(await api.updateVolume(flyToken, app_name, volume_id, body as Record<string, unknown>), null, 2) }] };
    },
  );

  server.tool(
    'delete_volume',
    'Delete a persistent volume. This is irreversible.',
    {
      app_name: z.string().describe('Fly app name'),
      volume_id: z.string().describe('Volume ID to delete'),
    },
    async (p) => ({
      content: [{ type: 'text', text: JSON.stringify(await api.deleteVolume(flyToken, p.app_name, p.volume_id), null, 2) }],
    }),
  );

  server.tool(
    'extend_volume',
    'Extend (increase) the size of a volume.',
    {
      app_name: z.string().describe('Fly app name'),
      volume_id: z.string().describe('Volume ID'),
      size_gb: z.number().describe('New size in GB (must be larger than current size)'),
    },
    async (p) => ({
      content: [{ type: 'text', text: JSON.stringify(await api.extendVolume(flyToken, p.app_name, p.volume_id, p.size_gb), null, 2) }],
    }),
  );

  server.tool(
    'list_volume_snapshots',
    'List all snapshots for a volume.',
    {
      app_name: z.string().describe('Fly app name'),
      volume_id: z.string().describe('Volume ID'),
    },
    async (p) => ({
      content: [{ type: 'text', text: JSON.stringify(await api.listVolumeSnapshots(flyToken, p.app_name, p.volume_id), null, 2) }],
    }),
  );

  server.tool(
    'create_volume_snapshot',
    'Create a snapshot of a volume.',
    {
      app_name: z.string().describe('Fly app name'),
      volume_id: z.string().describe('Volume ID'),
    },
    async (p) => ({
      content: [{ type: 'text', text: JSON.stringify(await api.createVolumeSnapshot(flyToken, p.app_name, p.volume_id), null, 2) }],
    }),
  );

  // ── Secrets ───────────────────────────────────────────────────────────────

  server.tool(
    'list_secrets',
    'List all secrets (env var secrets) set on a Fly.io app. Returns names only, not values.',
    { app_name: z.string().describe('Fly app name') },
    async (p) => ({
      content: [{ type: 'text', text: JSON.stringify(await api.listSecrets(flyToken, p.app_name), null, 2) }],
    }),
  );

  server.tool(
    'set_secrets',
    'Set one or more secrets (env vars) on a Fly.io app. This will trigger a deploy.',
    {
      app_name: z.string().describe('Fly app name'),
      secrets: z.record(z.string()).describe('Key-value pairs of secret names and values'),
    },
    async (p) => ({
      content: [{ type: 'text', text: JSON.stringify(await api.setSecrets(flyToken, p.app_name, p.secrets), null, 2) }],
    }),
  );

  server.tool(
    'delete_secret',
    'Delete a secret from a Fly.io app.',
    {
      app_name: z.string().describe('Fly app name'),
      secret_name: z.string().describe('Secret name to delete'),
    },
    async (p) => ({
      content: [{ type: 'text', text: JSON.stringify(await api.deleteSecret(flyToken, p.app_name, p.secret_name), null, 2) }],
    }),
  );

  server.tool(
    'list_secret_keys',
    'List all secret keys (cryptographic key references) for a Fly.io app.',
    { app_name: z.string().describe('Fly app name') },
    async (p) => ({
      content: [{ type: 'text', text: JSON.stringify(await api.listSecretKeys(flyToken, p.app_name), null, 2) }],
    }),
  );

  // ── TLS Certificates ──────────────────────────────────────────────────────

  server.tool(
    'list_certificates',
    'List all TLS certificates for a Fly.io app.',
    { app_name: z.string().describe('Fly app name') },
    async (p) => ({
      content: [{ type: 'text', text: JSON.stringify(await api.listCertificates(flyToken, p.app_name), null, 2) }],
    }),
  );

  server.tool(
    'create_acme_certificate',
    'Create a Let\'s Encrypt (ACME) TLS certificate for a hostname on a Fly.io app.',
    {
      app_name: z.string().describe('Fly app name'),
      hostname: z.string().describe('Hostname to create certificate for'),
    },
    async (p) => {
      const { app_name, ...body } = p;
      return { content: [{ type: 'text', text: JSON.stringify(await api.createAcmeCertificate(flyToken, app_name, body as Record<string, unknown>), null, 2) }] };
    },
  );

  server.tool(
    'create_custom_certificate',
    'Create a custom TLS certificate for a hostname on a Fly.io app.',
    {
      app_name: z.string().describe('Fly app name'),
      hostname: z.string().describe('Hostname to create certificate for'),
    },
    async (p) => {
      const { app_name, ...body } = p;
      return { content: [{ type: 'text', text: JSON.stringify(await api.createCustomCertificate(flyToken, app_name, body as Record<string, unknown>), null, 2) }] };
    },
  );

  server.tool(
    'get_certificate',
    'Get TLS certificate details for a specific hostname.',
    {
      app_name: z.string().describe('Fly app name'),
      hostname: z.string().describe('Hostname'),
    },
    async (p) => ({
      content: [{ type: 'text', text: JSON.stringify(await api.getCertificate(flyToken, p.app_name, p.hostname), null, 2) }],
    }),
  );

  server.tool(
    'delete_certificate',
    'Delete a TLS certificate for a hostname.',
    {
      app_name: z.string().describe('Fly app name'),
      hostname: z.string().describe('Hostname'),
    },
    async (p) => ({
      content: [{ type: 'text', text: JSON.stringify(await api.deleteCertificate(flyToken, p.app_name, p.hostname), null, 2) }],
    }),
  );

  server.tool(
    'check_certificate',
    'Check the TLS certificate status and DNS configuration for a hostname.',
    {
      app_name: z.string().describe('Fly app name'),
      hostname: z.string().describe('Hostname to check'),
    },
    async (p) => ({
      content: [{ type: 'text', text: JSON.stringify(await api.checkCertificate(flyToken, p.app_name, p.hostname), null, 2) }],
    }),
  );

  // ── Organizations ─────────────────────────────────────────────────────────

  server.tool(
    'list_org_machines',
    'List all Machines across all apps in a Fly.io organization. Supports pagination and filtering.',
    {
      org_slug: z.string().describe('Organization slug'),
      include_deleted: z.boolean().optional().describe('Include deleted machines'),
      region: z.string().optional().describe('Filter by region'),
      state: z.string().optional().describe('Filter by state: "created", "started", "stopped", "suspended" (comma-separated)'),
      updated_after: z.string().optional().describe('Only return machines updated after this RFC3339 timestamp'),
      cursor: z.string().optional().describe('Pagination cursor from previous response'),
      limit: z.number().optional().describe('Number of machines to fetch (max 2000)'),
    },
    async (p) => {
      const { org_slug, ...q } = p;
      return { content: [{ type: 'text', text: JSON.stringify(await api.listOrgMachines(flyToken, org_slug, q), null, 2) }] };
    },
  );

  // ── Platform ──────────────────────────────────────────────────────────────

  server.tool(
    'get_regions',
    'Get all available Fly.io regions where apps and machines can be deployed.',
    {},
    async () => ({
      content: [{ type: 'text', text: JSON.stringify(await api.getRegions(flyToken), null, 2) }],
    }),
  );

  server.tool(
    'get_placements',
    'Get Machine placement recommendations for given requirements.',
    {
      app_name: z.string().optional().describe('App name for placement context'),
      region: z.string().optional().describe('Preferred region'),
    },
    async (p) => ({
      content: [{ type: 'text', text: JSON.stringify(await api.getPlacements(flyToken, p as Record<string, unknown>), null, 2) }],
    }),
  );

  // ── Tokens ────────────────────────────────────────────────────────────────

  server.tool(
    'get_current_token',
    'Get information about the currently authenticated Fly.io API token.',
    {},
    async () => ({
      content: [{ type: 'text', text: JSON.stringify(await api.getCurrentToken(flyToken), null, 2) }],
    }),
  );

  return server;
}

function authenticate(req: Request, res: Response, next: NextFunction) {
  if (!MCP_API_KEY) return next();
  const key = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : (req.headers['x-api-key'] as string | undefined);
  if (!key) { res.status(401).json({ error: 'Missing API key' }); return; }
  if (key !== MCP_API_KEY) { res.status(403).json({ error: 'Invalid API key' }); return; }
  next();
}

function resolveFlyToken(req: Request): string | null {
  return (req.headers['x-fly-token'] as string | undefined) ?? process.env.FLY_API_TOKEN ?? null;
}

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok', server: 'fly-mcp', version: '1.0.0' }));

app.post('/mcp', authenticate, async (req: Request, res: Response) => {
  const flyToken = resolveFlyToken(req);
  if (!flyToken) {
    res.status(400).json({ error: 'No Fly.io token provided. Pass X-Fly-Token header or set FLY_API_TOKEN env var.' });
    return;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on('close', () => transport.close());
  const server = createMcpServer(flyToken);
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get('/mcp', authenticate, (_req, res) => res.status(405).json({ error: 'Use POST /mcp' }));
app.delete('/mcp', authenticate, (_req, res) => res.status(405).json({ error: 'Stateless mode' }));

app.listen(PORT, () => console.log(`fly-mcp running on http://0.0.0.0:${PORT}`));
