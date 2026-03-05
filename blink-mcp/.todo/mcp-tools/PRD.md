# Blink MCP Server - Product Requirements Document

## Overview
Create a Model Context Protocol (MCP) server that provides access to Blink's management APIs for AI assistants. This server will enable AI tools to interact with Blink projects, databases, and edge functions through a standardized interface.

## Target APIs
The MCP server will interface with Blink's Management API v1 endpoints:
- Base URL: `https://blink.new/api/v1/`
- Authentication: Personal Access Token (PAT) via Bearer token

## Core Tools

### 1. run_sql
**Purpose**: Execute SQL queries on project databases
- **Input**: 
  - `project_id` (string): The project identifier
  - `sql` (string): SQL query to execute
  - `args` (optional array): Positional parameters
  - `named_args` (optional object): Named parameters
- **Functionality**:
  - First checks if database exists for project
  - If no database exists, creates one automatically
  - Executes the SQL query using the management API
  - Returns query results with metadata
- **API Endpoint**: 
  - GET/POST `/projects/{projectId}/databases` (for database creation/checking)
  - POST `/projects/{projectId}/databases/sql` (for SQL execution)

### 2. list_edge_functions
**Purpose**: List all edge functions for a project
- **Input**: 
  - `project_id` (string): The project identifier
- **Functionality**:
  - Retrieves all edge functions deployed to the project
  - Returns function metadata including status, URLs, versions
- **API Endpoint**: GET `/projects/{projectId}/functions`

### 3. deploy_edge_function
**Purpose**: Deploy an edge function to a project
- **Input**:
  - `project_id` (string): The project identifier
  - `function_slug` (string): Function name/slug (kebab-case)
  - `function_code` (string): TypeScript/JavaScript code for the function
  - `name` (optional string): Display name for the function
  - `verify_jwt` (optional boolean): Whether to verify JWT tokens
  - `import_map` (optional boolean): Whether to use import map
- **Functionality**:
  - Validates function name format
  - Deploys function code to Deno Deploy
  - Creates function metadata in project
- **API Endpoint**: POST `/projects/{projectId}/functions/deploy`

### 4. get_function_logs
**Purpose**: Retrieve logs for a specific function
- **Input**:
  - `project_id` (string): The project identifier
  - `function_slug` (string): Function name/slug
  - `hours_back` (optional number): Hours to look back (default: 24)
  - `log_level` (optional string): Log level filter (all, errors, warnings, info)
  - `limit` (optional number): Maximum number of logs (default: 50)
- **Functionality**:
  - **Note**: This functionality may not be directly available through management API
  - May need to be implemented through alternative means or marked as unavailable
- **Status**: To be determined based on API availability

## Authentication
- Uses Personal Access Token (PAT) authentication
- Token should be provided via environment variable `BLINK_ACCESS_TOKEN`
- All requests include `Authorization: Bearer {token}` header

## Error Handling
- Proper error messages for authentication failures
- Handle API rate limits and network errors
- Validate input parameters before API calls
- Return structured error responses

## Configuration
- Server name: "blink-management"
- Server version: "1.0.0"
- Description: "Access Blink project management APIs for databases and edge functions"

## Technical Requirements
- Built with TypeScript and Node.js
- Uses MCP SDK (@modelcontextprotocol/sdk)
- Follows MCP server patterns and conventions
- Includes proper TypeScript types
- Comprehensive error handling
- Input validation using Zod schemas

## Publishing
- Code will be published to GitHub as open source
- Should be installable via `npx blink-mcp-server`
- Include proper README with setup instructions
- Include example configurations for Claude Desktop and other MCP clients 