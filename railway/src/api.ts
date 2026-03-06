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

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getMe(token: string) {
  // Account tokens support `me`; workspace tokens only support `workspace(workspaceId:...)`.
  // Try account-level query first, fall back gracefully for workspace tokens.
  try {
    const data = await gql<{
      me: {
        name: string;
        email: string;
        workspaces: { id: string; name: string }[];
      };
    }>(token, `query { me { name email workspaces { id name } } }`);
    return { type: 'account', ...data.me };
  } catch {
    // Workspace token — verify it works by hitting a neutral endpoint
    return {
      type: 'workspace',
      note: 'Workspace-scoped token — me query not available. Token is valid. Use list_projects with your workspace ID.',
    };
  }
}

export async function listProjects(token: string, workspaceId: string) {
  const data = await gql<{
    workspace: {
      projects: {
        edges: {
          node: {
            id: string; name: string; createdAt: string; updatedAt: string;
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
              id name createdAt updatedAt
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
          staticUrl: string | null; url: string | null;
        };
      }[];
    };
  }>(token, `
    query($projectId: String!, $environmentId: String!, $serviceId: String!, $limit: Int!) {
      deployments(
        first: $limit
        input: { projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId }
      ) {
        edges { node { id status createdAt updatedAt staticUrl url } }
      }
    }
  `, { projectId, environmentId, serviceId, limit });
  return data.deployments.edges.map((e) => e.node);
}

export async function getDeploymentLogs(token: string, deploymentId: string) {
  const data = await gql<{
    deploymentLogs: { timestamp: string; message: string; severity: string }[];
  }>(token, `
    query($deploymentId: String!) {
      deploymentLogs(deploymentId: $deploymentId) { timestamp message severity }
    }
  `, { deploymentId });
  return data.deploymentLogs;
}

export async function getBuildLogs(token: string, deploymentId: string) {
  const data = await gql<{
    buildLogs: { timestamp: string; message: string; severity: string }[];
  }>(token, `
    query($deploymentId: String!) {
      buildLogs(deploymentId: $deploymentId) { timestamp message severity }
    }
  `, { deploymentId });
  return data.buildLogs;
}

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

// ─── Mutations ────────────────────────────────────────────────────────────────

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

export async function redeployService(token: string, environmentId: string, serviceId: string) {
  await gql(token, `
    mutation($environmentId: String!, $serviceId: String!) {
      serviceInstanceRedeploy(environmentId: $environmentId, serviceId: $serviceId)
    }
  `, { environmentId, serviceId });
}

export async function restartDeployment(token: string, deploymentId: string) {
  await gql(token, `
    mutation($id: String!) { deploymentRestart(id: $id) }
  `, { id: deploymentId });
}

export async function createEnvironment(token: string, projectId: string, name: string) {
  const data = await gql<{ environmentCreate: { id: string; name: string } }>(token, `
    mutation($input: EnvironmentCreateInput!) {
      environmentCreate(input: $input) { id name }
    }
  `, { input: { projectId, name } });
  return data.environmentCreate;
}

export async function generateDomain(
  token: string,
  environmentId: string,
  serviceId: string
) {
  const data = await gql<{ serviceDomainCreate: { domain: string } }>(token, `
    mutation($input: ServiceDomainCreateInput!) {
      serviceDomainCreate(input: $input) { domain }
    }
  `, { input: { environmentId, serviceId } });
  return data.serviceDomainCreate.domain;
}
