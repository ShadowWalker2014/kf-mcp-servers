import express, { NextFunction, Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import {
  getMe, listProjects, getProject, createProject, updateProject, deleteProject,
  listProjectMembers, inviteProjectUser, removeProjectMember, updateProjectMember,
  createProjectToken, deleteProjectToken, createProjectInvitation, deleteProjectInvitation,
  transferProjectToTeam, leaveProject,
  listServices, getService, createService, updateService, deleteService,
  connectService, disconnectService, duplicateService, removeServiceUpstreamUrl,
  getServiceInstance, updateServiceInstance, deployService,
  getServiceInstanceLimits, updateServiceInstanceLimits,
  listEnvironments, getEnvironment, createEnvironment, deleteEnvironment, renameEnvironment, triggerEnvironmentDeploys,
  overrideBaseEnvironment,
  listDeployments, getDeployment, getDeploymentLogs, getBuildLogs, getEnvironmentLogs, getHttpLogs,
  getDeploymentSnapshot,
  redeployService, restartDeployment, cancelDeployment, stopDeployment,
  rollbackDeployment, removeDeployment, approveDeployment,
  listDeploymentTriggers, createDeploymentTrigger, deleteDeploymentTrigger, updateDeploymentTrigger,
  getVariables, upsertVariable, bulkUpsertVariables, deleteVariable,
  getVariablesForDeployment, configureSharedVariable,
  listDomains, checkCustomDomainAvailable, getDomainStatus, generateDomain, deleteServiceDomain,
  createCustomDomain, deleteCustomDomain, updateCustomDomain,
  listTcpProxies, createTcpProxy, deleteTcpProxy,
  createVolume, deleteVolume, updateVolume, updateVolumeMount,
  listVolumeBackups, createVolumeBackup, deleteVolumeBackup, lockVolumeBackup, restoreVolumeBackup,
  listVolumeBackupSchedules, updateVolumeBackupSchedule,
  createPlugin, deletePlugin, restartPlugin, getPlugin, getPluginLogs,
  listGithubRepos, listGithubBranches, checkGithubRepoAccess,
  listRegions,
  getMetrics, getUsage, getEstimatedUsage,
  listWebhooks, createWebhook, deleteWebhook, updateWebhook,
  listPrivateNetworks, createPrivateNetwork, createPrivateNetworkEndpoint, deletePrivateNetworkEndpoint,
  renamePrivateNetworkEndpoint, deleteAllPrivateNetworks,
  listIntegrations, createIntegration, deleteIntegration, updateIntegration,
  listEgressGateways, createEgressGateway, clearEgressGateways,
  deployTemplate, importDockerCompose,
  setUsageLimit, removeUsageLimit,
  createApiToken, deleteApiToken,
  getWorkflowStatus,
  startPlugin, updatePlugin, resetPlugin, resetPluginCredentials,
  updateGithubRepo,
  updateWorkspace, deleteWorkspace, leaveWorkspace,
  scheduleProjectDelete, cancelScheduledProjectDelete,
  resendProjectInvitation,
} from './api.js';

const MCP_API_KEY = process.env.MCP_API_KEY;
const PORT = parseInt(process.env.PORT || '3400');
if (isNaN(PORT)) throw new Error(`Invalid PORT env var: "${process.env.PORT}"`);

// ─── MCP server factory ────────────────────────────────────────────────────────

function createMcpServer(railwayToken: string): McpServer {
  const server = new McpServer({ name: 'railway-mcp', version: '2.0.0' });

  // ═══════════════════════════════════════════════════════════════════
  // ACCOUNT / WORKSPACE
  // ═══════════════════════════════════════════════════════════════════

  server.tool('list_workspaces',
    'Get your Railway account info (name, email) and list of workspace/team IDs. Use this when you need a specific workspace ID. For most tasks you can skip this and call list_projects directly (workspace_id is optional there).',
    {},
    async () => {
      const me = await getMe(railwayToken);
      return { content: [{ type: 'text', text: JSON.stringify(me, null, 2) }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // PROJECTS
  // ═══════════════════════════════════════════════════════════════════

  server.tool('list_projects', 'List Railway projects. workspace_id is OPTIONAL — omit it to list all your personal projects without needing to call list_workspaces first. Provide workspace_id only if you specifically need to filter to one workspace.',
    { workspace_id: z.string().optional().describe('Railway workspace/team ID (optional — omit to list all accessible projects)') },
    async ({ workspace_id }) => {
      const projects = await listProjects(railwayToken, workspace_id);
      return { content: [{ type: 'text', text: JSON.stringify(projects, null, 2) }] };
    }
  );

  server.tool('get_project', 'Get details of a single Railway project by ID.',
    { project_id: z.string().describe('Railway project ID') },
    async ({ project_id }) => {
      const project = await getProject(railwayToken, project_id);
      return { content: [{ type: 'text', text: JSON.stringify(project, null, 2) }] };
    }
  );

  server.tool('create_project', 'Create a new Railway project. team_id is OPTIONAL — omit it to create in your personal account. Only provide team_id if you specifically need the project in a team workspace.',
    {
      name: z.string().describe('Project name'),
      description: z.string().optional().describe('Project description'),
      team_id: z.string().optional().describe('Team/workspace ID (optional — omit for personal account)'),
    },
    async ({ name, description, team_id }) => {
      const project = await createProject(railwayToken, name, description, team_id);
      return { content: [{ type: 'text', text: JSON.stringify(project, null, 2) }] };
    }
  );

  server.tool('update_project', 'Update a Railway project name or description.',
    {
      project_id: z.string().describe('Railway project ID'),
      name: z.string().optional().describe('New project name'),
      description: z.string().optional().describe('New project description'),
    },
    async ({ project_id, name, description }) => {
      const project = await updateProject(railwayToken, project_id, { name, description });
      return { content: [{ type: 'text', text: JSON.stringify(project, null, 2) }] };
    }
  );

  server.tool('delete_project', 'Permanently delete a Railway project and all its resources. Irreversible.',
    { project_id: z.string().describe('Railway project ID to delete') },
    async ({ project_id }) => {
      await deleteProject(railwayToken, project_id);
      return { content: [{ type: 'text', text: `Project ${project_id} deleted.` }] };
    }
  );

  // ─── Project Members ─────────────────────────────────────────────

  server.tool('list_project_members', 'List all members of a Railway project.',
    { project_id: z.string().describe('Railway project ID') },
    async ({ project_id }) => {
      const members = await listProjectMembers(railwayToken, project_id);
      return { content: [{ type: 'text', text: JSON.stringify(members, null, 2) }] };
    }
  );

  server.tool('invite_project_member', 'Invite a user to a Railway project by email.',
    {
      project_id: z.string().describe('Railway project ID'),
      email: z.string().describe('Email address of the user to invite'),
      role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']).describe('Role to assign: ADMIN, MEMBER, or VIEWER'),
    },
    async ({ project_id, email, role }) => {
      await inviteProjectUser(railwayToken, project_id, email, role);
      return { content: [{ type: 'text', text: `Invited ${email} as ${role} to project ${project_id}` }] };
    }
  );

  server.tool('remove_project_member', 'Remove a member from a Railway project.',
    {
      project_id: z.string().describe('Railway project ID'),
      user_id: z.string().describe('User ID to remove'),
    },
    async ({ project_id, user_id }) => {
      const result = await removeProjectMember(railwayToken, project_id, user_id);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool('update_project_member_role', 'Update a project member\'s role.',
    {
      project_id: z.string().describe('Railway project ID'),
      user_id: z.string().describe('User ID to update'),
      role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']).describe('New role: ADMIN, MEMBER, or VIEWER'),
    },
    async ({ project_id, user_id, role }) => {
      const result = await updateProjectMember(railwayToken, project_id, user_id, role);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool('create_project_token', 'Create a project-scoped API token.',
    {
      project_id: z.string().describe('Railway project ID'),
      environment_id: z.string().describe('Environment ID this token is scoped to'),
      name: z.string().describe('Token name/label'),
    },
    async ({ project_id, environment_id, name }) => {
      const token = await createProjectToken(railwayToken, project_id, environment_id, name);
      return { content: [{ type: 'text', text: `Token created: ${token}` }] };
    }
  );

  server.tool('delete_project_token', 'Delete a project API token.',
    { token_id: z.string().describe('Project token ID to delete') },
    async ({ token_id }) => {
      await deleteProjectToken(railwayToken, token_id);
      return { content: [{ type: 'text', text: `Token ${token_id} deleted.` }] };
    }
  );

  server.tool('create_project_invitation', 'Create an invitation link to join a project.',
    {
      project_id: z.string().describe('Railway project ID'),
      email: z.string().describe('Email to send invitation to'),
      role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']).describe('Role for the invitee'),
    },
    async ({ project_id, email, role }) => {
      const inv = await createProjectInvitation(railwayToken, project_id, email, role);
      return { content: [{ type: 'text', text: JSON.stringify(inv, null, 2) }] };
    }
  );

  server.tool('delete_project_invitation', 'Delete a pending project invitation.',
    { invitation_id: z.string().describe('Invitation ID to delete') },
    async ({ invitation_id }) => {
      await deleteProjectInvitation(railwayToken, invitation_id);
      return { content: [{ type: 'text', text: `Invitation ${invitation_id} deleted.` }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // SERVICES
  // ═══════════════════════════════════════════════════════════════════

  server.tool('list_services', 'List all services in a Railway project.',
    { project_id: z.string().describe('Railway project ID') },
    async ({ project_id }) => {
      const services = await listServices(railwayToken, project_id);
      return { content: [{ type: 'text', text: JSON.stringify(services, null, 2) }] };
    }
  );

  server.tool('get_service', 'Get details of a single service by ID.',
    { service_id: z.string().describe('Railway service ID') },
    async ({ service_id }) => {
      const service = await getService(railwayToken, service_id);
      return { content: [{ type: 'text', text: JSON.stringify(service, null, 2) }] };
    }
  );

  server.tool('create_service', 'Create a new service in a Railway project. Can be empty, from a GitHub repo, or from a Docker image.',
    {
      project_id: z.string().describe('Railway project ID'),
      name: z.string().optional().describe('Service name'),
      source_type: z.enum(['empty', 'github', 'image']).optional().describe('Source type: empty, github, or image'),
      github_repo: z.string().optional().describe('GitHub repo full name (e.g. "owner/repo") — required if source_type=github'),
      github_branch: z.string().optional().describe('Branch to deploy — for source_type=github'),
      root_directory: z.string().optional().describe('Root directory within the repo — for source_type=github'),
      docker_image: z.string().optional().describe('Docker image (e.g. "nginx:latest") — required if source_type=image'),
    },
    async ({ project_id, name, source_type, github_repo, github_branch, root_directory, docker_image }) => {
      type SourceInput =
        | { type: 'GITHUB'; repo: string; branch?: string; rootDirectory?: string }
        | { type: 'IMAGE'; image: string }
        | undefined;

      let source: SourceInput;
      if (source_type === 'github' && github_repo) {
        source = { type: 'GITHUB', repo: github_repo, branch: github_branch, rootDirectory: root_directory };
      } else if (source_type === 'image' && docker_image) {
        source = { type: 'IMAGE', image: docker_image };
      }
      const service = await createService(railwayToken, project_id, name, source);
      return { content: [{ type: 'text', text: JSON.stringify(service, null, 2) }] };
    }
  );

  server.tool('update_service', 'Update a service name or icon.',
    {
      service_id: z.string().describe('Railway service ID'),
      name: z.string().optional().describe('New service name'),
      icon: z.string().optional().describe('New icon (emoji or URL)'),
    },
    async ({ service_id, name, icon }) => {
      const service = await updateService(railwayToken, service_id, { name, icon });
      return { content: [{ type: 'text', text: JSON.stringify(service, null, 2) }] };
    }
  );

  server.tool('delete_service', 'Delete a service permanently.',
    {
      service_id: z.string().describe('Railway service ID to delete'),
      environment_id: z.string().optional().describe('If provided, only delete service instance in this environment'),
    },
    async ({ service_id, environment_id }) => {
      await deleteService(railwayToken, service_id, environment_id);
      return { content: [{ type: 'text', text: `Service ${service_id} deleted.` }] };
    }
  );

  server.tool('connect_service', 'Connect an existing service to a GitHub repository.',
    {
      service_id: z.string().describe('Railway service ID'),
      repo: z.string().describe('GitHub repo full name (e.g. "owner/repo")'),
      branch: z.string().optional().describe('Branch to deploy'),
      root_directory: z.string().optional().describe('Root directory within the repo'),
    },
    async ({ service_id, repo, branch, root_directory }) => {
      const service = await connectService(railwayToken, service_id, { repo, branch, rootDirectory: root_directory });
      return { content: [{ type: 'text', text: JSON.stringify(service, null, 2) }] };
    }
  );

  server.tool('disconnect_service', 'Disconnect a service from its GitHub repository.',
    { service_id: z.string().describe('Railway service ID') },
    async ({ service_id }) => {
      const service = await disconnectService(railwayToken, service_id);
      return { content: [{ type: 'text', text: JSON.stringify(service, null, 2) }] };
    }
  );

  server.tool('duplicate_service', 'Duplicate a service within an environment.',
    {
      service_id: z.string().describe('Railway service ID to duplicate'),
      environment_id: z.string().describe('Railway environment ID'),
    },
    async ({ service_id, environment_id }) => {
      const service = await duplicateService(railwayToken, service_id, environment_id);
      return { content: [{ type: 'text', text: JSON.stringify(service, null, 2) }] };
    }
  );

  server.tool('get_service_instance', 'Get service instance configuration for a specific environment (build command, start command, region, etc).',
    {
      service_id: z.string().describe('Railway service ID'),
      environment_id: z.string().describe('Railway environment ID'),
    },
    async ({ service_id, environment_id }) => {
      const instance = await getServiceInstance(railwayToken, service_id, environment_id);
      return { content: [{ type: 'text', text: JSON.stringify(instance, null, 2) }] };
    }
  );

  server.tool('update_service_instance', 'Update service build/deploy settings for a specific environment (build command, start command, root directory, region, replicas, health check, cron, etc).',
    {
      service_id: z.string().describe('Railway service ID'),
      environment_id: z.string().describe('Railway environment ID'),
      build_command: z.string().nullable().optional().describe('Build command (null to clear)'),
      start_command: z.string().nullable().optional().describe('Start command (null to clear)'),
      root_directory: z.string().nullable().optional().describe('Root directory (null to clear)'),
      healthcheck_path: z.string().nullable().optional().describe('Healthcheck HTTP path (null to disable)'),
      healthcheck_timeout: z.number().nullable().optional().describe('Healthcheck timeout in seconds'),
      region: z.string().optional().describe('Deployment region (e.g. "us-west2")'),
      num_replicas: z.number().optional().describe('Number of replicas'),
      cron_schedule: z.string().nullable().optional().describe('Cron schedule expression (null to disable)'),
      restart_policy_type: z.enum(['NEVER', 'ON_FAILURE', 'ALWAYS']).optional().describe('Restart policy'),
      restart_policy_max_retries: z.number().optional().describe('Max restart retries'),
      sleep_application: z.boolean().optional().describe('Enable sleep mode for inactive services'),
      railway_config_file: z.string().nullable().optional().describe('Path to railway.json/toml config file'),
      watch_patterns: z.array(z.string()).optional().describe('File patterns to watch for redeploy'),
    },
    async ({ service_id, environment_id, build_command, start_command, root_directory,
      healthcheck_path, healthcheck_timeout, region, num_replicas, cron_schedule,
      restart_policy_type, restart_policy_max_retries, sleep_application, railway_config_file, watch_patterns }) => {
      const input: Record<string, unknown> = {};
      if (build_command !== undefined) input.buildCommand = build_command;
      if (start_command !== undefined) input.startCommand = start_command;
      if (root_directory !== undefined) input.rootDirectory = root_directory;
      if (healthcheck_path !== undefined) input.healthcheckPath = healthcheck_path;
      if (healthcheck_timeout !== undefined) input.healthcheckTimeout = healthcheck_timeout;
      if (region !== undefined) input.region = region;
      if (num_replicas !== undefined) input.numReplicas = num_replicas;
      if (cron_schedule !== undefined) input.cronSchedule = cron_schedule;
      if (restart_policy_type !== undefined) input.restartPolicyType = restart_policy_type;
      if (restart_policy_max_retries !== undefined) input.restartPolicyMaxRetries = restart_policy_max_retries;
      if (sleep_application !== undefined) input.sleepApplication = sleep_application;
      if (railway_config_file !== undefined) input.railwayConfigFile = railway_config_file;
      if (watch_patterns !== undefined) input.watchPatterns = watch_patterns;
      await updateServiceInstance(railwayToken, service_id, environment_id, input);
      return { content: [{ type: 'text', text: `Service instance ${service_id} updated.` }] };
    }
  );

  server.tool('deploy_service', 'Trigger a new deployment for a service.',
    {
      service_id: z.string().describe('Railway service ID'),
      environment_id: z.string().describe('Railway environment ID'),
      commit_sha: z.string().optional().describe('Specific git commit SHA to deploy'),
      latest_commit: z.boolean().optional().describe('Deploy the latest commit (default: true)'),
    },
    async ({ service_id, environment_id, commit_sha, latest_commit }) => {
      const deploymentId = await deployService(railwayToken, service_id, environment_id, { commitSha: commit_sha, latestCommit: latest_commit });
      return { content: [{ type: 'text', text: `Deployment triggered. ID: ${deploymentId}` }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // ENVIRONMENTS
  // ═══════════════════════════════════════════════════════════════════

  server.tool('list_environments', 'List all environments in a Railway project.',
    { project_id: z.string().describe('Railway project ID') },
    async ({ project_id }) => {
      const envs = await listEnvironments(railwayToken, project_id);
      return { content: [{ type: 'text', text: JSON.stringify(envs, null, 2) }] };
    }
  );

  server.tool('create_environment', 'Create a new environment in a Railway project.',
    {
      project_id: z.string().describe('Railway project ID'),
      name: z.string().describe('Name for the new environment'),
    },
    async ({ project_id, name }) => {
      const env = await createEnvironment(railwayToken, project_id, name);
      return { content: [{ type: 'text', text: JSON.stringify(env, null, 2) }] };
    }
  );

  server.tool('delete_environment', 'Delete an environment from a Railway project. Irreversible.',
    { environment_id: z.string().describe('Railway environment ID to delete') },
    async ({ environment_id }) => {
      await deleteEnvironment(railwayToken, environment_id);
      return { content: [{ type: 'text', text: `Environment ${environment_id} deleted.` }] };
    }
  );

  server.tool('rename_environment', 'Rename an environment.',
    {
      environment_id: z.string().describe('Railway environment ID'),
      name: z.string().describe('New name for the environment'),
    },
    async ({ environment_id, name }) => {
      const env = await renameEnvironment(railwayToken, environment_id, name);
      return { content: [{ type: 'text', text: JSON.stringify(env, null, 2) }] };
    }
  );

  server.tool('trigger_environment_deploys', 'Trigger deployments for all (or specific) services in an environment.',
    {
      environment_id: z.string().describe('Railway environment ID'),
      service_ids: z.array(z.string()).optional().describe('Specific service IDs to deploy (omit for all services)'),
    },
    async ({ environment_id, service_ids }) => {
      await triggerEnvironmentDeploys(railwayToken, environment_id, service_ids);
      return { content: [{ type: 'text', text: `Deployments triggered for environment ${environment_id}` }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // DEPLOYMENTS
  // ═══════════════════════════════════════════════════════════════════

  server.tool('list_deployments', 'List recent deployments for a service.',
    {
      project_id: z.string().describe('Railway project ID'),
      environment_id: z.string().describe('Railway environment ID'),
      service_id: z.string().describe('Railway service ID'),
      limit: z.number().optional().describe('Max deployments to return (default 10)'),
    },
    async ({ project_id, environment_id, service_id, limit }) => {
      const deployments = await listDeployments(railwayToken, project_id, environment_id, service_id, limit);
      return { content: [{ type: 'text', text: JSON.stringify(deployments, null, 2) }] };
    }
  );

  server.tool('get_deployment', 'Get details of a single deployment by ID.',
    { deployment_id: z.string().describe('Railway deployment ID') },
    async ({ deployment_id }) => {
      const deployment = await getDeployment(railwayToken, deployment_id);
      return { content: [{ type: 'text', text: JSON.stringify(deployment, null, 2) }] };
    }
  );

  server.tool('get_logs', 'Get build or deploy logs for a deployment.',
    {
      deployment_id: z.string().describe('Railway deployment ID'),
      log_type: z.enum(['build', 'deploy']).describe('Type of logs: build or deploy'),
      limit: z.number().optional().describe('Max log lines to return'),
      filter: z.string().optional().describe('Text filter for log messages'),
    },
    async ({ deployment_id, log_type, limit, filter }) => {
      const logs = log_type === 'build'
        ? await getBuildLogs(railwayToken, deployment_id, limit, filter)
        : await getDeploymentLogs(railwayToken, deployment_id, limit, filter);
      const text = logs.map((l) => `[${l.timestamp}] ${l.severity}: ${l.message}`).join('\n');
      return { content: [{ type: 'text', text: text || 'No logs found.' }] };
    }
  );

  server.tool('get_environment_logs', 'Get all runtime logs for an entire environment (across all services).',
    {
      environment_id: z.string().describe('Railway environment ID'),
      filter: z.string().optional().describe('Text filter for log messages'),
      limit: z.number().optional().describe('Max log lines to return'),
    },
    async ({ environment_id, filter, limit }) => {
      const logs = await getEnvironmentLogs(railwayToken, environment_id, filter, limit);
      const text = logs.map((l) => `[${l.timestamp}] ${l.severity}: ${l.message}`).join('\n');
      return { content: [{ type: 'text', text: text || 'No logs found.' }] };
    }
  );

  server.tool('get_http_logs', 'Get HTTP access logs for a deployment (requests, status codes, latency).',
    {
      deployment_id: z.string().describe('Railway deployment ID'),
      filter: z.string().optional().describe('Text filter'),
      limit: z.number().optional().describe('Max entries to return'),
    },
    async ({ deployment_id, filter, limit }) => {
      const logs = await getHttpLogs(railwayToken, deployment_id, filter, limit);
      return { content: [{ type: 'text', text: JSON.stringify(logs, null, 2) }] };
    }
  );

  server.tool('redeploy', 'Redeploy the latest deployment of a service.',
    {
      environment_id: z.string().describe('Railway environment ID'),
      service_id: z.string().describe('Railway service ID'),
    },
    async ({ environment_id, service_id }) => {
      await redeployService(railwayToken, environment_id, service_id);
      return { content: [{ type: 'text', text: `Redeploy triggered for service ${service_id}` }] };
    }
  );

  server.tool('restart_deployment', 'Restart a specific deployment by ID (without rebuilding).',
    { deployment_id: z.string().describe('Railway deployment ID') },
    async ({ deployment_id }) => {
      await restartDeployment(railwayToken, deployment_id);
      return { content: [{ type: 'text', text: `Restarted deployment ${deployment_id}` }] };
    }
  );

  server.tool('cancel_deployment', 'Cancel a deployment that is currently building or queued.',
    { deployment_id: z.string().describe('Railway deployment ID') },
    async ({ deployment_id }) => {
      await cancelDeployment(railwayToken, deployment_id);
      return { content: [{ type: 'text', text: `Deployment ${deployment_id} cancelled.` }] };
    }
  );

  server.tool('stop_deployment', 'Stop a running deployment.',
    { deployment_id: z.string().describe('Railway deployment ID') },
    async ({ deployment_id }) => {
      await stopDeployment(railwayToken, deployment_id);
      return { content: [{ type: 'text', text: `Deployment ${deployment_id} stopped.` }] };
    }
  );

  server.tool('rollback_deployment', 'Rollback to a previous deployment. The target deployment must have canRollback=true.',
    {
      deployment_id: z.string().describe('Current deployment ID (the one to rollback from)'),
      target_deployment_id: z.string().describe('Target deployment ID to rollback to'),
    },
    async ({ deployment_id, target_deployment_id }) => {
      await rollbackDeployment(railwayToken, deployment_id, target_deployment_id);
      return { content: [{ type: 'text', text: `Rolled back to deployment ${target_deployment_id}` }] };
    }
  );

  server.tool('remove_deployment', 'Remove a deployment from the history.',
    { deployment_id: z.string().describe('Railway deployment ID') },
    async ({ deployment_id }) => {
      await removeDeployment(railwayToken, deployment_id);
      return { content: [{ type: 'text', text: `Deployment ${deployment_id} removed.` }] };
    }
  );

  server.tool('approve_deployment', 'Approve a deployment that is waiting for approval.',
    { deployment_id: z.string().describe('Railway deployment ID') },
    async ({ deployment_id }) => {
      await approveDeployment(railwayToken, deployment_id);
      return { content: [{ type: 'text', text: `Deployment ${deployment_id} approved.` }] };
    }
  );

  // ─── Deployment Triggers ─────────────────────────────────────────

  server.tool('list_deployment_triggers', 'List all deployment triggers (auto-deploy rules) for a service.',
    {
      project_id: z.string().describe('Railway project ID'),
      environment_id: z.string().describe('Railway environment ID'),
      service_id: z.string().describe('Railway service ID'),
    },
    async ({ project_id, environment_id, service_id }) => {
      const triggers = await listDeploymentTriggers(railwayToken, project_id, environment_id, service_id);
      return { content: [{ type: 'text', text: JSON.stringify(triggers, null, 2) }] };
    }
  );

  server.tool('create_deployment_trigger', 'Create a deployment trigger to auto-deploy on git push.',
    {
      project_id: z.string().describe('Railway project ID'),
      environment_id: z.string().describe('Railway environment ID'),
      service_id: z.string().describe('Railway service ID'),
      provider: z.string().describe('Provider (e.g. "GITHUB")'),
      repository: z.string().describe('Repository full name (e.g. "owner/repo")'),
      branch: z.string().describe('Branch to watch for pushes'),
      check_suites: z.boolean().optional().describe('Wait for CI checks before deploying'),
    },
    async ({ project_id, environment_id, service_id, provider, repository, branch, check_suites }) => {
      const trigger = await createDeploymentTrigger(railwayToken, {
        projectId: project_id, environmentId: environment_id, serviceId: service_id,
        provider, repository, branch, checkSuites: check_suites,
      });
      return { content: [{ type: 'text', text: JSON.stringify(trigger, null, 2) }] };
    }
  );

  server.tool('delete_deployment_trigger', 'Delete a deployment trigger.',
    { trigger_id: z.string().describe('Deployment trigger ID') },
    async ({ trigger_id }) => {
      await deleteDeploymentTrigger(railwayToken, trigger_id);
      return { content: [{ type: 'text', text: `Trigger ${trigger_id} deleted.` }] };
    }
  );

  server.tool('update_deployment_trigger', 'Update a deployment trigger (branch or check suites).',
    {
      trigger_id: z.string().describe('Deployment trigger ID'),
      branch: z.string().optional().describe('New branch to watch'),
      check_suites: z.boolean().optional().describe('Wait for CI checks before deploying'),
    },
    async ({ trigger_id, branch, check_suites }) => {
      const trigger = await updateDeploymentTrigger(railwayToken, trigger_id, { branch, checkSuites: check_suites });
      return { content: [{ type: 'text', text: JSON.stringify(trigger, null, 2) }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // VARIABLES
  // ═══════════════════════════════════════════════════════════════════

  server.tool('list_variables', 'List environment variables for a service.',
    {
      project_id: z.string().describe('Railway project ID'),
      environment_id: z.string().describe('Railway environment ID'),
      service_id: z.string().optional().describe('Service ID (omit for shared env variables)'),
    },
    async ({ project_id, environment_id, service_id }) => {
      const vars = await getVariables(railwayToken, project_id, environment_id, service_id);
      return { content: [{ type: 'text', text: JSON.stringify(vars, null, 2) }] };
    }
  );

  server.tool('set_variable', 'Set (upsert) an environment variable for a service.',
    {
      project_id: z.string().describe('Railway project ID'),
      environment_id: z.string().describe('Railway environment ID'),
      service_id: z.string().describe('Railway service ID'),
      name: z.string().describe('Variable name'),
      value: z.string().describe('Variable value'),
    },
    async ({ project_id, environment_id, service_id, name, value }) => {
      await upsertVariable(railwayToken, project_id, environment_id, service_id, name, value);
      return { content: [{ type: 'text', text: `Set ${name} on service ${service_id}` }] };
    }
  );

  server.tool('set_variables_bulk', 'Set multiple environment variables at once for a service.',
    {
      project_id: z.string().describe('Railway project ID'),
      environment_id: z.string().describe('Railway environment ID'),
      service_id: z.string().describe('Railway service ID'),
      variables: z.record(z.string()).describe('Object of variable name -> value pairs'),
    },
    async ({ project_id, environment_id, service_id, variables }) => {
      await bulkUpsertVariables(railwayToken, project_id, environment_id, service_id, variables);
      return { content: [{ type: 'text', text: `Set ${Object.keys(variables).length} variables on service ${service_id}` }] };
    }
  );

  server.tool('delete_variable', 'Delete an environment variable from a service.',
    {
      project_id: z.string().describe('Railway project ID'),
      environment_id: z.string().describe('Railway environment ID'),
      service_id: z.string().describe('Railway service ID'),
      name: z.string().describe('Variable name to delete'),
    },
    async ({ project_id, environment_id, service_id, name }) => {
      await deleteVariable(railwayToken, project_id, environment_id, service_id, name);
      return { content: [{ type: 'text', text: `Deleted variable ${name} from service ${service_id}` }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // DOMAINS
  // ═══════════════════════════════════════════════════════════════════

  server.tool('list_domains', 'List all domains (Railway-provided and custom) for a service.',
    {
      project_id: z.string().describe('Railway project ID'),
      environment_id: z.string().describe('Railway environment ID'),
      service_id: z.string().describe('Railway service ID'),
    },
    async ({ project_id, environment_id, service_id }) => {
      const domains = await listDomains(railwayToken, project_id, environment_id, service_id);
      return { content: [{ type: 'text', text: JSON.stringify(domains, null, 2) }] };
    }
  );

  server.tool('generate_domain', 'Generate a Railway-provided domain (*.railway.app) for a service.',
    {
      environment_id: z.string().describe('Railway environment ID'),
      service_id: z.string().describe('Railway service ID'),
    },
    async ({ environment_id, service_id }) => {
      const result = await generateDomain(railwayToken, environment_id, service_id);
      return { content: [{ type: 'text', text: `Domain generated: ${result.domain} (id: ${result.id})` }] };
    }
  );

  server.tool('delete_service_domain', 'Delete a Railway-provided domain from a service.',
    { domain_id: z.string().describe('Service domain ID to delete') },
    async ({ domain_id }) => {
      await deleteServiceDomain(railwayToken, domain_id);
      return { content: [{ type: 'text', text: `Service domain ${domain_id} deleted.` }] };
    }
  );

  server.tool('add_custom_domain', 'Add a custom domain to a service. After adding, configure DNS per the domain status.',
    {
      project_id: z.string().describe('Railway project ID'),
      environment_id: z.string().describe('Railway environment ID'),
      service_id: z.string().describe('Railway service ID'),
      domain: z.string().describe('Custom domain to add (e.g. "api.example.com")'),
      target_port: z.number().optional().describe('Target port to route traffic to'),
    },
    async ({ project_id, environment_id, service_id, domain, target_port }) => {
      const result = await createCustomDomain(railwayToken, project_id, environment_id, service_id, domain, target_port);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool('delete_custom_domain', 'Delete a custom domain from a service.',
    { domain_id: z.string().describe('Custom domain ID to delete') },
    async ({ domain_id }) => {
      await deleteCustomDomain(railwayToken, domain_id);
      return { content: [{ type: 'text', text: `Custom domain ${domain_id} deleted.` }] };
    }
  );

  server.tool('update_custom_domain', 'Update a custom domain\'s target port.',
    {
      domain_id: z.string().describe('Custom domain ID'),
      environment_id: z.string().describe('Railway environment ID'),
      target_port: z.number().optional().describe('New target port'),
    },
    async ({ domain_id, environment_id, target_port }) => {
      await updateCustomDomain(railwayToken, domain_id, environment_id, target_port);
      return { content: [{ type: 'text', text: `Custom domain ${domain_id} updated.` }] };
    }
  );

  server.tool('check_domain_available', 'Check if a custom domain is available to add to Railway.',
    { domain: z.string().describe('Domain name to check (e.g. "api.example.com")') },
    async ({ domain }) => {
      const result = await checkCustomDomainAvailable(railwayToken, domain);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool('get_domain_status', 'Get DNS and certificate status for a custom domain.',
    {
      domain_id: z.string().describe('Custom domain ID'),
      project_id: z.string().describe('Railway project ID'),
    },
    async ({ domain_id, project_id }) => {
      const status = await getDomainStatus(railwayToken, domain_id, project_id);
      return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // TCP PROXIES
  // ═══════════════════════════════════════════════════════════════════

  server.tool('list_tcp_proxies', 'List all TCP proxies for a service (used for non-HTTP services like databases, game servers).',
    {
      environment_id: z.string().describe('Railway environment ID'),
      service_id: z.string().describe('Railway service ID'),
    },
    async ({ environment_id, service_id }) => {
      const proxies = await listTcpProxies(railwayToken, environment_id, service_id);
      return { content: [{ type: 'text', text: JSON.stringify(proxies, null, 2) }] };
    }
  );

  server.tool('create_tcp_proxy', 'Create a TCP proxy to expose a non-HTTP port publicly (e.g. for databases, game servers).',
    {
      environment_id: z.string().describe('Railway environment ID'),
      service_id: z.string().describe('Railway service ID'),
      application_port: z.number().describe('The port your application listens on internally'),
    },
    async ({ environment_id, service_id, application_port }) => {
      const proxy = await createTcpProxy(railwayToken, environment_id, service_id, application_port);
      return { content: [{ type: 'text', text: JSON.stringify(proxy, null, 2) }] };
    }
  );

  server.tool('delete_tcp_proxy', 'Delete a TCP proxy.',
    { proxy_id: z.string().describe('TCP proxy ID to delete') },
    async ({ proxy_id }) => {
      await deleteTcpProxy(railwayToken, proxy_id);
      return { content: [{ type: 'text', text: `TCP proxy ${proxy_id} deleted.` }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // VOLUMES
  // ═══════════════════════════════════════════════════════════════════

  server.tool('create_volume', 'Create a persistent volume attached to a service.',
    {
      project_id: z.string().describe('Railway project ID'),
      service_id: z.string().describe('Railway service ID to attach volume to'),
      environment_id: z.string().describe('Railway environment ID'),
      mount_path: z.string().describe('Mount path inside the container (e.g. "/data")'),
      name: z.string().optional().describe('Volume name'),
    },
    async ({ project_id, service_id, environment_id, mount_path, name }) => {
      const volume = await createVolume(railwayToken, project_id, service_id, environment_id, mount_path, name);
      return { content: [{ type: 'text', text: JSON.stringify(volume, null, 2) }] };
    }
  );

  server.tool('delete_volume', 'Permanently delete a volume and all its data. Irreversible.',
    { volume_id: z.string().describe('Volume ID to delete') },
    async ({ volume_id }) => {
      await deleteVolume(railwayToken, volume_id);
      return { content: [{ type: 'text', text: `Volume ${volume_id} deleted.` }] };
    }
  );

  server.tool('update_volume', 'Rename a volume.',
    {
      volume_id: z.string().describe('Volume ID'),
      name: z.string().describe('New volume name'),
    },
    async ({ volume_id, name }) => {
      const volume = await updateVolume(railwayToken, volume_id, name);
      return { content: [{ type: 'text', text: JSON.stringify(volume, null, 2) }] };
    }
  );

  server.tool('update_volume_mount', 'Update the mount path of a volume in a specific environment.',
    {
      volume_id: z.string().describe('Volume ID'),
      environment_id: z.string().describe('Railway environment ID'),
      mount_path: z.string().describe('New mount path (e.g. "/app/data")'),
    },
    async ({ volume_id, environment_id, mount_path }) => {
      await updateVolumeMount(railwayToken, volume_id, environment_id, mount_path);
      return { content: [{ type: 'text', text: `Volume ${volume_id} mount path updated to ${mount_path}` }] };
    }
  );

  server.tool('list_volume_backups', 'List backups for a volume instance.',
    { volume_instance_id: z.string().describe('Volume instance ID') },
    async ({ volume_instance_id }) => {
      const backups = await listVolumeBackups(railwayToken, volume_instance_id);
      return { content: [{ type: 'text', text: JSON.stringify(backups, null, 2) }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // PLUGINS (LEGACY DATABASES)
  // ═══════════════════════════════════════════════════════════════════

  server.tool('create_plugin', 'Create a legacy database plugin (Postgres, Redis, MySQL, MongoDB) in a project.',
    {
      project_id: z.string().describe('Railway project ID'),
      name: z.string().describe('Plugin type: "postgresql", "redis", "mysql", or "mongodb"'),
      environment_id: z.string().optional().describe('Environment to create plugin in'),
    },
    async ({ project_id, name, environment_id }) => {
      const plugin = await createPlugin(railwayToken, project_id, name, environment_id);
      return { content: [{ type: 'text', text: JSON.stringify(plugin, null, 2) }] };
    }
  );

  server.tool('delete_plugin', 'Delete a legacy database plugin.',
    {
      plugin_id: z.string().describe('Plugin ID to delete'),
      environment_id: z.string().optional().describe('If provided, only delete in this environment'),
    },
    async ({ plugin_id, environment_id }) => {
      await deletePlugin(railwayToken, plugin_id, environment_id);
      return { content: [{ type: 'text', text: `Plugin ${plugin_id} deleted.` }] };
    }
  );

  server.tool('restart_plugin', 'Restart a legacy database plugin.',
    {
      plugin_id: z.string().describe('Plugin ID to restart'),
      environment_id: z.string().describe('Railway environment ID'),
    },
    async ({ plugin_id, environment_id }) => {
      const result = await restartPlugin(railwayToken, plugin_id, environment_id);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // GITHUB
  // ═══════════════════════════════════════════════════════════════════

  server.tool('list_github_repos', 'List all GitHub repositories accessible to your Railway account.',
    {},
    async () => {
      const repos = await listGithubRepos(railwayToken);
      return { content: [{ type: 'text', text: JSON.stringify(repos, null, 2) }] };
    }
  );

  server.tool('list_github_branches', 'List branches for a GitHub repository.',
    {
      owner: z.string().describe('GitHub repository owner (username or org)'),
      repo: z.string().describe('GitHub repository name'),
    },
    async ({ owner, repo }) => {
      const branches = await listGithubBranches(railwayToken, owner, repo);
      return { content: [{ type: 'text', text: JSON.stringify(branches, null, 2) }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // REGIONS
  // ═══════════════════════════════════════════════════════════════════

  server.tool('list_regions', 'List all available Railway deployment regions.',
    { project_id: z.string().optional().describe('Optional project ID to filter available regions') },
    async ({ project_id }) => {
      const regions = await listRegions(railwayToken, project_id);
      return { content: [{ type: 'text', text: JSON.stringify(regions, null, 2) }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // WEBHOOKS
  // ═══════════════════════════════════════════════════════════════════

  server.tool('list_webhooks', 'List all webhooks configured for a project.',
    { project_id: z.string().describe('Railway project ID') },
    async ({ project_id }) => {
      const webhooks = await listWebhooks(railwayToken, project_id);
      return { content: [{ type: 'text', text: JSON.stringify(webhooks, null, 2) }] };
    }
  );

  server.tool('create_webhook', 'Create a webhook to receive Railway deployment events.',
    {
      project_id: z.string().describe('Railway project ID'),
      url: z.string().describe('HTTPS URL to send webhook events to'),
      secret: z.string().optional().describe('Secret for webhook signature verification'),
      filters: z.array(z.string()).optional().describe('Event filter strings'),
    },
    async ({ project_id, url, secret, filters }) => {
      const webhook = await createWebhook(railwayToken, project_id, url, secret, filters);
      return { content: [{ type: 'text', text: JSON.stringify(webhook, null, 2) }] };
    }
  );

  server.tool('delete_webhook', 'Delete a webhook.',
    { webhook_id: z.string().describe('Webhook ID to delete') },
    async ({ webhook_id }) => {
      await deleteWebhook(railwayToken, webhook_id);
      return { content: [{ type: 'text', text: `Webhook ${webhook_id} deleted.` }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // PRIVATE NETWORKS
  // ═══════════════════════════════════════════════════════════════════

  server.tool('list_private_networks', 'List all private networks in an environment.',
    { environment_id: z.string().describe('Railway environment ID') },
    async ({ environment_id }) => {
      const networks = await listPrivateNetworks(railwayToken, environment_id);
      return { content: [{ type: 'text', text: JSON.stringify(networks, null, 2) }] };
    }
  );

  server.tool('create_private_network', 'Create or get a private network in an environment (for service-to-service communication).',
    {
      project_id: z.string().describe('Railway project ID'),
      environment_id: z.string().describe('Railway environment ID'),
      name: z.string().describe('Network name'),
    },
    async ({ project_id, environment_id, name }) => {
      const network = await createPrivateNetwork(railwayToken, project_id, environment_id, name);
      return { content: [{ type: 'text', text: JSON.stringify(network, null, 2) }] };
    }
  );

  server.tool('create_private_network_endpoint', 'Add a service to a private network.',
    {
      private_network_id: z.string().describe('Private network ID'),
      service_instance_id: z.string().describe('Service instance ID to add to the network'),
      environment_id: z.string().describe('Railway environment ID'),
    },
    async ({ private_network_id, service_instance_id, environment_id }) => {
      const endpoint = await createPrivateNetworkEndpoint(railwayToken, private_network_id, service_instance_id, environment_id);
      return { content: [{ type: 'text', text: JSON.stringify(endpoint, null, 2) }] };
    }
  );

  server.tool('delete_private_network_endpoint', 'Remove a service from a private network.',
    { endpoint_id: z.string().describe('Private network endpoint ID to delete') },
    async ({ endpoint_id }) => {
      await deletePrivateNetworkEndpoint(railwayToken, endpoint_id);
      return { content: [{ type: 'text', text: `Private network endpoint ${endpoint_id} deleted.` }] };
    }
  );

  server.tool('rename_private_network_endpoint', 'Rename a private network endpoint (change its DNS name).',
    {
      endpoint_id: z.string().describe('Private network endpoint ID'),
      private_network_id: z.string().describe('Private network ID'),
      dns_name: z.string().describe('New DNS name for the endpoint'),
    },
    async ({ endpoint_id, private_network_id, dns_name }) => {
      await renamePrivateNetworkEndpoint(railwayToken, endpoint_id, private_network_id, dns_name);
      return { content: [{ type: 'text', text: `Endpoint ${endpoint_id} renamed to ${dns_name}` }] };
    }
  );

  server.tool('delete_all_private_networks', 'Delete all private networks in an environment.',
    { environment_id: z.string().describe('Railway environment ID') },
    async ({ environment_id }) => {
      await deleteAllPrivateNetworks(railwayToken, environment_id);
      return { content: [{ type: 'text', text: `All private networks deleted for environment ${environment_id}` }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // VOLUME BACKUPS
  // ═══════════════════════════════════════════════════════════════════

  server.tool('create_volume_backup', 'Create a backup of a volume instance.',
    { volume_instance_id: z.string().describe('Volume instance ID to backup') },
    async ({ volume_instance_id }) => {
      const result = await createVolumeBackup(railwayToken, volume_instance_id);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool('restore_volume_backup', 'Restore a volume from a backup.',
    {
      volume_instance_id: z.string().describe('Volume instance ID'),
      backup_id: z.string().describe('Backup ID to restore from'),
    },
    async ({ volume_instance_id, backup_id }) => {
      const result = await restoreVolumeBackup(railwayToken, volume_instance_id, backup_id);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool('delete_volume_backup', 'Delete a volume backup.',
    {
      volume_instance_id: z.string().describe('Volume instance ID'),
      backup_id: z.string().describe('Backup ID to delete'),
    },
    async ({ volume_instance_id, backup_id }) => {
      const result = await deleteVolumeBackup(railwayToken, volume_instance_id, backup_id);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool('lock_volume_backup', 'Lock a volume backup to prevent it from expiring.',
    {
      volume_instance_id: z.string().describe('Volume instance ID'),
      backup_id: z.string().describe('Backup ID to lock'),
    },
    async ({ volume_instance_id, backup_id }) => {
      await lockVolumeBackup(railwayToken, volume_instance_id, backup_id);
      return { content: [{ type: 'text', text: `Backup ${backup_id} locked.` }] };
    }
  );

  server.tool('list_volume_backup_schedules', 'List backup schedules for a volume instance.',
    { volume_instance_id: z.string().describe('Volume instance ID') },
    async ({ volume_instance_id }) => {
      const schedules = await listVolumeBackupSchedules(railwayToken, volume_instance_id);
      return { content: [{ type: 'text', text: JSON.stringify(schedules, null, 2) }] };
    }
  );

  server.tool('update_volume_backup_schedule', 'Enable/update backup schedule kinds for a volume instance.',
    {
      volume_instance_id: z.string().describe('Volume instance ID'),
      kinds: z.array(z.string()).describe('Backup schedule kinds to enable (e.g. ["HOURLY", "DAILY", "WEEKLY"])'),
    },
    async ({ volume_instance_id, kinds }) => {
      await updateVolumeBackupSchedule(railwayToken, volume_instance_id, kinds);
      return { content: [{ type: 'text', text: `Backup schedules updated for volume instance ${volume_instance_id}` }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // INTEGRATIONS
  // ═══════════════════════════════════════════════════════════════════

  server.tool('list_integrations', 'List all integrations for a project (e.g. GitHub, Datadog).',
    { project_id: z.string().describe('Railway project ID') },
    async ({ project_id }) => {
      const integrations = await listIntegrations(railwayToken, project_id);
      return { content: [{ type: 'text', text: JSON.stringify(integrations, null, 2) }] };
    }
  );

  server.tool('create_integration', 'Create a new integration for a project.',
    {
      project_id: z.string().describe('Railway project ID'),
      name: z.string().describe('Integration name (e.g. "datadog", "github")'),
      config: z.record(z.unknown()).describe('Integration configuration object'),
    },
    async ({ project_id, name, config }) => {
      const integration = await createIntegration(railwayToken, project_id, name, config);
      return { content: [{ type: 'text', text: JSON.stringify(integration, null, 2) }] };
    }
  );

  server.tool('update_integration', 'Update an existing integration configuration.',
    {
      integration_id: z.string().describe('Integration ID'),
      config: z.record(z.unknown()).describe('New configuration object'),
    },
    async ({ integration_id, config }) => {
      const integration = await updateIntegration(railwayToken, integration_id, config);
      return { content: [{ type: 'text', text: JSON.stringify(integration, null, 2) }] };
    }
  );

  server.tool('delete_integration', 'Delete a project integration.',
    { integration_id: z.string().describe('Integration ID to delete') },
    async ({ integration_id }) => {
      await deleteIntegration(railwayToken, integration_id);
      return { content: [{ type: 'text', text: `Integration ${integration_id} deleted.` }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // SHARED VARIABLES
  // ═══════════════════════════════════════════════════════════════════

  server.tool('configure_shared_variable', 'Configure a shared variable to be shared across multiple services in an environment.',
    {
      environment_id: z.string().describe('Railway environment ID'),
      name: z.string().describe('Variable name to share'),
      service_ids: z.array(z.string()).describe('Service IDs that should have access to this shared variable'),
    },
    async ({ environment_id, name, service_ids }) => {
      const result = await configureSharedVariable(railwayToken, environment_id, name, service_ids);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool('get_variables_for_deployment', 'Get the fully resolved environment variables that a deployment actually runs with (includes referenced/shared vars).',
    {
      project_id: z.string().describe('Railway project ID'),
      environment_id: z.string().describe('Railway environment ID'),
      service_id: z.string().describe('Railway service ID'),
    },
    async ({ project_id, environment_id, service_id }) => {
      const vars = await getVariablesForDeployment(railwayToken, project_id, environment_id, service_id);
      return { content: [{ type: 'text', text: JSON.stringify(vars, null, 2) }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // PROJECT TRANSFER / LEAVE
  // ═══════════════════════════════════════════════════════════════════

  server.tool('transfer_project_to_team', 'Transfer a project to a team/workspace.',
    {
      project_id: z.string().describe('Railway project ID to transfer'),
      team_id: z.string().describe('Team/workspace ID to transfer to'),
    },
    async ({ project_id, team_id }) => {
      await transferProjectToTeam(railwayToken, project_id, team_id);
      return { content: [{ type: 'text', text: `Project ${project_id} transferred to team ${team_id}` }] };
    }
  );

  server.tool('leave_project', 'Leave a project (remove yourself as a member).',
    { project_id: z.string().describe('Railway project ID to leave') },
    async ({ project_id }) => {
      await leaveProject(railwayToken, project_id);
      return { content: [{ type: 'text', text: `Left project ${project_id}` }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // WEBHOOK UPDATE
  // ═══════════════════════════════════════════════════════════════════

  server.tool('update_webhook', 'Update a webhook URL, secret, or event filters.',
    {
      webhook_id: z.string().describe('Webhook ID to update'),
      url: z.string().optional().describe('New webhook URL'),
      secret: z.string().optional().describe('New signing secret'),
      filters: z.array(z.string()).optional().describe('New event filter strings'),
    },
    async ({ webhook_id, url, secret, filters }) => {
      const webhook = await updateWebhook(railwayToken, webhook_id, { url, secret, filters });
      return { content: [{ type: 'text', text: JSON.stringify(webhook, null, 2) }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // USAGE LIMITS
  // ═══════════════════════════════════════════════════════════════════

  server.tool('set_usage_limit', 'Set a hard spending limit and optional notification threshold for a project.',
    {
      project_id: z.string().describe('Railway project ID'),
      hard_limit_dollars: z.number().describe('Hard spending limit in USD (0 = unlimited)'),
      notification_dollars: z.number().optional().describe('Dollar amount at which to send a notification alert'),
    },
    async ({ project_id, hard_limit_dollars, notification_dollars }) => {
      await setUsageLimit(railwayToken, project_id, hard_limit_dollars, notification_dollars);
      return { content: [{ type: 'text', text: `Usage limit set: $${hard_limit_dollars} hard limit for project ${project_id}` }] };
    }
  );

  server.tool('remove_usage_limit', 'Remove spending limits from a project.',
    { project_id: z.string().describe('Railway project ID') },
    async ({ project_id }) => {
      await removeUsageLimit(railwayToken, project_id);
      return { content: [{ type: 'text', text: `Usage limit removed from project ${project_id}` }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // ENVIRONMENTS (EXTENDED)
  // ═══════════════════════════════════════════════════════════════════

  server.tool('get_environment', 'Get details of a single environment by ID.',
    { environment_id: z.string().describe('Railway environment ID') },
    async ({ environment_id }) => {
      const env = await getEnvironment(railwayToken, environment_id);
      return { content: [{ type: 'text', text: JSON.stringify(env, null, 2) }] };
    }
  );

  server.tool('set_base_environment', 'Set or override the base environment that an environment inherits from.',
    {
      environment_id: z.string().describe('Railway environment ID'),
      base_environment_id: z.string().nullable().describe('Base environment ID to inherit from (null to remove override)'),
    },
    async ({ environment_id, base_environment_id }) => {
      await overrideBaseEnvironment(railwayToken, environment_id, base_environment_id);
      return { content: [{ type: 'text', text: `Base environment set for ${environment_id}` }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // EGRESS GATEWAYS (STATIC IPs)
  // ═══════════════════════════════════════════════════════════════════

  server.tool('list_egress_gateways', 'List egress gateways (static IPs) for a service.',
    {
      environment_id: z.string().describe('Railway environment ID'),
      service_id: z.string().describe('Railway service ID'),
    },
    async ({ environment_id, service_id }) => {
      const gateways = await listEgressGateways(railwayToken, environment_id, service_id);
      return { content: [{ type: 'text', text: JSON.stringify(gateways, null, 2) }] };
    }
  );

  server.tool('create_egress_gateway', 'Create an egress gateway to give a service a static outbound IP address.',
    {
      environment_id: z.string().describe('Railway environment ID'),
      service_id: z.string().describe('Railway service ID'),
      region: z.string().describe('Region for the egress gateway (e.g. "us-west2")'),
    },
    async ({ environment_id, service_id, region }) => {
      const gateway = await createEgressGateway(railwayToken, environment_id, service_id, region);
      return { content: [{ type: 'text', text: JSON.stringify(gateway, null, 2) }] };
    }
  );

  server.tool('clear_egress_gateways', 'Remove all egress gateways from a service (removes static IP).',
    {
      environment_id: z.string().describe('Railway environment ID'),
      service_id: z.string().describe('Railway service ID'),
    },
    async ({ environment_id, service_id }) => {
      await clearEgressGateways(railwayToken, environment_id, service_id);
      return { content: [{ type: 'text', text: `Egress gateways cleared for service ${service_id}` }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // TEMPLATES
  // ═══════════════════════════════════════════════════════════════════

  server.tool('deploy_template', 'Deploy a Railway template to create a new project with preconfigured services.',
    {
      template_code: z.string().describe('Railway template code (from railway.app/templates)'),
      project_id: z.string().optional().describe('Existing project ID to deploy into (omit to create new project)'),
      environment_id: z.string().optional().describe('Environment ID to deploy into'),
    },
    async ({ template_code, project_id, environment_id }) => {
      const result = await deployTemplate(railwayToken, template_code, project_id, environment_id);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // DOCKER COMPOSE
  // ═══════════════════════════════════════════════════════════════════

  server.tool('import_docker_compose', 'Import a docker-compose.yml file to create services in a project.',
    {
      project_id: z.string().describe('Railway project ID'),
      environment_id: z.string().describe('Railway environment ID'),
      yaml: z.string().describe('Contents of the docker-compose.yml file'),
    },
    async ({ project_id, environment_id, yaml }) => {
      const result = await importDockerCompose(railwayToken, project_id, environment_id, yaml);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // SERVICE (EXTENDED)
  // ═══════════════════════════════════════════════════════════════════

  server.tool('remove_service_upstream_url', 'Remove the upstream URL configuration from a service.',
    { service_id: z.string().describe('Railway service ID') },
    async ({ service_id }) => {
      const result = await removeServiceUpstreamUrl(railwayToken, service_id);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool('get_service_resource_limits', 'Get the resource limits (CPU, memory) configured for a service instance.',
    {
      project_id: z.string().describe('Railway project ID'),
      environment_id: z.string().describe('Railway environment ID'),
      service_id: z.string().describe('Railway service ID'),
    },
    async ({ project_id, environment_id, service_id }) => {
      const limits = await getServiceInstanceLimits(railwayToken, project_id, environment_id, service_id);
      return { content: [{ type: 'text', text: JSON.stringify(limits, null, 2) }] };
    }
  );

  server.tool('update_service_resource_limits', 'Update CPU and memory resource limits for a service instance.',
    {
      project_id: z.string().describe('Railway project ID'),
      environment_id: z.string().describe('Railway environment ID'),
      service_id: z.string().describe('Railway service ID'),
      cpu_limit: z.number().optional().describe('CPU limit in vCPU cores (e.g. 1.0 = 1 vCPU)'),
      memory_limit_mb: z.number().optional().describe('Memory limit in MB (e.g. 512)'),
      cpu_request: z.number().optional().describe('CPU request/reservation in vCPU cores'),
      memory_request_mb: z.number().optional().describe('Memory request/reservation in MB'),
    },
    async ({ project_id, environment_id, service_id, cpu_limit, memory_limit_mb, cpu_request, memory_request_mb }) => {
      await updateServiceInstanceLimits(railwayToken, { projectId: project_id, environmentId: environment_id, serviceId: service_id, cpuLimit: cpu_limit, memoryLimitMB: memory_limit_mb, cpuRequest: cpu_request, memoryRequestMB: memory_request_mb });
      return { content: [{ type: 'text', text: `Resource limits updated for service ${service_id}` }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // PLUGIN (EXTENDED)
  // ═══════════════════════════════════════════════════════════════════

  server.tool('get_plugin', 'Get details of a single plugin/database by ID.',
    { plugin_id: z.string().describe('Plugin ID') },
    async ({ plugin_id }) => {
      const plugin = await getPlugin(railwayToken, plugin_id);
      return { content: [{ type: 'text', text: JSON.stringify(plugin, null, 2) }] };
    }
  );

  server.tool('get_plugin_logs', 'Get logs from a legacy database plugin.',
    {
      plugin_id: z.string().describe('Plugin ID'),
      environment_id: z.string().describe('Railway environment ID'),
      filter: z.string().optional().describe('Text filter for log messages'),
      limit: z.number().optional().describe('Max log lines to return'),
    },
    async ({ plugin_id, environment_id, filter, limit }) => {
      const logs = await getPluginLogs(railwayToken, plugin_id, environment_id, filter, limit);
      const text = logs.map((l) => `[${l.timestamp}] ${l.severity}: ${l.message}`).join('\n');
      return { content: [{ type: 'text', text: text || 'No logs found.' }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // METRICS & USAGE
  // ═══════════════════════════════════════════════════════════════════

  server.tool('get_metrics', 'Get resource metrics (CPU, memory, network) for a service over time.',
    {
      start_date: z.string().describe('Start date in ISO format (e.g. "2024-01-01T00:00:00Z")'),
      measurements: z.array(z.string()).describe('Metric measurements to fetch. Valid values: CPU_USAGE, MEMORY_USAGE_GB, NETWORK_TX_KB, NETWORK_RX_KB, DISK_USAGE_GB'),
      end_date: z.string().optional().describe('End date in ISO format (defaults to now)'),
      environment_id: z.string().optional().describe('Filter by environment ID'),
      service_id: z.string().optional().describe('Filter by service ID'),
      project_id: z.string().optional().describe('Filter by project ID'),
      sample_rate_seconds: z.number().optional().describe('Sampling interval in seconds'),
    },
    async ({ start_date, measurements, end_date, environment_id, service_id, project_id, sample_rate_seconds }) => {
      const metrics = await getMetrics(railwayToken, start_date, measurements, { endDate: end_date, environmentId: environment_id, serviceId: service_id, projectId: project_id, sampleRateSeconds: sample_rate_seconds });
      return { content: [{ type: 'text', text: JSON.stringify(metrics, null, 2) }] };
    }
  );

  server.tool('get_usage', 'Get aggregated resource usage and costs for a project.',
    {
      measurements: z.array(z.string()).describe('Usage measurements: CPU_USAGE, MEMORY_USAGE_GB, DISK_USAGE_GB, NETWORK_TX_KB, NETWORK_RX_KB'),
      project_id: z.string().optional().describe('Filter by project ID'),
      team_id: z.string().optional().describe('Filter by team/workspace ID'),
      start_date: z.string().optional().describe('Start date in ISO format'),
      end_date: z.string().optional().describe('End date in ISO format'),
    },
    async ({ measurements, project_id, team_id, start_date, end_date }) => {
      const usage = await getUsage(railwayToken, measurements, { projectId: project_id, teamId: team_id, startDate: start_date, endDate: end_date });
      return { content: [{ type: 'text', text: JSON.stringify(usage, null, 2) }] };
    }
  );

  server.tool('get_estimated_usage', 'Get estimated current month cost/usage for a project.',
    {
      measurements: z.array(z.string()).describe('Measurements: CPU_USAGE, MEMORY_USAGE_GB, DISK_USAGE_GB, NETWORK_TX_KB, NETWORK_RX_KB'),
      project_id: z.string().optional().describe('Filter by project ID'),
      team_id: z.string().optional().describe('Filter by team/workspace ID'),
    },
    async ({ measurements, project_id, team_id }) => {
      const usage = await getEstimatedUsage(railwayToken, measurements, project_id, team_id);
      return { content: [{ type: 'text', text: JSON.stringify(usage, null, 2) }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // DEPLOYMENT (EXTENDED)
  // ═══════════════════════════════════════════════════════════════════

  server.tool('get_deployment_snapshot', 'Get the variable snapshot captured at the time of a deployment.',
    { deployment_id: z.string().describe('Railway deployment ID') },
    async ({ deployment_id }) => {
      const snapshot = await getDeploymentSnapshot(railwayToken, deployment_id);
      return { content: [{ type: 'text', text: JSON.stringify(snapshot, null, 2) }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // GITHUB (EXTENDED)
  // ═══════════════════════════════════════════════════════════════════

  server.tool('check_github_repo_access', 'Check if Railway has access to a GitHub repository.',
    { full_repo_name: z.string().describe('Full GitHub repo name (e.g. "owner/repo")') },
    async ({ full_repo_name }) => {
      const result = await checkGithubRepoAccess(railwayToken, full_repo_name);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // API TOKENS
  // ═══════════════════════════════════════════════════════════════════

  server.tool('create_api_token', 'Create a new Railway API token.',
    {
      name: z.string().describe('Token name/label'),
      team_id: z.string().optional().describe('Team ID to scope the token to (omit for account-scoped token)'),
    },
    async ({ name, team_id }) => {
      const token = await createApiToken(railwayToken, name, team_id);
      return { content: [{ type: 'text', text: `API token created: ${token}` }] };
    }
  );

  server.tool('delete_api_token', 'Delete a Railway API token.',
    { token_id: z.string().describe('API token ID to delete') },
    async ({ token_id }) => {
      await deleteApiToken(railwayToken, token_id);
      return { content: [{ type: 'text', text: `API token ${token_id} deleted.` }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // WORKFLOW STATUS
  // ═══════════════════════════════════════════════════════════════════

  server.tool('get_workflow_status', 'Poll the status of an async workflow (e.g. after template deploy).',
    {
      project_id: z.string().describe('Railway project ID'),
      workflow_id: z.string().describe('Workflow ID returned from async operations like deploy_template'),
    },
    async ({ project_id, workflow_id }) => {
      const status = await getWorkflowStatus(railwayToken, project_id, workflow_id);
      return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // PLUGIN (FULL LIFECYCLE)
  // ═══════════════════════════════════════════════════════════════════

  server.tool('start_plugin', 'Start a stopped legacy database plugin.',
    {
      plugin_id: z.string().describe('Plugin ID to start'),
      environment_id: z.string().describe('Railway environment ID'),
    },
    async ({ plugin_id, environment_id }) => {
      await startPlugin(railwayToken, plugin_id, environment_id);
      return { content: [{ type: 'text', text: `Plugin ${plugin_id} started.` }] };
    }
  );

  server.tool('update_plugin', 'Update a plugin\'s settings (e.g. enable logs).',
    {
      plugin_id: z.string().describe('Plugin ID'),
      logs_enabled: z.boolean().optional().describe('Whether to enable logs for this plugin'),
    },
    async ({ plugin_id, logs_enabled }) => {
      const result = await updatePlugin(railwayToken, plugin_id, { logsEnabled: logs_enabled });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool('reset_plugin', 'Reset a plugin (wipe its data and restart with fresh state).',
    {
      plugin_id: z.string().describe('Plugin ID to reset'),
      environment_id: z.string().describe('Railway environment ID'),
    },
    async ({ plugin_id, environment_id }) => {
      await resetPlugin(railwayToken, plugin_id, environment_id);
      return { content: [{ type: 'text', text: `Plugin ${plugin_id} reset.` }] };
    }
  );

  server.tool('reset_plugin_credentials', 'Regenerate the credentials (connection string/password) for a plugin.',
    {
      plugin_id: z.string().describe('Plugin ID'),
      environment_id: z.string().describe('Railway environment ID'),
    },
    async ({ plugin_id, environment_id }) => {
      await resetPluginCredentials(railwayToken, plugin_id, environment_id);
      return { content: [{ type: 'text', text: `Plugin ${plugin_id} credentials reset.` }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // GITHUB (UPDATE REPO CONNECTION)
  // ═══════════════════════════════════════════════════════════════════

  server.tool('update_github_repo', 'Update the GitHub repository connection for a service (change branch, repo, or root directory).',
    {
      project_id: z.string().describe('Railway project ID'),
      service_id: z.string().describe('Railway service ID'),
      repo: z.string().optional().describe('New GitHub repo full name (e.g. "owner/repo")'),
      branch: z.string().optional().describe('New branch to deploy'),
      root_directory: z.string().optional().describe('New root directory within the repo'),
    },
    async ({ project_id, service_id, repo, branch, root_directory }) => {
      await updateGithubRepo(railwayToken, { projectId: project_id, serviceId: service_id, repo, branch, rootDirectory: root_directory });
      return { content: [{ type: 'text', text: `GitHub repo connection updated for service ${service_id}` }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // WORKSPACE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════

  server.tool('update_workspace', 'Rename a Railway workspace.',
    {
      workspace_id: z.string().describe('Railway workspace ID'),
      name: z.string().describe('New workspace name'),
    },
    async ({ workspace_id, name }) => {
      await updateWorkspace(railwayToken, workspace_id, name);
      return { content: [{ type: 'text', text: `Workspace ${workspace_id} renamed to ${name}` }] };
    }
  );

  server.tool('delete_workspace', 'Delete a Railway workspace. Irreversible — all projects will be deleted.',
    { workspace_id: z.string().describe('Railway workspace ID to delete') },
    async ({ workspace_id }) => {
      await deleteWorkspace(railwayToken, workspace_id);
      return { content: [{ type: 'text', text: `Workspace ${workspace_id} deleted.` }] };
    }
  );

  server.tool('leave_workspace', 'Leave a Railway workspace (remove yourself as a member).',
    { workspace_id: z.string().describe('Railway workspace ID to leave') },
    async ({ workspace_id }) => {
      await leaveWorkspace(railwayToken, workspace_id);
      return { content: [{ type: 'text', text: `Left workspace ${workspace_id}` }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // PROJECT SCHEDULED DELETION
  // ═══════════════════════════════════════════════════════════════════

  server.tool('schedule_project_delete', 'Schedule a project for deletion (deferred deletion with a grace period).',
    { project_id: z.string().describe('Railway project ID to schedule for deletion') },
    async ({ project_id }) => {
      await scheduleProjectDelete(railwayToken, project_id);
      return { content: [{ type: 'text', text: `Project ${project_id} scheduled for deletion.` }] };
    }
  );

  server.tool('cancel_project_delete', 'Cancel a previously scheduled project deletion.',
    { project_id: z.string().describe('Railway project ID') },
    async ({ project_id }) => {
      await cancelScheduledProjectDelete(railwayToken, project_id);
      return { content: [{ type: 'text', text: `Project ${project_id} deletion cancelled.` }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // PROJECT INVITATION (EXTENDED)
  // ═══════════════════════════════════════════════════════════════════

  server.tool('resend_project_invitation', 'Resend a pending project invitation email.',
    { invitation_id: z.string().describe('Invitation ID to resend') },
    async ({ invitation_id }) => {
      const result = await resendProjectInvitation(railwayToken, invitation_id);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  return server;
}

// ─── Auth middleware ───────────────────────────────────────────────────────────

function authenticate(req: Request, res: Response, next: NextFunction) {
  if (!MCP_API_KEY) return next();
  const key = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : (req.headers['x-api-key'] as string | undefined);
  if (!key) { res.status(401).json({ error: 'Missing API key' }); return; }
  if (key !== MCP_API_KEY) { res.status(403).json({ error: 'Invalid API key' }); return; }
  next();
}

function resolveRailwayToken(req: Request): string | null {
  return (req.headers['x-railway-token'] as string | undefined)
    ?? process.env.RAILWAY_TOKEN
    ?? null;
}

// ─── Express app ─────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.json({
  status: 'ok', server: 'railway-mcp', version: '2.0.0',
  auth: MCP_API_KEY ? 'enabled' : 'disabled',
  token_mode: process.env.RAILWAY_TOKEN ? 'env (RAILWAY_TOKEN)' : 'per-request (X-Railway-Token header)',
}));

app.post('/mcp', authenticate, async (req: Request, res: Response) => {
  const railwayToken = resolveRailwayToken(req);
  if (!railwayToken) {
    res.status(400).json({ error: 'No Railway token. Set RAILWAY_TOKEN env or pass X-Railway-Token header.' });
    return;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on('close', () => transport.close());

  const server = createMcpServer(railwayToken);
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get('/mcp', authenticate, (_req, res) => res.status(405).json({ error: 'Use POST /mcp' }));
app.delete('/mcp', authenticate, (_req, res) => res.status(405).json({ error: 'Stateless mode' }));

app.listen(PORT, () => {
  console.log(`railway-mcp running on http://0.0.0.0:${PORT}`);
  console.log(`  Token: ${process.env.RAILWAY_TOKEN ? 'RAILWAY_TOKEN env' : 'X-Railway-Token header per request'}`);
});
