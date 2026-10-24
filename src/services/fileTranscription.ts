import { withSessionRefresh } from "../lib/auth";
import {
  resolveTranscriptionRoute,
  type ManagedTranscriptionResolution,
  type TranscriptionRoute,
} from "../helpers/transcriptionRoute";
import {
  getManagedTranscriptionResolution,
  isManagedTranscriptionActive,
} from "./managedTranscription";
import { getTranscriptionProviders } from "../models/ModelRegistry";

export interface FileTranscriptionResult {
  success: boolean;
  text?: string;
  error?: string;
  code?: string;
  messageKey?: string;
  diarized?: boolean;
  // The transcript succeeded, but requested speaker labels could not be applied.
  diarizationWarning?: boolean;
  warning?: string;
  // Set alongside `warning` by the chunked cloud path: how much audio was lost.
  failedChunks?: number;
  totalChunks?: number;
  // Segment-level timing from BYOK providers that support it (opts.timestamps
  // or BYOK diarization). Absent whenever the provider returned text only.
  segments?: Array<{ text: string; start: number; end: number; speaker?: string }>;
}

export interface FileTranscriptionConfig {
  isOpenWhisprCloud: boolean;
  getApiKey: () => string;
  cloudTranscriptionProvider: string;
  cloudTranscriptionBaseUrl: string;
  cloudTranscriptionModel: string;
  language: string;
  cortiEnvironment?: string;
  cortiTenant?: string;
  transcriptionMode?: string;
  remoteTranscriptionUrl?: string;
  remoteTranscriptionModel?: string;
}

export interface TranscriptionApiKeys {
  openaiApiKey: string;
  groqApiKey: string;
  xaiApiKey: string;
  mistralApiKey: string;
  geminiApiKey: string;
  tinfoilApiKey: string;
  deepgramApiKey: string;
  assemblyaiApiKey: string;
  customTranscriptionApiKey?: string;
}

export function getTranscriptionApiKey(provider: string, keys: TranscriptionApiKeys): string {
  switch (provider) {
    case "openai":
      return keys.openaiApiKey;
    case "groq":
      return keys.groqApiKey;
    case "xai":
      return keys.xaiApiKey;
    case "mistral":
      return keys.mistralApiKey;
    case "gemini":
      return keys.geminiApiKey;
    case "tinfoil":
      return keys.tinfoilApiKey;
    case "deepgram":
      return keys.deepgramApiKey;
    case "assemblyai":
      return keys.assemblyaiApiKey;
    case "custom":
      return keys.customTranscriptionApiKey || "";
    default:
      return "";
  }
}

// Pre-flight through the shared resolver: code-carrying errors (incl. the
// Tinfoil-URL and fail-closed custom guards) surface here without an IPC
// round-trip; the main-process handler re-resolves the same fields as
// defense in depth.
export function resolveFileTranscriptionRoute(
  cfg: FileTranscriptionConfig,
  managed: ManagedTranscriptionResolution | null = null
): TranscriptionRoute {
  return resolveTranscriptionRoute({
    settings: {
      transcriptionMode: cfg.transcriptionMode,
      remoteTranscriptionUrl: cfg.remoteTranscriptionUrl,
      remoteTranscriptionModel: cfg.remoteTranscriptionModel,
      cloudTranscriptionProvider: cfg.cloudTranscriptionProvider,
      cloudTranscriptionModel: cfg.cloudTranscriptionModel,
      cloudTranscriptionBaseUrl: cfg.cloudTranscriptionBaseUrl,
      cortiEnvironment: cfg.cortiEnvironment,
      cortiTenant: cfg.cortiTenant,
    },
    providers: getTranscriptionProviders(),
    managed,
    request: { effectiveLanguage: cfg.language || undefined },
  });
}

// Single provider dispatch shared by the single-file flow and the batch queue,
// so BYOK providers receive identical options in both.
export async function transcribeFile(
  filePath: string,
  cfg: FileTranscriptionConfig,
  diarize: boolean,
  opts: { requestId?: string; timestamps?: boolean } = {}
): Promise<FileTranscriptionResult> {
  // Managed enterprise STT outranks every personal lane, OpenWhispr Cloud and
  // local included: under managed_required no audio may leave the tenant.
  const managed = getManagedTranscriptionResolution();
  if (managed?.kind === "error") {
    return {
      success: false,
      error: managed.message,
      code: managed.code,
      messageKey: managed.messageKey,
    };
  }

  if (!managed && cfg.isOpenWhisprCloud) {
    return withSessionRefresh(async () => {
      const r = await window.electronAPI.transcribeAudioFileCloud!(filePath, opts);
      if (!r.success && r.code) {
        throw Object.assign(new Error(r.error || "Cloud transcription failed"), {
          code: r.code,
        });
      }
      return r;
    });
  }

  const route = resolveFileTranscriptionRoute(cfg, managed);
  if (route.transport === "error") {
    return {
      success: false,
      error: route.message,
      code: route.code,
      messageKey: route.messageKey,
    };
  }

  // Self-hosted fields make the handler route to the configured server
  // (fail-closed on misconfiguration) instead of stale BYOK settings.
  return window.electronAPI.transcribeAudioFileByok!({
    filePath,
    managed: managed?.kind === "managed" ? managed : undefined,
    apiKey: cfg.getApiKey(),
    baseUrl: cfg.cloudTranscriptionBaseUrl,
    model: cfg.cloudTranscriptionModel,
    diarize: diarize || undefined,
    timestamps: opts.timestamps || undefined,
    provider: cfg.cloudTranscriptionProvider,
    language: cfg.language,
    environment: cfg.cortiEnvironment,
    tenant: cfg.cortiTenant,
    transcriptionMode: cfg.transcriptionMode,
    remoteTranscriptionUrl: cfg.remoteTranscriptionUrl,
    remoteTranscriptionModel: cfg.remoteTranscriptionModel,
  });
}
