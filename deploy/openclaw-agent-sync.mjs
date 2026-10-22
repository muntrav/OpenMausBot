#!/usr/bin/env node
/**
 * Keep OpenMausBot's ACP engine roster aligned with OpenClaw's configured
 * agents. Adding an agent to OpenClaw and restarting openmausbot is enough.
 */
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const OPENCLAW_CONFIG = process.env.OPENCLAW_CONFIG_PATH || "/opt/openclaw/config/openclaw.json";
const OPENCLAW_BIN = process.env.OPENCLAW_BIN || "/opt/openclaw/npm-global/bin/openclaw";
const OPENCLAW_WRAPPER = process.env.OPENCLAW_WRAPPER || "/opt/openclaw/workspace/OpenMausBot/deploy/openclaw-acp-agent";
const OPENCLAW_HOME = process.env.OPENCLAW_HOME || "/opt/openclaw/home";
const OPENCLAW_STATE = process.env.OPENCLAW_STATE_DIR || "/opt/openclaw/state";
const OPENCLAW_WORKSPACE = process.env.OPENCLAW_WORKSPACE_DIR || "/opt/openclaw/workspace";
const OMB_DATA_DIR = process.env.OMB_DATA_DIR || "/opt/openclaw/state/openmausbot";
const OMB_CONFIG = join(OMB_DATA_DIR, "config.json");
const MANIFEST = join(OMB_DATA_DIR, "openclaw-agents.json");
const MARKER_PREFIX = "OpenClaw agent id: ";

function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}
function atomicJson(path, value, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = path + ".tmp." + process.pid;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { mode });
  chmodSync(tmp, mode);
  renameSync(tmp, path);
}
function identityFor(entry, id) {
  const candidates = [
    entry.workspace && join(entry.workspace, "IDENTITY.md"),
    join(OPENCLAW_WORKSPACE, "IDENTITY.md"),
  ].filter(Boolean);
  for (const path of candidates) {
    try {
      const text = readFileSync(path, "utf8");
      const name = /^-\s*(?:\*\*)?Name:\s*(.+)$/mi.exec(text)?.[1]?.trim().replace(/^\*\*\s*|\s*\*\*$/g, "");
      const emoji = /^-\s*(?:\*\*)?Emoji:\s*(.+)$/mi.exec(text)?.[1]?.trim().replace(/^\*\*\s*|\s*\*\*$/g, "");
      if (name || emoji) return { name: name || entry.name || id, emoji: emoji || "" };
    } catch {}
  }
  return { name: entry.name || id, emoji: "" };
}
function safeId(id) {
  return String(id).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "agent";
}
function agentRoster() {
  const root = readJson(OPENCLAW_CONFIG, {});
  const entries = root?.agents?.entries;
  if (!entries || typeof entries !== "object") throw new Error("OpenClaw agents.entries is missing");
  return Object.entries(entries).map(([id, raw]) => {
    const entry = raw && typeof raw === "object" ? raw : {};
    const identity = identityFor(entry, id);
    const instanceId = "openclaw-" + safeId(id);
    return {
      id,
      instanceId,
      name: identity.name,
      emoji: identity.emoji,
      workspace: typeof entry.workspace === "string" ? entry.workspace : OPENCLAW_WORKSPACE,
      sessionKey: "agent:" + id + ":openmausbot",
      cli: OPENCLAW_WRAPPER,
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
}
function applyConfig(roster) {
  const current = readJson(OMB_CONFIG, {});
  const instances = current.instances && typeof current.instances === "object" ? { ...current.instances } : {};
  for (const agent of roster) {
    const prior = instances[agent.instanceId] && typeof instances[agent.instanceId] === "object" ? instances[agent.instanceId] : {};
    instances[agent.instanceId] = {
      ...prior,
      driver: "customAcp",
      displayName: agent.emoji ? agent.name + " " + agent.emoji + " · OpenClaw" : agent.name + " · OpenClaw",
      environment: {
        ...(prior.environment && typeof prior.environment === "object" ? prior.environment : {}),
        OPENCLAW_CONFIG_PATH: OPENCLAW_CONFIG,
        OPENCLAW_HOME,
        OPENCLAW_STATE_DIR: OPENCLAW_STATE,
        OPENCLAW_WORKSPACE_DIR: OPENCLAW_WORKSPACE,
        OPENCLAW_HIDE_BANNER: "1",
        OPENCLAW_SUPPRESS_NOTES: "1",
        OPENMAUS_OPENCLAW_SESSION: agent.sessionKey,
        OPENMAUS_OPENCLAW_SESSION_PREFIX: "agent:" + agent.id + ":openmausbot",
      },
      config: {
        ...(prior.config && typeof prior.config === "object" ? prior.config : {}),
        cli: agent.cli,
        workspace: agent.workspace,
      },
    };
  }
  const next = { ...current, instances };
  const preferredDefault = roster.find((agent) => agent.id === "main") || roster[0];
  if (!next.defaultModelSelection && preferredDefault) {
    next.defaultModelSelection = { instanceId: preferredDefault.instanceId, model: "agent-default" };
  }
  atomicJson(OMB_CONFIG, next);
  atomicJson(MANIFEST, { generatedAt: new Date().toISOString(), agents: roster });
}
async function requestJson(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { "content-type": "application/json", ...(options.headers || {}) } });
  const text = await response.text();
  let body = null; try { body = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) throw new Error((options.method || "GET") + " " + url + " returned " + response.status + ": " + (body?.error || text.slice(0, 200)));
  return body;
}
async function syncBots(roster) {
  const port = Number(process.env.OMB_PORT || 8799);
  const base = "http://127.0.0.1:" + port;
  let existing;
  let lastError;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      existing = await requestJson(base + "/api/bots?messages=0");
      break;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  if (!existing) throw lastError || new Error("OpenMausBot API did not become ready");
  const bots = Array.isArray(existing?.bots) ? existing.bots : [];
  const results = [];
  for (const agent of roster) {
    const marker = MARKER_PREFIX + agent.id;
    let bot = bots.find((candidate) => typeof candidate.description === "string" && candidate.description.includes(marker));
    const body = {
      name: agent.emoji ? agent.name + " " + agent.emoji : agent.name,
      title: "OpenClaw agent · " + agent.id,
      description: marker + "\nBacked by OpenClaw ACP instance " + agent.instanceId + ".",
      modelSelection: { instanceId: agent.instanceId, model: "agent-default" },
      requireAvailableModel: true,
    };
    if (!bot) {
      const created = await requestJson(base + "/api/bots", { method: "POST", body: JSON.stringify(body) });
      bot = created?.bot;
      results.push({ agent: agent.id, action: "created", botId: bot?.id || null });
    } else {
      const current = bot.modelSelection || {};
      if (current.instanceId !== agent.instanceId || current.model !== "agent-default") {
        await requestJson(base + "/api/bots/" + bot.id + "/model", {
          method: "PATCH",
          body: JSON.stringify({ instanceId: agent.instanceId, model: "agent-default" }),
        });
        results.push({ agent: agent.id, action: "rebound", botId: bot.id });
      } else {
        results.push({ agent: agent.id, action: "unchanged", botId: bot.id });
      }
    }
  }
  console.log(JSON.stringify({ ok: true, agents: roster.length, bots: results }, null, 2));
}
const roster = agentRoster();
if (process.argv.includes("--apply")) applyConfig(roster);
if (process.argv.includes("--sync-bots")) await syncBots(roster);
if (!process.argv.includes("--apply") && !process.argv.includes("--sync-bots")) console.log(JSON.stringify({ agents: roster }, null, 2));
