// Railway GraphQL API — all ID arguments use String!, not ID!
// Tested live against https://backboard.railway.com/graphql/v2
const RAILWAY_GQL = 'https://backboard.railway.com/graphql/v2';
const FETCH_TIMEOUT_MS = 30_000;

export async function gql<T = unknown>(
  token: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(RAILWAY_GQL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Railway API HTTP ${res.status}: ${body}`);
  }

  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join('; '));
  if (!json.data) throw new Error('Empty response from Railway API');
  return json.data;
}

// ─── Account / Workspace ─────────────────────────────────────────────────────

export async function getMe(token: string) {
  const data = await gql<{
    me: { name: string; email: string; workspaces: { id: string; name: string }[] };
  }>(token, `query { me { name email workspaces { id name } } }`);
  return data.me;
}

// ─── Projects ────────────────────────────────────────────────────────────────

export async function listProjects(token: string, workspaceId: string) {
  const data = await gql<{
    workspace: {
      projects: {
        edges: {
          node: {
            id: string; name: string; description: string; createdAt: string; updatedAt: string;
            services: { edges: { node: { id: string; name: string } }[] };
            environments: { edges: { node: { id: string; name: string } }[] };
          };
        }[];
      };
    };
  }>(token, `
    query($workspaceId: String!) {
      workspace(workspaceId: $workspaceId) {
        projects {
          edges {
            node {
              id name description createdAt updatedAt
              services { edges { node { id name } } }
              environments { edges { node { id name } } }
            }
          }
        }
      }
    }
  `, { workspaceId });
  return data.workspace.projects.edges.map((e) => e.node);
}

export async function getProject(token: string, projectId: string) {
  const data = await gql<{
    project: {
      id: string; name: string; description: string; createdAt: string; updatedAt: string;
      isPublic: boolean; prDeploys: boolean; teamId: string | null;
      environments: { edges: { node: { id: string; name: string } }[] };
      services: { edges: { node: { id: string; name: string } }[] };
    };
  }>(token, `
    query($id: String!) {
      project(id: $id) {
        id name description createdAt updatedAt isPublic prDeploys teamId
        environments { edges { node { id name } } }
        services { edges { node { id name } } }
      }
    }
  `, { id: projectId });
  return data.project;
}

export async function createProject(token: string, name: string, description?: string, teamId?: string) {
  const data = await gql<{ projectCreate: { id: string; name: string; description: string } }>(token, `
    mutation($input: ProjectCreateInput!) {
      projectCreate(input: $input) { id name description }
    }
  `, { input: { name, description, teamId } });
  return data.projectCreate;
}

export async function updateProject(token: string, id: string, input: { name?: string; description?: string }) {
  const data = await gql<{ projectUpdate: { id: string; name: string; description: string } }>(token, `
    mutation($id: String!, $input: ProjectUpdateInput!) {
      projectUpdate(id: $id, input: $input) { id name description }
    }
  `, { id, input });
  return data.projectUpdate;
}

export async function deleteProject(token: string, id: string) {
  await gql(token, `mutation($id: String!) { projectDelete(id: $id) }`, { id });
}

export async function listProjectMembers(token: string, projectId: string) {
  const data = await gql<{
    projectMembers: { id: string; name: string; email: string; avatar: string; role: string }[];
  }>(token, `
    query($projectId: String!) {
      projectMembers(projectId: $projectId) { id name email avatar role }
    }
  `, { projectId });
  return data.projectMembers;
}

export async function inviteProjectUser(token: string, id: string, email: string, role: string) {
  await gql(token, `
    mutation($id: String!, $input: ProjectInviteUserInput!) { projectInviteUser(id: $id, input: $input) }
  `, { id, input: { email, role } });
}

export async function removeProjectMember(token: string, projectId: string, userId: string) {
  const data = await gql<{ projectMemberRemove: { id: string; name: string; email: string; role: string } }>(token, `
    mutation($input: ProjectMemberRemoveInput!) {
      projectMemberRemove(input: $input) { id name email role }
    }
  `, { input: { projectId, userId } });
  return data.projectMemberRemove;
}

export async function updateProjectMember(token: string, projectId: string, userId: string, role: string) {
  const data = await gql<{ projectMemberUpdate: { id: string; name: string; email: string; role: string } }>(token, `
    mutation($input: ProjectMemberUpdateInput!) {
      projectMemberUpdate(input: $input) { id name email role }
    }
  `, { input: { projectId, userId, role } });
  return data.projectMemberUpdate;
}

export async function createProjectToken(token: string, projectId: string, environmentId: string, name: string) {
  const data = await gql<{ projectTokenCreate: string }>(token, `
    mutation($input: ProjectTokenCreateInput!) { projectTokenCreate(input: $input) }
  `, { input: { projectId, environmentId, name } });
  return data.projectTokenCreate;
}

export async function deleteProjectToken(token: string, id: string) {
  await gql(token, `mutation($id: String!) { projectTokenDelete(id: $id) }`, { id });
}

export async function createProjectInvitation(token: string, id: string, email: string, role: string) {
  const data = await gql<{ projectInvitationCreate: { id: string; email: string; expiresAt: string; isExpired: boolean } }>(token, `
    mutation($id: String!, $input: ProjectInvitee!) {
      projectInvitationCreate(id: $id, input: $input) { id email expiresAt isExpired }
    }
  `, { id, input: { email, role } });
  return data.projectInvitationCreate;
}

export async function deleteProjectInvitation(token: string, id: string) {
  await gql(token, `mutation($id: String!) { projectInvitationDelete(id: $id) }`, { id });
}

// ─── Services ────────────────────────────────────────────────────────────────

export async function listServices(token: string, projectId: string) {
  const data = await gql<{
    project: {
      services: { edges: { node: { id: string; name: string; updatedAt: string } }[] };
    };
  }>(token, `
    query($projectId: String!) {
      project(id: $projectId) {
        services { edges { node { id name updatedAt } } }
      }
    }
  `, { projectId });
  return data.project.services.edges.map((e) => e.node);
}

export async function getService(token: string, serviceId: string) {
  const data = await gql<{
    service: {
      id: string; name: string; projectId: string; createdAt: string; updatedAt: string;
      icon: string | null; featureFlags: string[];
    };
  }>(token, `
    query($id: String!) {
      service(id: $id) { id name projectId createdAt updatedAt icon featureFlags }
    }
  `, { id: serviceId });
  return data.service;
}

export async function createService(
  token: string,
  projectId: string,
  name?: string,
  source?: { type: 'GITHUB'; repo: string; branch?: string; rootDirectory?: string }
         | { type: 'IMAGE'; image: string }
) {
  let gqlSource: Record<string, unknown> | undefined;
  if (source?.type === 'GITHUB') {
    gqlSource = { repo: source.repo, branch: source.branch, rootDirectory: source.rootDirectory };
  } else if (source?.type === 'IMAGE') {
    gqlSource = { image: source.image };
  }

  const data = await gql<{
    serviceCreate: { id: string; name: string; projectId: string };
  }>(token, `
    mutation($input: ServiceCreateInput!) {
      serviceCreate(input: $input) { id name projectId }
    }
  `, { input: { projectId, name, source: gqlSource } });
  return data.serviceCreate;
}

export async function updateService(token: string, id: string, input: { name?: string; icon?: string }) {
  const data = await gql<{ serviceUpdate: { id: string; name: string } }>(token, `
    mutation($id: String!, $input: ServiceUpdateInput!) {
      serviceUpdate(id: $id, input: $input) { id name }
    }
  `, { id, input });
  return data.serviceUpdate;
}

export async function deleteService(token: string, id: string, environmentId?: string) {
  await gql(token, `
    mutation($id: String!, $environmentId: String) { serviceDelete(id: $id, environmentId: $environmentId) }
  `, { id, environmentId });
}

export async function connectService(token: string, id: string, source: { repo: string; branch?: string; rootDirectory?: string }) {
  const data = await gql<{ serviceConnect: { id: string; name: string } }>(token, `
    mutation($id: String!, $input: ServiceConnectInput!) {
      serviceConnect(id: $id, input: $input) { id name }
    }
  `, { id, input: source });
  return data.serviceConnect;
}

export async function disconnectService(token: string, id: string) {
  const data = await gql<{ serviceDisconnect: { id: string; name: string } }>(token, `
    mutation($id: String!) {
      serviceDisconnect(id: $id) { id name }
    }
  `, { id });
  return data.serviceDisconnect;
}

export async function duplicateService(token: string, serviceId: string, environmentId: string) {
  const data = await gql<{ serviceDuplicate: { id: string; name: string } }>(token, `
    mutation($serviceId: String!, $environmentId: String!) {
      serviceDuplicate(serviceId: $serviceId, environmentId: $environmentId) { id name projectId }
    }
  `, { serviceId, environmentId });
  return data.serviceDuplicate;
}

export async function getServiceInstance(token: string, serviceId: string, environmentId: string) {
  const data = await gql<{
    serviceInstance: {
      id: string; serviceId: string; environmentId: string;
      buildCommand: string | null; startCommand: string | null; rootDirectory: string | null;
      healthcheckPath: string | null; healthcheckTimeout: number | null;
      region: string | null; numReplicas: number; cronSchedule: string | null;
      restartPolicyType: string; restartPolicyMaxRetries: number;
      sleepApplication: boolean; nixpacksPlan: string | null; watchPatterns: string[];
      upstreamUrl: string | null; railwayConfigFile: string | null;
    };
  }>(token, `
    query($serviceId: String!, $environmentId: String!) {
      serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
        id serviceId environmentId buildCommand startCommand rootDirectory
        healthcheckPath healthcheckTimeout region numReplicas cronSchedule
        restartPolicyType restartPolicyMaxRetries sleepApplication nixpacksPlan
        watchPatterns upstreamUrl railwayConfigFile
      }
    }
  `, { serviceId, environmentId });
  return data.serviceInstance;
}

export async function updateServiceInstance(
  token: string,
  serviceId: string,
  environmentId: string,
  input: {
    buildCommand?: string | null;
    startCommand?: string | null;
    rootDirectory?: string | null;
    healthcheckPath?: string | null;
    healthcheckTimeout?: number | null;
    region?: string;
    numReplicas?: number;
    cronSchedule?: string | null;
    restartPolicyType?: string;
    restartPolicyMaxRetries?: number;
    sleepApplication?: boolean;
    watchPatterns?: string[];
    railwayConfigFile?: string | null;
  }
) {
  await gql(token, `
    mutation($serviceId: String!, $environmentId: String, $input: ServiceInstanceUpdateInput!) {
      serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
    }
  `, { serviceId, environmentId, input });
}

export async function deployService(
  token: string,
  serviceId: string,
  environmentId: string,
  options?: { commitSha?: string; latestCommit?: boolean }
) {
  const data = await gql<{ serviceInstanceDeploy: string }>(token, `
    mutation($serviceId: String!, $environmentId: String!, $commitSha: String, $latestCommit: Boolean) {
      serviceInstanceDeploy(serviceId: $serviceId, environmentId: $environmentId, commitSha: $commitSha, latestCommit: $latestCommit)
    }
  `, { serviceId, environmentId, ...options });
  return data.serviceInstanceDeploy;
}

// ─── Environments ────────────────────────────────────────────────────────────

export async function listEnvironments(token: string, projectId: string) {
  const data = await gql<{
    project: {
      environments: { edges: { node: { id: string; name: string; createdAt: string } }[] };
    };
  }>(token, `
    query($projectId: String!) {
      project(id: $projectId) {
        environments { edges { node { id name createdAt } } }
      }
    }
  `, { projectId });
  return data.project.environments.edges.map((e) => e.node);
}

export async function createEnvironment(token: string, projectId: string, name: string) {
  const data = await gql<{ environmentCreate: { id: string; name: string } }>(token, `
    mutation($input: EnvironmentCreateInput!) {
      environmentCreate(input: $input) { id name }
    }
  `, { input: { projectId, name } });
  return data.environmentCreate;
}

export async function deleteEnvironment(token: string, id: string) {
  await gql(token, `mutation($id: String!) { environmentDelete(id: $id) }`, { id });
}

export async function renameEnvironment(token: string, id: string, name: string) {
  const data = await gql<{ environmentRename: { id: string; name: string } }>(token, `
    mutation($id: String!, $input: EnvironmentRenameInput!) {
      environmentRename(id: $id, input: $input) { id name }
    }
  `, { id, input: { name } });
  return data.environmentRename;
}

export async function triggerEnvironmentDeploys(token: string, environmentId: string, serviceIds?: string[]) {
  await gql(token, `
    mutation($input: EnvironmentTriggersDeployInput!) { environmentTriggersDeploy(input: $input) }
  `, { input: { environmentId, serviceIds } });
}

// ─── Deployments ─────────────────────────────────────────────────────────────

export async function listDeployments(
  token: string,
  projectId: string,
  environmentId: string,
  serviceId: string,
  limit = 10
) {
  const data = await gql<{
    deployments: {
      edges: {
        node: {
          id: string; status: string; createdAt: string; updatedAt: string;
          staticUrl: string | null; url: string | null; canRollback: boolean; canRedeploy: boolean;
        };
      }[];
    };
  }>(token, `
    query($projectId: String!, $environmentId: String!, $serviceId: String!, $limit: Int!) {
      deployments(
        first: $limit
        input: { projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId }
      ) {
        edges { node { id status createdAt updatedAt staticUrl url canRollback canRedeploy } }
      }
    }
  `, { projectId, environmentId, serviceId, limit });
  return data.deployments.edges.map((e) => e.node);
}

export async function getDeployment(token: string, deploymentId: string) {
  const data = await gql<{
    deployment: {
      id: string; status: string; createdAt: string; updatedAt: string;
      staticUrl: string | null; url: string | null;
      canRollback: boolean; canRedeploy: boolean; deploymentStopped: boolean;
      environmentId: string; serviceId: string; projectId: string;
    };
  }>(token, `
    query($id: String!) {
      deployment(id: $id) {
        id status createdAt updatedAt staticUrl url
        canRollback canRedeploy deploymentStopped
        environmentId serviceId projectId
      }
    }
  `, { id: deploymentId });
  return data.deployment;
}

export async function getDeploymentLogs(token: string, deploymentId: string, limit?: number, filter?: string) {
  const data = await gql<{
    deploymentLogs: { timestamp: string; message: string; severity: string }[];
  }>(token, `
    query($deploymentId: String!, $limit: Int, $filter: String) {
      deploymentLogs(deploymentId: $deploymentId, limit: $limit, filter: $filter) { timestamp message severity }
    }
  `, { deploymentId, limit, filter });
  return data.deploymentLogs;
}

export async function getBuildLogs(token: string, deploymentId: string, limit?: number, filter?: string) {
  const data = await gql<{
    buildLogs: { timestamp: string; message: string; severity: string }[];
  }>(token, `
    query($deploymentId: String!, $limit: Int, $filter: String) {
      buildLogs(deploymentId: $deploymentId, limit: $limit, filter: $filter) { timestamp message severity }
    }
  `, { deploymentId, limit, filter });
  return data.buildLogs;
}

export async function getEnvironmentLogs(token: string, environmentId: string, filter?: string, beforeLimit?: number) {
  const data = await gql<{
    environmentLogs: { timestamp: string; message: string; severity: string }[];
  }>(token, `
    query($environmentId: String!, $filter: String, $beforeLimit: Int) {
      environmentLogs(environmentId: $environmentId, filter: $filter, beforeLimit: $beforeLimit) { timestamp message severity }
    }
  `, { environmentId, filter, beforeLimit });
  return data.environmentLogs;
}

export async function getHttpLogs(token: string, deploymentId: string, filter?: string, limit?: number) {
  const data = await gql<{
    httpLogs: {
      timestamp: string; method: string; path: string; host: string;
      httpStatus: number; totalDuration: number; txBytes: number; rxBytes: number;
      srcIp: string; requestId: string;
    }[];
  }>(token, `
    query($deploymentId: String!, $filter: String, $limit: Int) {
      httpLogs(deploymentId: $deploymentId, filter: $filter, limit: $limit) {
        timestamp method path host httpStatus totalDuration txBytes rxBytes srcIp requestId
      }
    }
  `, { deploymentId, filter, limit });
  return data.httpLogs;
}

export async function redeployService(token: string, environmentId: string, serviceId: string) {
  await gql(token, `
    mutation($environmentId: String!, $serviceId: String!) {
      serviceInstanceRedeploy(environmentId: $environmentId, serviceId: $serviceId)
    }
  `, { environmentId, serviceId });
}

export async function restartDeployment(token: string, deploymentId: string) {
  await gql(token, `mutation($id: String!) { deploymentRestart(id: $id) }`, { id: deploymentId });
}

export async function cancelDeployment(token: string, id: string) {
  await gql(token, `mutation($id: String!) { deploymentCancel(id: $id) }`, { id });
}

export async function stopDeployment(token: string, id: string) {
  await gql(token, `mutation($id: String!) { deploymentStop(id: $id) }`, { id });
}

export async function rollbackDeployment(token: string, id: string, targetDeploymentId: string) {
  await gql(token, `
    mutation($id: String!, $targetDeploymentId: String!) { deploymentRollback(id: $id, targetDeploymentId: $targetDeploymentId) }
  `, { id, targetDeploymentId });
}

export async function removeDeployment(token: string, id: string) {
  await gql(token, `mutation($id: String!) { deploymentRemove(id: $id) }`, { id });
}

export async function approveDeployment(token: string, id: string) {
  await gql(token, `mutation($id: String!) { deploymentApprove(id: $id) }`, { id });
}

export async function listDeploymentTriggers(
  token: string,
  projectId: string,
  environmentId: string,
  serviceId: string
) {
  const data = await gql<{
    deploymentTriggers: {
      edges: {
        node: {
          id: string; branch: string; repository: string; provider: string;
          environmentId: string; serviceId: string; projectId: string;
          checkSuites: boolean;
        };
      }[];
    };
  }>(token, `
    query($projectId: String!, $environmentId: String!, $serviceId: String!) {
      deploymentTriggers(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) {
        edges { node { id branch repository provider environmentId serviceId projectId checkSuites } }
      }
    }
  `, { projectId, environmentId, serviceId });
  return data.deploymentTriggers.edges.map((e) => e.node);
}

export async function createDeploymentTrigger(
  token: string,
  input: {
    projectId: string;
    environmentId: string;
    serviceId: string;
    provider: string;
    repository: string;
    branch: string;
    checkSuites?: boolean;
  }
) {
  const data = await gql<{
    deploymentTriggerCreate: { id: string; branch: string; repository: string };
  }>(token, `
    mutation($input: DeploymentTriggerCreateInput!) {
      deploymentTriggerCreate(input: $input) { id branch repository provider environmentId serviceId }
    }
  `, { input });
  return data.deploymentTriggerCreate;
}

export async function deleteDeploymentTrigger(token: string, id: string) {
  await gql(token, `mutation($id: String!) { deploymentTriggerDelete(id: $id) }`, { id });
}

export async function updateDeploymentTrigger(
  token: string,
  id: string,
  input: { branch?: string; checkSuites?: boolean }
) {
  const data = await gql<{ deploymentTriggerUpdate: { id: string; branch: string } }>(token, `
    mutation($id: String!, $input: DeploymentTriggerUpdateInput!) {
      deploymentTriggerUpdate(id: $id, input: $input) { id branch repository }
    }
  `, { id, input });
  return data.deploymentTriggerUpdate;
}

// ─── Variables ───────────────────────────────────────────────────────────────

export async function getVariables(
  token: string,
  projectId: string,
  environmentId: string,
  serviceId?: string
) {
  const data = await gql<{ variables: Record<string, string> | null }>(token, `
    query($projectId: String!, $environmentId: String!, $serviceId: String) {
      variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
    }
  `, { projectId, environmentId, serviceId });
  return data.variables ?? {};
}

export async function upsertVariable(
  token: string,
  projectId: string,
  environmentId: string,
  serviceId: string,
  name: string,
  value: string
) {
  await gql(token, `
    mutation($input: VariableUpsertInput!) { variableUpsert(input: $input) }
  `, { input: { projectId, environmentId, serviceId, name, value } });
}

export async function bulkUpsertVariables(
  token: string,
  projectId: string,
  environmentId: string,
  serviceId: string,
  variables: Record<string, string>
) {
  await gql(token, `
    mutation($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }
  `, { input: { projectId, environmentId, serviceId, variables } });
}

export async function deleteVariable(
  token: string,
  projectId: string,
  environmentId: string,
  serviceId: string,
  name: string
) {
  await gql(token, `
    mutation($input: VariableDeleteInput!) { variableDelete(input: $input) }
  `, { input: { projectId, environmentId, serviceId, name } });
}

// ─── Domains ─────────────────────────────────────────────────────────────────

export async function listDomains(token: string, projectId: string, environmentId: string, serviceId: string) {
  const data = await gql<{
    domains: {
      serviceDomains: { id: string; domain: string; environmentId: string; serviceId: string; targetPort: number | null }[];
      customDomains: { id: string; domain: string; environmentId: string; serviceId: string; targetPort: number | null }[];
    };
  }>(token, `
    query($projectId: String!, $environmentId: String!, $serviceId: String!) {
      domains(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) {
        serviceDomains { id domain environmentId serviceId targetPort }
        customDomains { id domain environmentId serviceId targetPort }
      }
    }
  `, { projectId, environmentId, serviceId });
  return data.domains;
}

export async function checkCustomDomainAvailable(token: string, domain: string) {
  const data = await gql<{ customDomainAvailable: { available: boolean; message: string } }>(token, `
    query($domain: String!) { customDomainAvailable(domain: $domain) { available message } }
  `, { domain });
  return data.customDomainAvailable;
}

export async function getDomainStatus(token: string, id: string, projectId: string) {
  const data = await gql<{
    domainStatus: { cdnProvider: string; certificateStatus: string };
  }>(token, `
    query($id: String!, $projectId: String!) {
      domainStatus(id: $id, projectId: $projectId) { cdnProvider certificateStatus }
    }
  `, { id, projectId });
  return data.domainStatus;
}

export async function generateDomain(token: string, environmentId: string, serviceId: string) {
  const data = await gql<{ serviceDomainCreate: { domain: string; id: string } }>(token, `
    mutation($input: ServiceDomainCreateInput!) {
      serviceDomainCreate(input: $input) { domain id environmentId serviceId }
    }
  `, { input: { environmentId, serviceId } });
  return data.serviceDomainCreate;
}

export async function deleteServiceDomain(token: string, id: string) {
  await gql(token, `mutation($id: String!) { serviceDomainDelete(id: $id) }`, { id });
}

export async function createCustomDomain(
  token: string,
  projectId: string,
  environmentId: string,
  serviceId: string,
  domain: string,
  targetPort?: number
) {
  const data = await gql<{
    customDomainCreate: { id: string; domain: string; environmentId: string; serviceId: string };
  }>(token, `
    mutation($input: CustomDomainCreateInput!) {
      customDomainCreate(input: $input) { id domain environmentId serviceId }
    }
  `, { input: { projectId, environmentId, serviceId, domain, targetPort } });
  return data.customDomainCreate;
}

export async function deleteCustomDomain(token: string, id: string) {
  await gql(token, `mutation($id: String!) { customDomainDelete(id: $id) }`, { id });
}

export async function updateCustomDomain(token: string, id: string, environmentId: string, targetPort?: number) {
  await gql(token, `
    mutation($id: String!, $environmentId: String!, $targetPort: Int) {
      customDomainUpdate(id: $id, environmentId: $environmentId, targetPort: $targetPort)
    }
  `, { id, environmentId, targetPort });
}

// ─── TCP Proxies ─────────────────────────────────────────────────────────────

export async function listTcpProxies(token: string, environmentId: string, serviceId: string) {
  const data = await gql<{
    tcpProxies: {
      id: string; domain: string; proxyPort: number; applicationPort: number;
      environmentId: string; serviceId: string; createdAt: string;
    }[];
  }>(token, `
    query($environmentId: String!, $serviceId: String!) {
      tcpProxies(environmentId: $environmentId, serviceId: $serviceId) {
        id domain proxyPort applicationPort environmentId serviceId createdAt
      }
    }
  `, { environmentId, serviceId });
  return data.tcpProxies;
}

export async function createTcpProxy(
  token: string,
  environmentId: string,
  serviceId: string,
  applicationPort: number
) {
  const data = await gql<{
    tcpProxyCreate: { id: string; domain: string; proxyPort: number; applicationPort: number };
  }>(token, `
    mutation($input: TCPProxyCreateInput!) {
      tcpProxyCreate(input: $input) { id domain proxyPort applicationPort environmentId serviceId }
    }
  `, { input: { environmentId, serviceId, applicationPort } });
  return data.tcpProxyCreate;
}

export async function deleteTcpProxy(token: string, id: string) {
  await gql(token, `mutation($id: String!) { tcpProxyDelete(id: $id) }`, { id });
}

// ─── Volumes ─────────────────────────────────────────────────────────────────

export async function createVolume(
  token: string,
  projectId: string,
  serviceId: string,
  environmentId: string,
  mountPath: string,
  name?: string
) {
  const data = await gql<{ volumeCreate: { id: string; name: string; projectId: string } }>(token, `
    mutation($input: VolumeCreateInput!) {
      volumeCreate(input: $input) { id name projectId }
    }
  `, { input: { projectId, serviceId, environmentId, mountPath, name } });
  return data.volumeCreate;
}

export async function deleteVolume(token: string, volumeId: string) {
  await gql(token, `mutation($volumeId: String!) { volumeDelete(volumeId: $volumeId) }`, { volumeId });
}

export async function updateVolume(token: string, volumeId: string, name: string) {
  const data = await gql<{ volumeUpdate: { id: string; name: string } }>(token, `
    mutation($volumeId: String!, $input: VolumeUpdateInput!) {
      volumeUpdate(volumeId: $volumeId, input: $input) { id name }
    }
  `, { volumeId, input: { name } });
  return data.volumeUpdate;
}

export async function updateVolumeMount(token: string, volumeId: string, environmentId: string, mountPath: string) {
  await gql(token, `
    mutation($volumeId: String!, $environmentId: String, $input: VolumeInstanceUpdateInput!) {
      volumeInstanceUpdate(volumeId: $volumeId, environmentId: $environmentId, input: $input)
    }
  `, { volumeId, environmentId, input: { mountPath } });
}

export async function listVolumeBackups(token: string, volumeInstanceId: string) {
  const data = await gql<{
    volumeInstanceBackupList: {
      id: string; name: string; createdAt: string; expiresAt: string | null;
      usedMB: number; referencedMB: number;
    }[];
  }>(token, `
    query($volumeInstanceId: String!) {
      volumeInstanceBackupList(volumeInstanceId: $volumeInstanceId) {
        id name createdAt expiresAt usedMB referencedMB
      }
    }
  `, { volumeInstanceId });
  return data.volumeInstanceBackupList;
}

// ─── Plugins (Legacy Databases) ──────────────────────────────────────────────

export async function createPlugin(
  token: string,
  projectId: string,
  name: string,
  environmentId?: string
) {
  const data = await gql<{
    pluginCreate: { id: string; name: string; friendlyName: string; status: string };
  }>(token, `
    mutation($input: PluginCreateInput!) {
      pluginCreate(input: $input) { id name friendlyName status }
    }
  `, { input: { projectId, name, environmentId } });
  return data.pluginCreate;
}

export async function deletePlugin(token: string, id: string, environmentId?: string) {
  await gql(token, `
    mutation($id: String!, $environmentId: String) { pluginDelete(id: $id, environmentId: $environmentId) }
  `, { id, environmentId });
}

export async function restartPlugin(token: string, id: string, environmentId: string) {
  const data = await gql<{ pluginRestart: { id: string; status: string } }>(token, `
    mutation($id: String!, $input: PluginRestartInput!) {
      pluginRestart(id: $id, input: $input) { id name status }
    }
  `, { id, input: { environmentId } });
  return data.pluginRestart;
}

// ─── GitHub ───────────────────────────────────────────────────────────────────

export async function listGithubRepos(token: string) {
  const data = await gql<{
    githubRepos: {
      id: string; name: string; fullName: string; defaultBranch: string; isPrivate: boolean;
    }[];
  }>(token, `
    query {
      githubRepos { id name fullName defaultBranch isPrivate }
    }
  `);
  return data.githubRepos;
}

export async function listGithubBranches(token: string, owner: string, repo: string) {
  const data = await gql<{ githubRepoBranches: { name: string }[] }>(token, `
    query($owner: String!, $repo: String!) {
      githubRepoBranches(owner: $owner, repo: $repo) { name }
    }
  `, { owner, repo });
  return data.githubRepoBranches.map((b) => b.name);
}

// ─── Regions ─────────────────────────────────────────────────────────────────

export async function listRegions(token: string, projectId?: string) {
  const data = await gql<{
    regions: { region: string; name: string; location: string; country: string; railwayMetal: boolean }[];
  }>(token, `
    query($projectId: String) {
      regions(projectId: $projectId) { region name location country railwayMetal }
    }
  `, { projectId });
  return data.regions;
}

// ─── Webhooks ────────────────────────────────────────────────────────────────

export async function listWebhooks(token: string, projectId: string) {
  const data = await gql<{
    webhooks: {
      edges: { node: { id: string; url: string; projectId: string; lastStatus: number | null; filters: string[] } }[];
    };
  }>(token, `
    query($projectId: String!) {
      webhooks(projectId: $projectId) {
        edges { node { id url projectId lastStatus filters } }
      }
    }
  `, { projectId });
  return data.webhooks.edges.map((e) => e.node);
}

export async function createWebhook(
  token: string,
  projectId: string,
  url: string,
  secret?: string,
  filters?: string[]
) {
  const data = await gql<{ webhookCreate: { id: string; url: string; projectId: string } }>(token, `
    mutation($input: WebhookCreateInput!) {
      webhookCreate(input: $input) { id url projectId filters lastStatus }
    }
  `, { input: { projectId, url, secret, filters } });
  return data.webhookCreate;
}

export async function deleteWebhook(token: string, id: string) {
  await gql(token, `mutation($id: String!) { webhookDelete(id: $id) }`, { id });
}

// ─── Private Networks ────────────────────────────────────────────────────────

export async function listPrivateNetworks(token: string, environmentId: string) {
  const data = await gql<{
    privateNetworks: {
      networkId: string; name: string; dnsName: string; environmentId: string; projectId: string;
    }[];
  }>(token, `
    query($environmentId: String!) {
      privateNetworks(environmentId: $environmentId) { networkId name dnsName environmentId projectId }
    }
  `, { environmentId });
  return data.privateNetworks;
}

export async function createPrivateNetwork(
  token: string,
  projectId: string,
  environmentId: string,
  name: string
) {
  const data = await gql<{
    privateNetworkCreateOrGet: {
      networkId: string; name: string; dnsName: string; environmentId: string;
    };
  }>(token, `
    mutation($input: PrivateNetworkCreateOrGetInput!) {
      privateNetworkCreateOrGet(input: $input) { networkId name dnsName environmentId projectId }
    }
  `, { input: { projectId, environmentId, name } });
  return data.privateNetworkCreateOrGet;
}

export async function createPrivateNetworkEndpoint(
  token: string,
  privateNetworkId: string,
  serviceInstanceId: string,
  environmentId: string
) {
  const data = await gql<{
    privateNetworkEndpointCreateOrGet: { dnsName: string; serviceInstanceId: string };
  }>(token, `
    mutation($input: PrivateNetworkEndpointCreateOrGetInput!) {
      privateNetworkEndpointCreateOrGet(input: $input) { dnsName serviceInstanceId privateIps }
    }
  `, { input: { privateNetworkId, serviceInstanceId, environmentId } });
  return data.privateNetworkEndpointCreateOrGet;
}

export async function deletePrivateNetworkEndpoint(token: string, id: string) {
  await gql(token, `mutation($id: String!) { privateNetworkEndpointDelete(id: $id) }`, { id });
}
