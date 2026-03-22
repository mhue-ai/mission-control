---
name: mission-control-infra
description: Query Mission Control's infrastructure registry to discover available systems, check access permissions, and securely check out credentials for task execution. Use when you need to know what servers, databases, APIs, or services are available in the operating environment, what access level you have, or when you need credentials to interact with a system.
---

# Mission Control Infrastructure Skill

You have access to Mission Control's infrastructure registry — a central inventory of all systems, services, and resources in your operating environment. Use this skill whenever a task requires you to:

- Discover what systems are available (servers, databases, APIs, etc.)
- Check your access level before attempting to interact with a system
- Obtain credentials to authenticate with a system

## API Endpoint

The Mission Control API is at: `{MC_API_URL}`
Authenticate with: `Authorization: Bearer {MC_AGENT_TOKEN}`

## Available Operations

### 1. List your accessible infrastructure

```bash
curl -s -H "Authorization: Bearer $MC_AGENT_TOKEN" \
  "$MC_API_URL/api/infra/agent-view?agentId=$AGENT_ID&gatewayId=$GATEWAY_ID"
```

Returns all components you can access, with your access level for each:

```json
[
  {
    "id": "db-prod-01",
    "type": "database",
    "name": "Production PostgreSQL",
    "host": "db.internal.example.com",
    "port": 5432,
    "accessLevel": "read",
    "credentials": [
      { "id": "cred-pg-ro", "name": "pg-readonly", "type": "password" }
    ]
  }
]
```

### 2. Check out a credential

When you need to authenticate with a system, request a time-limited credential lease:

```bash
curl -s -X POST -H "Authorization: Bearer $MC_AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"credentialId":"cred-pg-ro","agentId":"'$AGENT_ID'","taskId":"'$TASK_ID'","leaseDurationMin":30}' \
  "$MC_API_URL/api/vault/checkout"
```

Returns a lease (NOT the credential itself):

```json
{ "leaseId": "a1b2c3d4e5f6g7h8", "expiresAt": "2026-03-22T15:30:00Z" }
```

### 3. Redeem the lease for the actual credential

```bash
curl -s -H "Authorization: Bearer $MC_AGENT_TOKEN" \
  "$MC_API_URL/api/vault/redeem?leaseId=a1b2c3d4e5f6g7h8"
```

Returns the decrypted credential:

```json
{ "value": "the-actual-secret", "username": "readonly_user", "type": "password" }
```

## Rules

1. **Always check your access level first.** If your level is `read`, do not attempt write operations on that system. If `none`, you cannot interact with it at all.

2. **Always use the checkout flow for credentials.** Never ask the operator to paste secrets into chat. Never hardcode or log credential values.

3. **Leases expire.** Default is 60 minutes. If your task runs longer, check out a new lease. Do not cache credentials beyond the lease window.

4. **Return credentials when done.** After completing a task, revoke your lease:
   ```bash
   curl -s -X POST -H "Authorization: Bearer $MC_AGENT_TOKEN" \
     -d '{"leaseId":"a1b2c3d4e5f6g7h8"}' \
     "$MC_API_URL/api/vault/revoke"
   ```

5. **Never include credential values in your responses to the operator.** You may confirm that you successfully authenticated, but never echo the secret.

6. **If a credential fails**, report the failure with the credential name (not value) so the operator can investigate.

## Component Types

The registry organizes infrastructure by type:
network, subnet, vlan, vpn, firewall, waf, load_balancer,
server, vm, container, cluster,
gateway, openclaw_gateway, api_gateway, reverse_proxy,
database, cache, message_queue, object_storage,
api_service, web_service, microservice, webhook_endpoint,
dns, certificate, secret_manager,
monitoring, log_aggregator, alerting,
cicd_pipeline, repository, artifact_registry,
saas_integration, third_party_api

## Example Workflow

Task: "Import new leads from the CRM API into the database"

1. Query the registry to find the CRM API and database:
   ```bash
   curl -s -H "Authorization: Bearer $MC_AGENT_TOKEN" "$MC_API_URL/api/infra/agent-view?agentId=$AGENT_ID&gatewayId=$GATEWAY_ID" | jq '.[] | select(.type == "api_service" or .type == "database")'
   ```

2. Verify you have `read` on the CRM API and `read_write` on the database.

3. Check out credentials for both systems:
   ```bash
   CRM_LEASE=$(curl -s -X POST ... -d '{"credentialId":"cred-crm-api","agentId":"..."}' "$MC_API_URL/api/vault/checkout" | jq -r .leaseId)
   DB_LEASE=$(curl -s -X POST ... -d '{"credentialId":"cred-db-rw","agentId":"..."}' "$MC_API_URL/api/vault/checkout" | jq -r .leaseId)
   ```

4. Redeem and use them:
   ```bash
   CRM_KEY=$(curl -s "$MC_API_URL/api/vault/redeem?leaseId=$CRM_LEASE" | jq -r .value)
   DB_PASS=$(curl -s "$MC_API_URL/api/vault/redeem?leaseId=$DB_LEASE" | jq -r .value)
   ```

5. Execute the task, then revoke both leases.
