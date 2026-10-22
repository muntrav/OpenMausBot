# OpenClaw integration

OpenMausBot is deployed as the private Tailscale workspace at:

- https://vmi3445710.tail6d938a.ts.net:8443
- local upstream: 127.0.0.1:8799
- service: openmausbot.service

## Architecture

OpenMausBot uses its generic customAcp driver and one shared launcher:
deploy/openclaw-acp-agent. The launcher starts OpenClaw's native ACP bridge
with an agent-scoped, task-scoped Gateway session key. OpenClaw remains the
runtime and security boundary; its tools are configured on the Gateway/agent,
not through unsupported per-session MCP declarations.

## Adding an agent

No adapter code is needed:

1. Add the agent to OpenClaw's normal agents.entries configuration and give its
   workspace an IDENTITY.md when it should have a custom name and emoji.
2. Restart OpenMausBot: sudo systemctl restart openmausbot.service

The service pre-start sync reads the roster, preserves unrelated OpenMausBot
configuration, creates or updates the matching engine instance, and creates the
matching bot profile. It is safe to run repeatedly. The generated non-secret
manifest is /opt/openclaw/state/openmausbot/openclaw-agents.json.

## Verification

- systemctl status openmausbot.service
- curl http://127.0.0.1:8799/api/instances
- sudo tailscale serve status

The Gateway remains loopback-bound. OpenMausBot is the only new Tailscale
route, on HTTPS port 8443; the service does not modify the Gateway's route.
