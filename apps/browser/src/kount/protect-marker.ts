// The page marker (plan Decisions 5 and 6, T1.4) — the half that runs in Protect's page, and the vocabulary both halves
// share. On Kount Protect's origin ONLY, the extension sets `data-kp-ext` on <html>. Its value is space-separated words,
// read by Protect's CSS with `~=`: always `v1`; then exactly one of `signed-out`, `locked`, `unlocked`; and
// `quick-unlock` when a PIN or biometrics is set. Nothing else — no identity, no count, no version beyond `v1`. `v1` is
// set synchronously at document_start and alone means only "installed"; the state words follow when the background
// answers, and are rewritten while the page stays open. Protect reads it with CSS alone (its Decision 7); a change to
// this vocabulary changes Protect too (README § The page marker).
//
// Nothing is sent but a bare "hello" to the extension's own background; nothing is stored or logged.
//
// The attribute belongs to the document: after the extension is switched off, removed or rolled back, an open page keeps
// its last words until it reloads, so its presence is no proof the extension is still enabled (README § The page
// marker; review round 13 PR-LOW-011).

export const MARKER_ATTRIBUTE = "data-kp-ext";
/** The background's answer and its pushes: `{ command, words }`. */
export const MARKER_COMMAND = "kountProtectMarker";
/** The page's request for the current words: `{ command }`, nothing else. */
export const MARKER_HELLO = "kountProtectMarkerHello";
/** The bundle the background registers and injects (webpack entry `content/kount-protect-marker`, patch 0003). */
export const MARKER_FILE = "content/kount-protect-marker.js";

export type MarkerWords =
  | "signed-out"
  | "locked"
  | "unlocked"
  | "locked quick-unlock"
  | "unlocked quick-unlock";

const ALLOWED: readonly string[] = [
  "signed-out",
  "locked",
  "unlocked",
  "locked quick-unlock",
  "unlocked quick-unlock",
];

/** Exactly one of the five state phrases, as written — anything else is refused. */
export function isMarkerWords(value: unknown): value is MarkerWords {
  return typeof value === "string" && ALLOWED.includes(value);
}

/** The state words for an account state; quick-unlock is never shown beside signed-out. */
export function markerWords(status: "signed-out" | "locked" | "unlocked", quickUnlock: boolean): MarkerWords {
  if (status === "signed-out") {
    return "signed-out";
  }
  return quickUnlock ? `${status} quick-unlock` : status;
}

/** The attribute's whole value: `v1`, or `v1 ` and the state words. */
export function markerValue(words?: MarkerWords): string {
  return words == null ? "v1" : `v1 ${words}`;
}

/** What the page half reads of its window — injected so that the spec needs no browser. */
export type MarkerWindow = {
  top: unknown;
  location: { origin: string };
  document: {
    documentElement: { hasAttribute(name: string): boolean; setAttribute(name: string, value: string): void } | null;
    visibilityState?: string;
    addEventListener(type: string, listener: () => void): void;
  };
  addEventListener(type: string, listener: () => void): void;
  /** Set on this content world's own window, so a second injection into the same document adds nothing. */
  __kountProtectMarker?: true;
};

/** What the page half uses of the extension's runtime. */
export type MarkerRuntime = {
  sendMessage(message: { command: string }): unknown;
  onMessage: { addListener(listener: (message: unknown) => void): void };
};

/** The top-level document, on EXACTLY Protect's origin — checked before every write (a match pattern cannot name a port,
 *  and a tab can navigate between being listed and being scripted). */
function onProtect(win: MarkerWindow, origin: string): boolean {
  try {
    return win.top === win && win.location.origin === origin;
  } catch {
    return false;
  }
}

function write(win: MarkerWindow, origin: string, value: string): void {
  if (!onProtect(win, origin)) {
    return;
  }
  win.document.documentElement?.setAttribute(MARKER_ATTRIBUTE, value);
}

function hello(runtime: MarkerRuntime): void {
  try {
    const sent = runtime.sendMessage({ command: MARKER_HELLO }) as { catch?: (f: () => void) => unknown } | undefined;
    sent?.catch?.((): void => undefined);
  } catch {
    // The extension was reloaded, switched off or removed: the marker stays as it is until the page reloads (above).
  }
}

/**
 * Start the page half: on Protect's exact origin and in the top frame only. Sets the bare `v1` at once (unless a
 * marker is already there — a second injection marks once, not twice), listens for the background's words and asks for
 * them now and whenever the page is shown again (a PIN set in the popup is read when the person returns to the tab).
 * Returns whether it started.
 */
export function startMarker(win: MarkerWindow, origin: string, runtime: MarkerRuntime): boolean {
  if (!onProtect(win, origin)) {
    return false;
  }
  if (win.__kountProtectMarker === true) {
    hello(runtime);
    return true;
  }
  win.__kountProtectMarker = true;
  if (win.document.documentElement?.hasAttribute(MARKER_ATTRIBUTE) !== true) {
    write(win, origin, markerValue());
  }
  runtime.onMessage.addListener((message) => {
    const m = message as { command?: unknown; words?: unknown } | null;
    if (m == null || m.command !== MARKER_COMMAND || !isMarkerWords(m.words)) {
      return;
    }
    write(win, origin, markerValue(m.words));
  });
  const again = () => {
    if (win.document.visibilityState == null || win.document.visibilityState === "visible") {
      hello(runtime);
    }
  };
  win.document.addEventListener("visibilitychange", again);
  win.addEventListener("pageshow", again);
  // Closing the toolbar popup — where a PIN is set or removed — gives the still-visible page its focus back; the PIN has
  // no observable, so that is when it is read again (round 11 PR-MED-059).
  win.addEventListener("focus", again);
  hello(runtime);
  return true;
}
