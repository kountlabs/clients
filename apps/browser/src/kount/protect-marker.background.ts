// The page marker's background half (plan Decisions 5 and 6, T1.4). It registers the marker script for Protect's host
// (never in a manifest: no permission is added and no manifest changes), injects it into Protect tabs that are ALREADY
// open when the background starts (install, update, a restarted worker), and tells each Protect page the active
// account's state words — rewriting them when the account, its server, its lock state or its quick unlock changes.
//
// The words describe the active account ONLY when that account's own environment is a Kount environment
// (kount-environment.ts): with no account, or with the active account on any other or mixed server, the words are
// `signed-out` and never carry `quick-unlock` — another vault's lock or PIN state never reaches Protect's page.
//
// The origin is not read here: the bootstrap passes the pick hook's (patch 0007), so the background bundle keeps ONE
// use of the build constant. Nothing is sent anywhere but to Protect's own tabs, nothing is stored and nothing is logged.
import { BehaviorSubject, combineLatest, from, Observable, of, Subscription } from "rxjs";
import { catchError, map, switchMap } from "rxjs/operators";

import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { UserId } from "@bitwarden/common/types/guid";

import { EnvironmentAddresses, isKountEnvironment } from "./kount-environment";
import { MARKER_COMMAND, MARKER_FILE, MARKER_HELLO, MarkerWords, markerWords } from "./protect-marker";

/** The registered script's id (Chrome and Edge keep a registration across worker restarts and browser sessions). */
export const MARKER_SCRIPT_ID = "kount-protect-marker";
/** Hellos held while the background starts. */
const WAITING_MAX = 50;

/** Who sent a hello, as the browser reports it. */
export type MarkerSender = { id?: string; tabId?: number; frameId?: number; url?: string; documentId?: string };

/** The browser calls the marker makes — injected so that the spec needs no browser to run. */
export interface MarkerBrowser {
  /** Register the script for the match pattern (or update an existing registration — never a duplicate). */
  registerScript(pattern: string): Promise<void>;
  /** The tabs whose address matches the pattern, with their addresses. */
  openTabs(pattern: string): Promise<{ id?: number; url?: string }[]>;
  /** Run the script in a tab's top frame. */
  inject(tabId: number): Promise<void>;
  /** Send a message to a tab's top frame (to one document of it when `documentId` is given and the browser can). */
  send(tabId: number, message: { command: string; words: MarkerWords }, documentId?: string): Promise<void>;
  /** Hear a page's hello (registered synchronously, so a hello that wakes the worker is heard). */
  onHello(listener: (sender: MarkerSender) => void): void;
}

/** What the words are read from, as MainBackground holds them. */
export type MarkerServices = {
  accountService: { activeAccount$: Observable<{ id: UserId } | null> };
  environmentService: { getEnvironment$(userId: UserId): Observable<EnvironmentAddresses> };
  authService: { authStatusFor$(userId: UserId): Observable<AuthenticationStatus> };
  pinService: { isPinSet(userId: UserId): Promise<boolean> };
  biometricStateService: { biometricUnlockEnabled$(userId: UserId): Observable<boolean> };
};

/** A failed browser call changes nothing here (a closed tab, a page the browser will not script). */
const ignore = (): void => undefined;

function parse(value: string | undefined): URL | null {
  try {
    return value == null ? null : new URL(value);
  } catch {
    return null;
  }
}

async function pinSet(s: MarkerServices, userId: UserId): Promise<boolean> {
  try {
    return (await s.pinService.isPinSet(userId)) === true;
  } catch {
    return false;
  }
}

/**
 * The active account's words, re-read whenever `refresh$` emits (a page's hello: the PIN has no observable of its own,
 * so a PIN set in the popup is read when the person returns to Protect's tab). Signed out unless the active account's
 * OWN environment is a Kount environment.
 */
export function markerWords$(s: MarkerServices, refresh$: Observable<unknown>): Observable<MarkerWords> {
  const signedOut = of<MarkerWords>("signed-out");
  const words$ = s.accountService.activeAccount$.pipe(
    switchMap((account) => {
      if (account?.id == null) {
        return signedOut;
      }
      const userId = account.id;
      return s.environmentService.getEnvironment$(userId).pipe(
        map((env) => isKountEnvironment(env)),
        switchMap((kount) => {
          if (!kount) {
            return signedOut;
          }
          return combineLatest([
            s.authService.authStatusFor$(userId),
            s.biometricStateService.biometricUnlockEnabled$(userId).pipe(catchError(() => of(false))),
          ]).pipe(
            switchMap(([status, biometrics]) => {
              if (status !== AuthenticationStatus.Locked && status !== AuthenticationStatus.Unlocked) {
                return signedOut;
              }
              const state = status === AuthenticationStatus.Locked ? "locked" : "unlocked";
              if (biometrics === true) {
                return of(markerWords(state, true));
              }
              return from(pinSet(s, userId)).pipe(map((pin) => markerWords(state, pin)));
            }),
          );
        }),
        // An account that cannot be read is signed out — for THIS account only: the recovery sits inside the account
        // switch, so a later account still flows without a page's hello (round 14 PR-LOW-021).
        catchError(() => signedOut),
      );
    }),
    catchError(() => signedOut),
  );
  // Every refresh reads the whole state again, so a hello is answered whatever the account (none included).
  return refresh$.pipe(switchMap(() => words$));
}

export class ProtectMarkerBackground {
  private readonly refresh$ = new BehaviorSubject<null>(null);
  private readonly pattern: string | null;
  private current: MarkerWords | null = null;
  private waiting: MarkerSender[] = [];
  /** A hello was dropped from `waiting` (over `WAITING_MAX`): the next publish tells every Protect tab (PR-LOW-012). */
  private dropped = false;
  private subscription: Subscription | null = null;
  private deliveries: Promise<unknown> = Promise.resolve();
  /** Settled for the spec: the registration and the open-tabs pass. */
  started: Promise<void> = Promise.resolve();

  private constructor(
    private readonly protectOrigin: string,
    private readonly browser: MarkerBrowser,
  ) {
    const origin = parse(protectOrigin);
    // The pattern names the host without a port (a match pattern cannot name one); the page half and every send here
    // compare the whole origin.
    this.pattern = origin == null ? null : `${origin.protocol}//${origin.hostname}/*`;
  }

  /**
   * Call synchronously at the top of the background script with the pick hook's origin. Hears hellos at once,
   * registers the script and marks the Protect tabs already open (the script itself re-checks the exact origin).
   */
  static listen(protectOrigin: string, browser: MarkerBrowser | null): ProtectMarkerBackground | null {
    if (browser == null) {
      return null;
    }
    const marker = new ProtectMarkerBackground(protectOrigin, browser);
    if (marker.pattern == null) {
      return marker;
    }
    browser.onHello((sender) => marker.hello(sender));
    marker.started = marker.start();
    return marker;
  }

  /** After the bootstrap: follow the active account's state and tell every Protect page. */
  attach(services: MarkerServices): void {
    if (this.pattern == null || this.subscription != null) {
      return;
    }
    this.subscription = markerWords$(services, this.refresh$).subscribe((words) => this.publish(words));
  }

  /** Whether a sender is the top frame of a page on EXACTLY Protect's origin. */
  private fromProtect(sender: MarkerSender): boolean {
    return (
      typeof sender.tabId === "number" && sender.frameId === 0 && parse(sender.url)?.origin === this.protectOrigin
    );
  }

  private hello(sender: MarkerSender): void {
    if (!this.fromProtect(sender)) {
      return;
    }
    // At most a page's worth of hellos wait; a dropped one is made good by telling every Protect tab at the next publish
    // (round 13 PR-LOW-012 — before the bootstrap the first words go to every tab anyway).
    if (this.waiting.length >= WAITING_MAX) {
      this.dropped = true;
    }
    this.waiting = [...this.waiting.slice(-(WAITING_MAX - 1)), sender];
    if (this.subscription != null) {
      this.refresh$.next(null);
    }
  }

  private publish(words: MarkerWords): void {
    // A change, or a hello that was dropped, goes to every Protect tab; the pages that asked are answered too.
    const changed = words !== this.current || this.dropped;
    this.dropped = false;
    this.current = words;
    const waiting = this.waiting.splice(0);
    // One delivery at a time, and every send carries the words current WHEN it sends: a slower, older delivery can
    // never reach a page after a newer one with older words (round 11 PR-MED-058). Each page that asked gets its answer
    // too (a second write of the same words changes nothing).
    this.deliveries = this.deliveries
      .then(async () => {
        if (changed) {
          await this.broadcast();
        }
        for (const sender of waiting) {
          await this.sendCurrent(sender.tabId!, sender.documentId);
        }
      })
      .catch(ignore);
  }

  /** Settled for the spec: every delivery published so far has been sent. */
  idle(): Promise<unknown> {
    return this.deliveries;
  }

  private async sendCurrent(tabId: number, documentId?: string): Promise<void> {
    const words = this.current;
    if (words == null) {
      return;
    }
    await this.browser.send(tabId, { command: MARKER_COMMAND, words }, documentId).catch(ignore);
  }

  private async protectTabs(): Promise<number[]> {
    const tabs = await this.browser.openTabs(this.pattern!).catch((): { id?: number; url?: string }[] => []);
    return tabs
      .filter((t) => typeof t.id === "number" && parse(t.url)?.origin === this.protectOrigin)
      .map((t) => t.id!);
  }

  private async broadcast(): Promise<void> {
    for (const tabId of await this.protectTabs()) {
      await this.sendCurrent(tabId);
    }
  }

  private async start(): Promise<void> {
    await this.browser.registerScript(this.pattern!).catch(ignore);
    for (const tabId of await this.protectTabs()) {
      await this.browser.inject(tabId).catch(ignore);
    }
  }
}

type ChromeLike = typeof chrome;

/**
 * The real browser calls. Chrome and Edge (Manifest V3): `chrome.scripting`, a registration kept across worker
 * restarts — updated when it already exists. Firefox (Manifest V2, no `scripting` permission): `browser.contentScripts`,
 * which lasts as long as the persistent background page that registered it. Hellos come from the extension's own
 * content script only.
 */
export function browserMarker(c: ChromeLike | undefined, b: any): MarkerBrowser | null {
  if (c?.runtime?.onMessage == null || c.tabs == null) {
    return null;
  }
  const mv3 = c.scripting?.registerContentScripts != null;
  return {
    async registerScript(pattern) {
      if (mv3) {
        const script = {
          id: MARKER_SCRIPT_ID,
          matches: [pattern],
          js: [MARKER_FILE],
          runAt: "document_start" as const,
          allFrames: false,
          persistAcrossSessions: true,
        };
        const existing = await c.scripting.getRegisteredContentScripts({ ids: [MARKER_SCRIPT_ID] });
        if (existing.length > 0) {
          await c.scripting.updateContentScripts([script]);
          return;
        }
        try {
          await c.scripting.registerContentScripts([script]);
        } catch {
          // Registered meanwhile by another start of the worker: bring that one up to date instead.
          await c.scripting.updateContentScripts([script]);
        }
        return;
      }
      if (b?.contentScripts?.register != null) {
        await b.contentScripts.register({
          matches: [pattern],
          js: [{ file: MARKER_FILE }],
          runAt: "document_start",
          allFrames: false,
        });
      }
    },
    async openTabs(pattern) {
      return await new Promise((resolve) => c.tabs.query({ url: [pattern] }, (tabs) => resolve(tabs ?? [])));
    },
    async inject(tabId) {
      if (mv3) {
        await c.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: [MARKER_FILE], injectImmediately: true });
        return;
      }
      await new Promise<void>((resolve) =>
        c.tabs.executeScript(tabId, { file: MARKER_FILE, frameId: 0, runAt: "document_start" }, () => {
          void c.runtime.lastError;
          resolve();
        }),
      );
    },
    async send(tabId, message, documentId) {
      const options: { frameId: number; documentId?: string } = { frameId: 0 };
      if (mv3 && documentId != null) {
        options.documentId = documentId;
      }
      await new Promise<void>((resolve) =>
        c.tabs.sendMessage(tabId, message, options as any, () => {
          void c.runtime.lastError;
          resolve();
        }),
      );
    },
    onHello(listener) {
      c.runtime.onMessage.addListener((message: unknown, sender: chrome.runtime.MessageSender) => {
        if ((message as { command?: unknown } | null)?.command !== MARKER_HELLO || sender.id !== c.runtime.id) {
          return;
        }
        listener({
          id: sender.id,
          tabId: sender.tab?.id,
          frameId: sender.frameId,
          url: sender.url,
          documentId: (sender as { documentId?: string }).documentId,
        });
      });
    },
  };
}
