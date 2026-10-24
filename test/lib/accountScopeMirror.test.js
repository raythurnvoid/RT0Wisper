const test = require("node:test");
const assert = require("node:assert/strict");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

// The dictation window cannot resolve a session (sandboxed, web security
// enforced), so its workspace policy is hydrated from the main process's
// validated account scope instead.
const policy = {
  version: 1,
  transcription: {
    allowedModes: ["byok"],
    allowedByokProviders: [],
    allowedEnterpriseProviders: [],
  },
  llm: { allowedModes: ["openwhispr"], allowedByokProviders: [], allowedEnterpriseProviders: [] },
  features: { agentEnabled: true, webSearchEnabled: false },
  sharing: { externalLinkSharing: "disabled" },
  dataRetention: {
    audioRetentionMaxDays: null,
    localHistoryMode: "user_choice",
    cloudBackupAllowed: false,
  },
  minAppVersion: null,
};

async function waitFor(check, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`timed out waiting for ${label}`);
}

async function boot(t, { scope = null, readScope } = {}) {
  // Registered before installBrowserGlobals so the mirror detaches while `window` still exists.
  let stop = () => {};
  t.after(() => stop());
  const calls = { policy: [] };
  let onScopeChanged = null;
  const electronAPI = {
    getAppVersion: async () => ({ version: "1.10.0" }),
    getActiveAccountScope: readScope ?? (async () => scope),
    onActiveAccountScopeChanged: (callback) => {
      onScopeChanged = callback;
      return () => {
        onScopeChanged = null;
      };
    },
    getWorkspacePolicy: async (accountId, authGeneration) => {
      calls.policy.push([accountId, authGeneration]);
      return {
        success: true,
        revision: calls.policy.length,
        accountId,
        authGeneration,
        managed: true,
        policy,
      };
    },
    clearManagedEnterpriseIdentity: async () => {},
  };
  installBrowserGlobals(t, { window: { electronAPI } });
  const vite = await createRendererServer(t, { cachePrefix: "openwhispr-account-scope-mirror-" });
  const { mirrorActiveAccountScope } = await vite.ssrLoadModule("/lib/accountScopeMirror.ts");
  stop = mirrorActiveAccountScope();
  return {
    calls,
    stop,
    broadcast: (next) => onScopeChanged?.(next),
    listeningForBroadcasts: () => onScopeChanged !== null,
  };
}

test("a window without a session fetches the policy for the main process scope", async (t) => {
  const { calls } = await boot(t, { scope: { accountId: "account-a", authGeneration: 1 } });
  await waitFor(() => calls.policy.length > 0, "policy fetch");
  assert.deepEqual(calls.policy, [["account-a", 1]]);
});

test("a broadcast that lands while the boot read is in flight is not overwritten by it", async (t) => {
  let resolveRead;
  const { calls, broadcast } = await boot(t, {
    readScope: () => new Promise((resolve) => (resolveRead = resolve)),
  });
  broadcast({ accountId: "account-a", authGeneration: 2 });
  await waitFor(() => calls.policy.length > 0, "policy fetch");
  resolveRead({ accountId: "account-a", authGeneration: 1 });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(calls.policy, [["account-a", 2]]);
});

test("stopping the mirror detaches the broadcast listener", async (t) => {
  const { stop, listeningForBroadcasts } = await boot(t);
  assert.equal(listeningForBroadcasts(), true);
  stop();
  assert.equal(listeningForBroadcasts(), false);
});
