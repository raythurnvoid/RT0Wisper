import { useEnterpriseIdentityStore } from "../stores/enterpriseIdentityStore";
import { usePolicyStore } from "../stores/policyStore";
import type { ActiveAccountScope } from "../types/electron";

/**
 * Hydrates the workspace policy in a window that cannot resolve its own session. The dictation window is sandboxed with
 * web security enforced, so Better Auth's cross-origin session fetch fails
 * there and the session-driven hydration in useAuth never runs. The control
 * panel validates the session and the main process persists that scope; this
 * mirrors it back over IPC, both the value at boot and every later change
 * (re-validation under a new credential generation, sign-out). With no
 * workspaces, the managed enterprise identity always stays cleared.
 */
export function mirrorActiveAccountScope(): () => void {
  let broadcastReceived = false;

  const applyScope = (next: ActiveAccountScope | null) => {
    if (!next) {
      usePolicyStore.getState().clearPolicy();
      useEnterpriseIdentityStore.getState().clear();
      return;
    }
    void usePolicyStore.getState().fetchPolicy(next.accountId, next.authGeneration);
  };

  const unsubscribe = window.electronAPI?.onActiveAccountScopeChanged?.((next) => {
    broadcastReceived = true;
    applyScope(next);
  });
  // A scope validated while the boot read was in flight has already arrived by
  // broadcast; the read's answer is the older of the two.
  void window.electronAPI?.getActiveAccountScope?.().then((next) => {
    if (!broadcastReceived) applyScope(next);
  });
  return () => unsubscribe?.();
}
