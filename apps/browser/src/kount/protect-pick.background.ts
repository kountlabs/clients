// The pick hook (plan Decision 7, T1.3; T0.11 (A) and T0.11b (A)). When a Kount Protect tile launch is ACCEPTED —
// Protect's launch route answers 303 to an address on another origin — the extension marks the login the person picked
// on the tile as just launched, so upstream's own page-load rule fills it (autofill-orchestrator.ts `selectLogin`). The
// latest pick wins for that site (E24); a pick made within upstream's 3-second sorted-list cache is seen because patch
// 0008 clears that cache when a launch is marked (E23).
//
// What Protect's route answers (apps/kount-protect/src/tiles/routes.ts at main 965ee4dc7): with no live session a 303
// on its OWN origin to /auth/login, carrying the launch's query (`signInHref`) — not a signal; a refused token a 400
// page and a tile that is gone a 404 page — no redirect at all; after the token and the tile check out, a 303 to the
// vendor — the one signal. After a sign-in, the callback sends the browser on to the new session's own launch link
// (bulk-access-and-polish D5), whose vendor 303 is heard once like any other (E7).
//
// It calls one existing method (`cipherService.updateLastLaunchedDate`), opens no connection, stores nothing of its
// own and logs nothing: no URL, token, id or name. It never fills anything itself. Its spec holds the file to that.
import { firstValueFrom, Observable } from "rxjs";

import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { UserId } from "@bitwarden/common/types/guid";
import { CipherType } from "@bitwarden/common/vault/enums";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LAUNCH_PATH = /^\/tiles\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/launch$/i;
/** A launch heard before the background finished starting is kept this long, then dropped. */
const PENDING_MS = 30000;
/** At most this many launches are held while the background starts (a background that never starts holds no more). */
const PENDING_MAX = 20;

export type PickSignal = { accountUuid: string; target: string };

/** The parts of `webRequest.onBeforeRedirect`'s details the hook reads. */
export type RedirectDetails = { url: string; redirectUrl: string; statusCode: number; type: string };

function parse(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * Accept: a main-frame 303 from Protect's own origin, path /tiles/<uuid>/launch, exactly one `a` that is a uuid, whose
 * target is an http(s) address on ANOTHER origin. A sign-in bounce (303 to Protect's own /auth/login, with or without
 * the launch's query), a refused launch (400) and a tile that is gone (404) are not signals — the last two are no
 * redirect at all. Anything else: null.
 */
export function readPickSignal(details: RedirectDetails, protectOrigin: string): PickSignal | null {
  if (details.type !== "main_frame" || details.statusCode !== 303) return null;
  const from = parse(details.url);
  if (from == null || from.origin !== protectOrigin || !LAUNCH_PATH.test(from.pathname)) return null;
  const a = from.searchParams.getAll("a");
  if (a.length !== 1 || !UUID.test(a[0])) return null;
  const to = parse(details.redirectUrl);
  if (to == null || (to.protocol !== "https:" && to.protocol !== "http:") || to.origin === protectOrigin) return null;
  return { accountUuid: a[0].toLowerCase(), target: to.href };
}

/** The collection External ID Protect gives an account: `kp:acct:` + the first 13 characters of its uuid, lower case. */
export function accountTag(accountUuid: string): string {
  return `kp:acct:${accountUuid.slice(0, 13).toLowerCase()}`;
}

/**
 * Choose: one candidate — it. Several — keep those matching the target address when that is known and leaves at least
 * one; then the most recently used, ties broken by the lowest id. None — null.
 */
export function chooseLogin(
  candidates: string[],
  matching: string[] | null,
  lastUsed: Record<string, number | undefined>,
): string | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  let pool = candidates;
  if (matching != null) {
    const kept = candidates.filter((id) => matching.includes(id));
    if (kept.length > 0) pool = kept;
  }
  return [...pool].sort((x, y) => (lastUsed[y] ?? 0) - (lastUsed[x] ?? 0) || (x < y ? -1 : x > y ? 1 : 0))[0];
}

/** What the hook reads and the one thing it does, injected so that the spec needs no browser to run. */
export interface PickDeps {
  activeUserId(): Promise<UserId | null>;
  status(userId: UserId): Promise<AuthenticationStatus>;
  collections(userId: UserId): Promise<{ id: string; externalId?: string | null }[]>;
  ciphers(
    userId: UserId,
  ): Promise<Record<string, { id: string; type: number; collectionIds?: string[]; deletedDate?: string | null }>>;
  /** The ids of the logins the extension's own URL matching finds for `url` (only asked when unlocked). */
  matchingIds(url: string, userId: UserId): Promise<string[]>;
  lastUsed(userId: UserId): Promise<Record<string, number | undefined>>;
  mark(id: string, userId: UserId): Promise<void>;
}

/** Resolve and act for the ACTIVE account only; resolves to the id marked, or null when the hook does nothing. */
export async function resolvePick(signal: PickSignal, deps: PickDeps): Promise<string | null> {
  const userId = await deps.activeUserId();
  if (userId == null) return null;
  const status = await deps.status(userId);
  if (status === AuthenticationStatus.LoggedOut) return null;

  const tag = accountTag(signal.accountUuid);
  const tagged = (await deps.collections(userId)).filter((c) => c.externalId === tag);
  if (tagged.length !== 1) return null;
  const collectionId = tagged[0].id;

  const candidates = Object.values(await deps.ciphers(userId))
    .filter((c) => c.type === CipherType.Login && !c.deletedDate && (c.collectionIds ?? []).includes(collectionId))
    .map((c) => c.id);
  if (candidates.length === 0) return null;

  const matching =
    candidates.length > 1 && status === AuthenticationStatus.Unlocked
      ? await deps.matchingIds(signal.target, userId)
      : null;
  const chosen = chooseLogin(candidates, matching, await deps.lastUsed(userId));
  if (chosen == null) return null;

  // The account must still be the active one when the mark is written (a switch mid-resolve acts for no one).
  if ((await deps.activeUserId()) !== userId) return null;
  await deps.mark(chosen, userId);
  return chosen;
}

/** The services the hook reads, as MainBackground holds them. */
export type PickServices = {
  accountService: { activeAccount$: Observable<{ id: UserId } | null> };
  authService: { authStatusFor$(userId: UserId): Observable<AuthenticationStatus> };
  collectionService: {
    encryptedCollections$(userId: UserId): Observable<{ id: string; externalId?: string }[] | null>;
  };
  cipherService: {
    ciphers$(userId: UserId): Observable<Record<string, any>>;
    localData$(userId: UserId): Observable<Record<string, { lastUsedDate?: number }>>;
    getAllDecryptedForUrl(url: string, userId: UserId): Promise<{ id: string }[]>;
    updateLastLaunchedDate(id: string, userId: UserId): Promise<void>;
  };
};

export function depsFrom(s: PickServices): PickDeps {
  return {
    activeUserId: async () => (await firstValueFrom(s.accountService.activeAccount$))?.id ?? null,
    status: (userId) => firstValueFrom(s.authService.authStatusFor$(userId)),
    collections: async (userId) => (await firstValueFrom(s.collectionService.encryptedCollections$(userId))) ?? [],
    ciphers: async (userId) => (await firstValueFrom(s.cipherService.ciphers$(userId))) ?? {},
    matchingIds: async (url, userId) => (await s.cipherService.getAllDecryptedForUrl(url, userId)).map((c) => c.id),
    lastUsed: async (userId) => {
      const local = (await firstValueFrom(s.cipherService.localData$(userId))) ?? {};
      return Object.fromEntries(Object.entries(local).map(([id, d]) => [id, d?.lastUsedDate]));
    },
    mark: (id, userId) => s.cipherService.updateLastLaunchedDate(id, userId),
  };
}

type WebRequestLike = {
  onBeforeRedirect: {
    addListener(cb: (details: RedirectDetails) => void, filter: { urls: string[]; types?: string[] }): void;
  };
};

export class ProtectPickBackground {
  private pending: { signal: PickSignal; at: number }[] = [];
  private deps: PickDeps | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  private constructor(
    /** Protect's origin as the bootstrap passed it — the page marker takes it from here (patch 0007). */
    readonly protectOrigin: string,
    private readonly now: () => number,
  ) {}

  /**
   * Register the listener — call it synchronously at the top of the background script, so a launch that wakes a
   * sleeping service worker is heard. Signals that arrive before `attach` are held for up to 30 seconds. The origin is
   * the build constant KOUNT_PROTECT_ORIGIN, passed by the bootstrap (patch 0007) — its one use in the bundle.
   */
  static listen(
    webRequest: WebRequestLike | undefined,
    protectOrigin: string,
    now: () => number = Date.now,
  ): ProtectPickBackground {
    const hook = new ProtectPickBackground(protectOrigin, now);
    const origin = parse(protectOrigin);
    if (webRequest?.onBeforeRedirect != null && origin != null) {
      // The filter names the host without a port (a match pattern's port support differs between browsers);
      // readPickSignal compares the whole origin.
      webRequest.onBeforeRedirect.addListener((details) => hook.heard(details), {
        urls: [`${origin.protocol}//${origin.hostname}/tiles/*`],
        types: ["main_frame"],
      });
    }
    return hook;
  }

  heard(details: RedirectDetails): void {
    const signal = readPickSignal(details, this.protectOrigin);
    if (signal == null) return;
    const now = this.now();
    this.pending = this.pending.filter((p) => now - p.at <= PENDING_MS).slice(-(PENDING_MAX - 1));
    this.pending.push({ signal, at: now });
    this.drain();
  }

  attach(services: PickServices | PickDeps): void {
    this.deps = "mark" in services ? services : depsFrom(services);
    this.drain();
  }

  /** Settled for the spec: resolves once every signal heard so far has been handled. */
  idle(): Promise<unknown> {
    return this.chain;
  }

  private drain(): void {
    const deps = this.deps;
    if (deps == null) return;
    const ready = this.pending.splice(0).filter((p) => this.now() - p.at <= PENDING_MS);
    for (const p of ready) {
      // One at a time, in the order heard: the later pick's mark is the later write.
      this.chain = this.chain.then(() => resolvePick(p.signal, deps)).catch((): null => null);
    }
  }
}
