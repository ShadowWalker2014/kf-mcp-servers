# Prompts & Resources Reference

## Prompts

Prompts are reusable message templates. Clients call `prompts/list` to discover them and `prompts/get` to invoke. Register with `server.registerPrompt(name, metadata, handler)`.

### Basic prompt with typed args

```typescript
import { z } from 'zod';

server.registerPrompt(
  'summarize',
  {
    title: 'Summarize Text',
    description: 'Ask the model to summarize text in a chosen style',
    argsSchema: {
      text: z.string().describe('The text to summarize'),
      style: z.enum(['bullet', 'paragraph']).describe('Output format').optional(),
    },
  },
  ({ text, style = 'paragraph' }) => ({
    messages: [
      {
        role: 'user',
        content: { type: 'text', text: `Summarize the following in ${style} form:\n\n${text}` },
      },
    ],
  })
);
```

**Key rules:**
- `argsSchema` is a plain object of Zod fields — **not** `z.object({...})`.
- Handler receives the resolved args and returns `{ messages: [...] }`.
- `role` must be `'user'` or `'assistant'`.
- Content `type` can be `'text'`, `'image'` (base64), or `'resource'` (embedded resource URI).

### Multi-turn prompt

```typescript
server.registerPrompt(
  'code-review',
  {
    title: 'Code Review',
    description: 'Review code with context from prior discussion',
    argsSchema: { code: z.string(), language: z.string() },
  },
  ({ code, language }) => ({
    messages: [
      { role: 'user', content: { type: 'text', text: `Review this ${language} code for bugs and style:` } },
      { role: 'user', content: { type: 'text', text: `\`\`\`${language}\n${code}\n\`\`\`` } },
    ],
  })
);
```

### Prompt with autocomplete

```typescript
import { completable } from '@modelcontextprotocol/sdk/server/completable.js';

server.registerPrompt(
  'greet',
  {
    title: 'Greeting',
    argsSchema: {
      name: completable(z.string(), (value) => {
        const names = ['Alice', 'Bob', 'Charlie'];
        return names.filter(n => n.toLowerCase().startsWith(value.toLowerCase()));
      }),
    },
  },
  ({ name }) => ({
    messages: [{ role: 'user', content: { type: 'text', text: `Hello, ${name}!` } }],
  })
);
```

### Notify clients when prompt list changes

```typescript
server.sendPromptListChanged();
```

Call this after dynamically adding or removing prompts at runtime.

---

## Resources

Resources expose read-only data by URI. Clients call `resources/list` to discover and `resources/read` to fetch. Register with `server.registerResource(name, uri, metadata, handler)`.

### Static resource (fixed URI)

```typescript
server.registerResource(
  'api-overview',
  'docs://api/overview',
  {
    title: 'API Overview',
    description: 'High-level description of available endpoints',
    mimeType: 'text/markdown',
  },
  async (uri) => ({
    contents: [{ uri: uri.href, text: '# My API\n\n## Endpoints\n...' }],
  })
);
```

### Dynamic resource (URI template with parameters)

```typescript
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

server.registerResource(
  'table-schema',
  new ResourceTemplate('db://tables/{tableName}/schema', { list: undefined }),
  { title: 'Table Schema', mimeType: 'application/json' },
  async (uri, { tableName }) => {
    const schema = await fetchTableSchema(credential, tableName as string);
    return { contents: [{ uri: uri.href, text: JSON.stringify(schema, null, 2) }] };
  }
);
```

URI template variables (e.g., `{tableName}`) are extracted and passed as the second argument to the handler.

`{ list: undefined }` means no listing — the resource can only be read by URI. To support listing, provide a `list` function that returns `{ resources: [...] }`.

### Listing dynamic resources

```typescript
server.registerResource(
  'user-profile',
  new ResourceTemplate('users://{userId}/profile', {
    list: async () => ({
      resources: (await listAllUsers()).map(u => ({
        uri: `users://${u.id}/profile`,
        name: u.name,
        mimeType: 'application/json',
      })),
    }),
  }),
  { title: 'User Profile', mimeType: 'application/json' },
  async (uri, { userId }) => ({
    contents: [{ uri: uri.href, text: JSON.stringify(await getUser(userId as string)) }],
  })
);
```

### Binary resource

```typescript
server.registerResource(
  'logo',
  'assets://logo.png',
  { title: 'Logo', mimeType: 'image/png' },
  async (uri) => ({
    contents: [{ uri: uri.href, blob: await readFileAsBase64('./logo.png') }],
  })
);
```

Use `blob: <base64 string>` instead of `text` for binary content.

### Notify clients when resource list changes

```typescript
server.sendResourceListChanged();
```

### Resource change subscription (push updates)

```typescript
import { SubscribeRequestSchema, UnsubscribeRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const subscriptions = new Set<string>();

server.server.setRequestHandler(SubscribeRequestSchema, async (req) => {
  subscriptions.add(req.params.uri);
  return {};
});
server.server.setRequestHandler(UnsubscribeRequestSchema, async (req) => {
  subscriptions.delete(req.params.uri);
  return {};
});

// When the resource content changes:
if (subscriptions.has(resourceUri)) {
  await server.server.sendResourceUpdated({ uri: resourceUri });
}
```

---

## Capability advertisement

Capabilities are **zero-config** — calling any register method automatically sets the corresponding capability in the MCP handshake:

| You call | Capability advertised |
|---|---|
| `server.tool()` | `{ tools: { listChanged: true } }` |
| `server.registerPrompt()` | `{ prompts: { listChanged: true } }` |
| `server.registerResource()` | `{ resources: { listChanged: true, subscribe: true } }` |

The only capability you must declare manually is `logging`:
```typescript
const server = new McpServer(
  { name: 'my-server', version: '1.0.0' },
  { capabilities: { logging: {} } }
);
```
