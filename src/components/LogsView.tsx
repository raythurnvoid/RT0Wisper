import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, RefreshCw, Trash2 } from "./icons";
import { Button } from "./ui/button";
import { PAGE_CONTENT_WIDTH_CLASS } from "./ui/pageWidth";
import { cn } from "./lib/utils";
import { CARD_SURFACE_CLASS } from "./ui/surfaces";

type ErrorLogEntry = Awaited<ReturnType<Window["electronAPI"]["getErrorLog"]>>[number];

/** Warnings and errors from logs/errors.log, newest first. The dictation widget shows none. */
export default function LogsView() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<ErrorLogEntry[]>([]);

  const refresh = useCallback(async () => {
    setEntries(await window.electronAPI.getErrorLog());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="h-full overflow-y-auto">
      <div className={cn(PAGE_CONTENT_WIDTH_CLASS, "flex flex-col gap-3 px-6 py-5")}>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-foreground/45">{t("logsView.description")}</p>
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="sm" onClick={refresh}>
              <RefreshCw size={12} />
              {t("logsView.refresh")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => window.electronAPI.openLogsFolder()}>
              <FolderOpen size={12} />
              {t("logsView.openFolder")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={entries.length === 0}
              onClick={async () => {
                await window.electronAPI.clearErrorLog();
                setEntries([]);
              }}
            >
              <Trash2 size={12} />
              {t("logsView.clear")}
            </Button>
          </div>
        </div>

        <div className={cn(CARD_SURFACE_CLASS, "shadow-sm px-4 py-3")}>
          {entries.length === 0 ? (
            <p className="py-6 text-xs text-foreground/45 text-center">{t("logsView.empty")}</p>
          ) : (
            <ul>
              {entries.map((entry, index) => (
                <li
                  key={`${entry.time}-${index}`}
                  className="py-2 border-b border-foreground/4 dark:border-white/10 last:border-b-0"
                >
                  <div className="flex items-baseline gap-2 text-xs">
                    <span className="text-foreground/45 shrink-0 tabular-nums">
                      {new Date(entry.time).toLocaleString()}
                    </span>
                    <span
                      className={cn(
                        "font-semibold uppercase shrink-0",
                        entry.level === "warn" ? "text-warning" : "text-destructive"
                      )}
                    >
                      {entry.level}
                    </span>
                    <span dir="auto" className="text-foreground break-words min-w-0">
                      {entry.message}
                    </span>
                  </div>
                  {entry.details && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-foreground/45">
                        {t("logsView.details")}
                      </summary>
                      <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words text-[11px] text-foreground/60">
                        {entry.details}
                      </pre>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
