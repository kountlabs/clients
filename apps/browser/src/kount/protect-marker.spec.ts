// The page marker's spec (plan Decisions 5 and 6, T1.4; E3, E37, E41, E42, E48, E55). Run by upstream's jest inside
// build.sh's container, never on the host:
//   bash apps/kount-extension/build/build.sh --test --targets chrome
import { readFileSync } from "fs";
import { join } from "path";

import { BehaviorSubject, Observable } from "rxjs";

import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { UserId } from "@bitwarden/common/types/guid";

import { KOUNT_VAULT_BASE } from "./build-constants";
import { EnvironmentAddresses, isKountEnvironment } from "./kount-environment";
import {
  MARKER_ATTRIBUTE,
  MARKER_COMMAND,
  MARKER_FILE,
  MARKER_HELLO,
  MarkerRuntime,
  MarkerWindow,
  isMarkerWords,
  markerValue,
  markerWords,
  startMarker,
} from "./protect-marker";
import {
  MARKER_SCRIPT_ID,
  MarkerBrowser,
  MarkerSender,
  MarkerServices,
  ProtectMarkerBackground,
  browserMarker,
} from "./protect-marker.background";

const PROTECT = "https://protect.kount.com.au";
const SIBLING = "https://protect.kount.com.au:8443";
const OTHER = "https://vendor.example";
const VOCABULARY = new Set(["v1", "signed-out", "locked", "unlocked", "quick-unlock"]);

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function env(base: string, over: Partial<{ webVault: string; api: string; identity: string }> = {}): EnvironmentAddresses {
  return {
    getWebVaultUrl: () => over.webVault ?? base,
    getApiUrl: () => over.api ?? `${base}/api`,
    getIdentityUrl: () => over.identity ?? `${base}/identity`,
  };
}

// ---- the page half -------------------------------------------------------------------------------------------------

type FakePage = MarkerWindow & {
  attrs: Map<string, string>;
  writes: string[];
  listeners: ((m: unknown) => void)[];
  hellos: number;
  runtime: MarkerRuntime;
  fire(type: string): void;
};

function page(origin: string, opts: { top?: boolean; preset?: string } = {}): FakePage {
  const attrs = new Map<string, string>();
  if (opts.preset != null) {
    attrs.set(MARKER_ATTRIBUTE, opts.preset);
  }
  const handlers = new Map<string, (() => void)[]>();
  const on = (type: string, f: () => void) => handlers.set(type, [...(handlers.get(type) ?? []), f]);
  const p = {
    attrs,
    writes: [] as string[],
    listeners: [] as ((m: unknown) => void)[],
    hellos: 0,
    location: { origin },
    document: {
      visibilityState: "visible",
      documentElement: {
        hasAttribute: (n: string) => attrs.has(n),
        setAttribute: (n: string, v: string) => {
          attrs.set(n, v);
          p.writes.push(v);
        },
      },
      addEventListener: on,
    },
    addEventListener: on,
    fire: (type: string) => (handlers.get(type) ?? []).forEach((f) => f()),
  } as unknown as FakePage;
  (p as any).top = opts.top === false ? {} : p;
  p.runtime = {
    sendMessage: (m: { command: string }) => {
      expect(m).toEqual({ command: MARKER_HELLO });
      p.hellos++;
      return Promise.resolve();
    },
    onMessage: { addListener: (f) => p.listeners.push(f) },
  };
  return p;
}
const deliver = (p: FakePage, message: unknown) => p.listeners.forEach((f) => f(message));
const marker = (p: FakePage) => p.attrs.get(MARKER_ATTRIBUTE);

describe("the vocabulary (E3)", () => {
  it("builds exactly Decision 5's values", () => {
    expect(markerValue()).toBe("v1");
    expect(markerValue(markerWords("signed-out", true))).toBe("v1 signed-out");
    expect(markerValue(markerWords("locked", false))).toBe("v1 locked");
    expect(markerValue(markerWords("unlocked", false))).toBe("v1 unlocked");
    expect(markerValue(markerWords("locked", true))).toBe("v1 locked quick-unlock");
    expect(markerValue(markerWords("unlocked", true))).toBe("v1 unlocked quick-unlock");
  });
  it.each([
    "signed-out quick-unlock",
    "unlocked locked",
    "v1 unlocked",
    "unlocked ",
    "UNLOCKED",
    "unlocked x@example.com",
    "",
    7,
    null,
    { words: "unlocked" },
  ])("refuses %p", (value) => {
    expect(isMarkerWords(value)).toBe(false);
  });
});

describe("startMarker — the page half", () => {
  it("sets the bare v1 synchronously on Protect's origin and asks for the words (a delayed answer leaves v1)", () => {
    const p = page(PROTECT);
    expect(startMarker(p, PROTECT, p.runtime)).toBe(true);
    expect(marker(p)).toBe("v1");
    expect(p.hellos).toBe(1);
  });
  it.each([
    ["another origin", OTHER],
    ["Protect's host on another port (E48, E55)", SIBLING],
    ["http where the build says https", "http://protect.kount.com.au"],
  ])("does nothing on %s", (_name, origin) => {
    const p = page(origin);
    expect(startMarker(p, PROTECT, p.runtime)).toBe(false);
    expect(marker(p)).toBeUndefined();
    expect(p.hellos).toBe(0);
    expect(p.listeners).toHaveLength(0);
  });
  it("does nothing in a frame", () => {
    const p = page(PROTECT, { top: false });
    expect(startMarker(p, PROTECT, p.runtime)).toBe(false);
    expect(marker(p)).toBeUndefined();
  });
  it("writes each state the background sends, and rewrites it on a change", () => {
    const p = page(PROTECT);
    startMarker(p, PROTECT, p.runtime);
    for (const words of ["signed-out", "locked", "unlocked", "unlocked quick-unlock", "locked quick-unlock", "signed-out"]) {
      deliver(p, { command: MARKER_COMMAND, words });
      expect(marker(p)).toBe(`v1 ${words}`);
    }
  });
  it("never writes anything outside the vocabulary (E3)", () => {
    const p = page(PROTECT);
    startMarker(p, PROTECT, p.runtime);
    deliver(p, { command: MARKER_COMMAND, words: "unlocked" });
    for (const bad of [
      { command: MARKER_COMMAND, words: "unlocked person@example.com" },
      { command: MARKER_COMMAND, words: "v2" },
      { command: MARKER_COMMAND },
      { command: "other", words: "locked" },
      "unlocked",
      null,
    ]) {
      deliver(p, bad);
    }
    expect(marker(p)).toBe("v1 unlocked");
    for (const value of p.writes) {
      for (const word of value.split(" ")) {
        expect(VOCABULARY.has(word)).toBe(true);
      }
    }
  });
  it("ignores a late answer once the document is no longer Protect's (E48)", () => {
    const p = page(PROTECT);
    startMarker(p, PROTECT, p.runtime);
    (p.location as { origin: string }).origin = OTHER;
    deliver(p, { command: MARKER_COMMAND, words: "unlocked quick-unlock" });
    expect(marker(p)).toBe("v1");
  });
  it("a second injection into the same document marks once and adds no second listener (E42)", () => {
    const p = page(PROTECT);
    startMarker(p, PROTECT, p.runtime);
    startMarker(p, PROTECT, p.runtime);
    expect(p.writes).toEqual(["v1"]);
    expect(p.listeners).toHaveLength(1);
    expect(p.hellos).toBe(2);
  });
  it("keeps a marker another content world already wrote, and asks for fresh words", () => {
    const p = page(PROTECT, { preset: "v1 locked" });
    startMarker(p, PROTECT, p.runtime);
    expect(p.writes).toEqual([]);
    expect(marker(p)).toBe("v1 locked");
    expect(p.hellos).toBe(1);
  });
  it("asks again when the page is shown again (a PIN set in the popup)", () => {
    const p = page(PROTECT);
    startMarker(p, PROTECT, p.runtime);
    p.fire("visibilitychange");
    p.fire("pageshow");
    expect(p.hellos).toBe(3);
    // The toolbar popup closing gives the visible page its focus back (round 11 PR-MED-059).
    p.fire("focus");
    expect(p.hellos).toBe(4);
    (p.document as { visibilityState: string }).visibilityState = "hidden";
    p.fire("visibilitychange");
    p.fire("focus");
    expect(p.hellos).toBe(4);
  });
  it("survives a runtime that is gone (an extension reloaded under an open page)", () => {
    const p = page(PROTECT);
    p.runtime.sendMessage = () => {
      throw new Error("Extension context invalidated.");
    };
    expect(startMarker(p, PROTECT, p.runtime)).toBe(true);
    expect(marker(p)).toBe("v1");
  });
});

// ---- the Kount environment (Decision 1) ------------------------------------------------------------------------------

describe("isKountEnvironment (E41)", () => {
  it("accepts the Kount vault's three addresses, each with or without a trailing slash", () => {
    expect(isKountEnvironment(env(KOUNT_VAULT_BASE))).toBe(true);
    expect(
      isKountEnvironment(
        env(KOUNT_VAULT_BASE, {
          webVault: `${KOUNT_VAULT_BASE}/`,
          api: `${KOUNT_VAULT_BASE}/api/`,
          identity: `${KOUNT_VAULT_BASE}/identity/`,
        }),
      ),
    ).toBe(true);
  });
  it.each([
    ["another server", env("https://vault.example.com")],
    ["Kount's base with another web vault", env(KOUNT_VAULT_BASE, { webVault: "https://vault.example.com" })],
    ["Kount's web vault with another API", env(KOUNT_VAULT_BASE, { api: "https://api.example.com" })],
    ["Kount's web vault with another identity", env(KOUNT_VAULT_BASE, { identity: "https://id.example.com" })],
    ["a look-alike host", env(`${KOUNT_VAULT_BASE}.example.com`)],
    ["none", null],
  ])("refuses %s", (_name, e) => {
    expect(isKountEnvironment(e)).toBe(false);
  });
  // The same endpoints spelled another way — a managed address is stored as written (round 13 PR-MED-068).
  const U = new URL(KOUNT_VAULT_BASE);
  const UPPER = `${U.protocol}//${U.hostname.toUpperCase()}${U.port === "" ? "" : `:${U.port}`}`;
  const DEFAULT_PORT = U.port === "" ? `${U.protocol}//${U.hostname}:${U.protocol === "https:" ? 443 : 80}` : null;
  it("accepts the same endpoints with an uppercase host or the scheme's default port spelled out", () => {
    expect(isKountEnvironment(env(UPPER))).toBe(true);
    expect(isKountEnvironment(env(KOUNT_VAULT_BASE, { identity: `${UPPER}/identity` }))).toBe(true);
    if (DEFAULT_PORT !== null) {
      // A build whose base names no port (the store build): `:443` is the same endpoint.
      expect(isKountEnvironment(env(KOUNT_VAULT_BASE, { identity: `${DEFAULT_PORT}/identity` }))).toBe(true);
      expect(isKountEnvironment(env(DEFAULT_PORT))).toBe(true);
    }
  });
  it.each([
    ["another port", env(`${U.protocol}//${U.hostname}:8443`)],
    ["another path", env(`${KOUNT_VAULT_BASE}/other`)],
    ["the identity under another path", env(KOUNT_VAULT_BASE, { identity: `${KOUNT_VAULT_BASE}/other/identity` })],
    ["another scheme", env(KOUNT_VAULT_BASE.replace(/^https?:/, U.protocol === "https:" ? "http:" : "https:"))],
    ["a query", env(KOUNT_VAULT_BASE, { webVault: `${KOUNT_VAULT_BASE}/?x=1` })],
    ["a fragment", env(KOUNT_VAULT_BASE, { api: `${KOUNT_VAULT_BASE}/api#x` })],
    ["credentials", env(`${U.protocol}//someone@${U.host}`)],
    ["an uppercase look-alike", env(`${UPPER}.example.com`)],
    ["not an address", env("vault")],
  ])("refuses %s, however the rest is spelled", (_name, e) => {
    expect(isKountEnvironment(e)).toBe(false);
  });
  it("refuses an environment whose getters throw", () => {
    expect(
      isKountEnvironment({
        getWebVaultUrl: () => {
          throw new Error("x");
        },
        getApiUrl: () => "",
        getIdentityUrl: () => "",
      }),
    ).toBe(false);
  });
});

// ---- the background half -------------------------------------------------------------------------------------------

const USER = "user-1" as UserId;
const OTHER_USER = "user-2" as UserId;

type World = {
  account: BehaviorSubject<{ id: UserId } | null>;
  envs: Map<UserId, BehaviorSubject<EnvironmentAddresses>>;
  status: Map<UserId, BehaviorSubject<AuthenticationStatus>>;
  biometrics: Map<UserId, BehaviorSubject<boolean>>;
  pin: Map<UserId, boolean>;
  services: MarkerServices;
};

function world(): World {
  const w = {
    account: new BehaviorSubject<{ id: UserId } | null>(null),
    envs: new Map(),
    status: new Map(),
    biometrics: new Map(),
    pin: new Map(),
  } as unknown as World;
  const subject = <T>(m: Map<UserId, BehaviorSubject<T>>, id: UserId, initial: T): Observable<T> => {
    if (!m.has(id)) {
      m.set(id, new BehaviorSubject<T>(initial));
    }
    return m.get(id)!;
  };
  w.services = {
    accountService: { activeAccount$: w.account },
    environmentService: { getEnvironment$: (id) => subject(w.envs, id, env(KOUNT_VAULT_BASE)) },
    authService: { authStatusFor$: (id) => subject(w.status, id, AuthenticationStatus.Locked) },
    pinService: { isPinSet: async (id) => w.pin.get(id) === true },
    biometricStateService: { biometricUnlockEnabled$: (id) => subject(w.biometrics, id, false) },
  };
  return w;
}

type FakeBrowser = MarkerBrowser & {
  tabs: { id: number; url: string }[];
  sent: { tabId: number; words: string; documentId?: string }[];
  injected: number[];
  registered: string[];
  hello: (sender: MarkerSender) => void;
};

function fakeBrowser(tabs: { id: number; url: string }[] = []): FakeBrowser {
  const b = {
    tabs,
    sent: [],
    injected: [],
    registered: [],
    hello: () => undefined,
    registerScript: async (pattern: string) => {
      b.registered.push(pattern);
    },
    openTabs: async () => b.tabs.map((t) => ({ ...t })),
    inject: async (tabId: number) => {
      b.injected.push(tabId);
    },
    send: async (tabId: number, message: { command: string; words: string }, documentId?: string) => {
      expect(message.command).toBe(MARKER_COMMAND);
      b.sent.push({ tabId, words: message.words, documentId });
    },
    onHello: (listener: (s: MarkerSender) => void) => {
      b.hello = listener;
    },
  } as FakeBrowser;
  return b;
}

const lastWords = (b: FakeBrowser, tabId: number) => b.sent.filter((s) => s.tabId === tabId).map((s) => s.words).pop();

async function started(tabs: { id: number; url: string }[] = [{ id: 1, url: `${PROTECT}/` }]) {
  const w = world();
  const b = fakeBrowser(tabs);
  const m = ProtectMarkerBackground.listen(PROTECT, b)!;
  await m.started;
  return { w, b, m };
}

describe("ProtectMarkerBackground — registration and open tabs (Decision 6, E42)", () => {
  it("registers for Protect's host without a port, and injects into open Protect tabs only — once each", async () => {
    const { b } = await started([
      { id: 1, url: `${PROTECT}/` },
      { id: 2, url: `${OTHER}/` },
      { id: 3, url: `${SIBLING}/apps` },
      { id: 4, url: `${PROTECT}/recent` },
    ]);
    expect(b.registered).toEqual(["https://protect.kount.com.au/*"]);
    expect(b.injected).toEqual([1, 4]);
  });
  it("hears nothing and does nothing without a browser, or with an origin that does not parse", async () => {
    expect(ProtectMarkerBackground.listen(PROTECT, null)).toBeNull();
    const b = fakeBrowser([{ id: 1, url: `${PROTECT}/` }]);
    const m = ProtectMarkerBackground.listen("not an origin", b)!;
    await m.started;
    expect(b.registered).toEqual([]);
    expect(b.injected).toEqual([]);
  });
  it("a registration or injection that fails leaves the rest working", async () => {
    const b = fakeBrowser([
      { id: 1, url: `${PROTECT}/` },
      { id: 2, url: `${PROTECT}/` },
    ]);
    b.registerScript = async () => {
      throw new Error("Duplicate script ID");
    };
    b.inject = async (tabId) => {
      if (tabId === 1) {
        throw new Error("No tab with id");
      }
      b.injected.push(tabId);
    };
    const m = ProtectMarkerBackground.listen(PROTECT, b)!;
    await m.started;
    expect(b.injected).toEqual([2]);
  });
});

describe("ProtectMarkerBackground — the words (Decision 5, E37, E41)", () => {
  it("is signed-out with no account", async () => {
    const { w, b, m } = await started();
    m.attach(w.services);
    await flush();
    expect(lastWords(b, 1)).toBe("signed-out");
  });
  it("follows the active Kount account: locked, unlocked, quick-unlock by PIN or biometrics, signed out", async () => {
    const { w, b, m } = await started();
    m.attach(w.services);
    w.account.next({ id: USER });
    await flush();
    expect(lastWords(b, 1)).toBe("locked");
    w.status.get(USER)!.next(AuthenticationStatus.Unlocked);
    await flush();
    expect(lastWords(b, 1)).toBe("unlocked");
    w.biometrics.get(USER)!.next(true);
    await flush();
    expect(lastWords(b, 1)).toBe("unlocked quick-unlock");
    w.biometrics.get(USER)!.next(false);
    await flush();
    expect(lastWords(b, 1)).toBe("unlocked");
    w.pin.set(USER, true);
    b.hello({ id: "ext", tabId: 1, frameId: 0, url: `${PROTECT}/apps`, documentId: "doc-1" });
    await flush();
    expect(lastWords(b, 1)).toBe("unlocked quick-unlock");
    w.status.get(USER)!.next(AuthenticationStatus.Locked);
    await flush();
    expect(lastWords(b, 1)).toBe("locked quick-unlock");
    w.status.get(USER)!.next(AuthenticationStatus.LoggedOut);
    await flush();
    expect(lastWords(b, 1)).toBe("signed-out");
  });
  it("never shows another server's lock or PIN state: an account there with a PIN reads signed-out (E37)", async () => {
    const { w, b, m } = await started();
    w.envs.set(OTHER_USER, new BehaviorSubject(env("https://vault.example.com")));
    w.status.set(OTHER_USER, new BehaviorSubject<AuthenticationStatus>(AuthenticationStatus.Unlocked));
    w.biometrics.set(OTHER_USER, new BehaviorSubject(true));
    w.pin.set(OTHER_USER, true);
    m.attach(w.services);
    w.account.next({ id: OTHER_USER });
    await flush();
    expect(b.sent.map((s) => s.words)).toEqual(["signed-out"]);
  });
  it.each([
    ["Kount's base with another web vault", env(KOUNT_VAULT_BASE, { webVault: "https://vault.example.com" })],
    ["Kount's web vault with another API", env(KOUNT_VAULT_BASE, { api: "https://api.example.com" })],
    ["Kount's web vault with another identity", env(KOUNT_VAULT_BASE, { identity: "https://id.example.com" })],
  ])("a mixed environment (%s) is always signed-out (E41)", async (_name, e) => {
    const { w, b, m } = await started();
    w.envs.set(USER, new BehaviorSubject(e));
    w.status.set(USER, new BehaviorSubject<AuthenticationStatus>(AuthenticationStatus.Unlocked));
    w.pin.set(USER, true);
    m.attach(w.services);
    w.account.next({ id: USER });
    await flush();
    expect(b.sent.map((s) => s.words)).toEqual(["signed-out"]);
  });
  it("rewrites at once on a switch to and from the Kount vault with Protect open (E37)", async () => {
    const { w, b, m } = await started();
    w.status.set(USER, new BehaviorSubject<AuthenticationStatus>(AuthenticationStatus.Unlocked));
    w.pin.set(USER, true);
    w.envs.set(OTHER_USER, new BehaviorSubject(env("https://vault.example.com")));
    w.status.set(OTHER_USER, new BehaviorSubject<AuthenticationStatus>(AuthenticationStatus.Unlocked));
    m.attach(w.services);
    w.account.next({ id: USER });
    await flush();
    expect(lastWords(b, 1)).toBe("unlocked quick-unlock");
    w.account.next({ id: OTHER_USER });
    await flush();
    expect(lastWords(b, 1)).toBe("signed-out");
    w.account.next({ id: USER });
    await flush();
    expect(lastWords(b, 1)).toBe("unlocked quick-unlock");
    // The account's own server changing under it: signed-out at once.
    w.envs.get(USER)!.next(env("https://vault.example.com"));
    await flush();
    expect(lastWords(b, 1)).toBe("signed-out");
  });
  it("an older, slower delivery never lands after a newer one with older words (round 11 PR-MED-058)", async () => {
    const { w, b, m } = await started([
      { id: 1, url: `${PROTECT}/` },
      { id: 2, url: `${PROTECT}/recent` },
    ]);
    w.status.set(USER, new BehaviorSubject<AuthenticationStatus>(AuthenticationStatus.Unlocked));
    w.pin.set(USER, true);
    w.envs.set(OTHER_USER, new BehaviorSubject(env("https://vault.example.com")));
    m.attach(w.services);
    await flush();
    // Hold the next tab listing: the delivery for the Kount account stalls in its query…
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => (release = r));
    const realOpenTabs = b.openTabs;
    let calls = 0;
    b.openTabs = async (pattern: string) => {
      calls += 1;
      if (calls === 1) {
        await held;
      }
      return realOpenTabs(pattern);
    };
    w.account.next({ id: USER });
    await flush();
    // …while the account switches to another server's, whose delivery would run at once.
    w.account.next({ id: OTHER_USER });
    await flush();
    release();
    await m.idle();
    expect(lastWords(b, 1)).toBe("signed-out");
    expect(lastWords(b, 2)).toBe("signed-out");
  });
  it("sends to Protect tabs only — never another origin or Protect's host on another port (E48, E55)", async () => {
    const { w, b, m } = await started([
      { id: 1, url: `${PROTECT}/` },
      { id: 2, url: `${OTHER}/` },
      { id: 3, url: `${SIBLING}/` },
    ]);
    m.attach(w.services);
    w.account.next({ id: USER });
    await flush();
    expect(new Set(b.sent.map((s) => s.tabId))).toEqual(new Set([1]));
  });
  it("answers a hello from a Protect top frame — to that document — and ignores every other sender", async () => {
    const { w, b, m } = await started([]);
    m.attach(w.services);
    await flush();
    b.sent.length = 0;
    for (const sender of [
      { id: "ext", tabId: 5, frameId: 1, url: `${PROTECT}/` },
      { id: "ext", tabId: 5, frameId: 0, url: `${OTHER}/` },
      { id: "ext", tabId: 5, frameId: 0, url: `${SIBLING}/` },
      { id: "ext", frameId: 0, url: `${PROTECT}/` },
      { id: "ext", tabId: 5, frameId: 0 },
    ]) {
      b.hello(sender);
    }
    await flush();
    expect(b.sent).toEqual([]);
    b.hello({ id: "ext", tabId: 5, frameId: 0, url: `${PROTECT}/apps`, documentId: "doc-5" });
    await flush();
    expect(b.sent).toEqual([{ tabId: 5, words: "signed-out", documentId: "doc-5" }]);
  });
  it("a hello before the bootstrap is answered once the background has attached (a delayed first answer)", async () => {
    const { w, b, m } = await started([{ id: 6, url: `${PROTECT}/` }]);
    b.hello({ id: "ext", tabId: 6, frameId: 0, url: `${PROTECT}/` });
    await flush();
    expect(b.sent).toEqual([]);
    m.attach(w.services);
    await flush();
    expect(lastWords(b, 6)).toBe("signed-out");
  });
  it("more hellos than it keeps, then the same words: every open Protect tab is told — the first too (round 13 PR-LOW-012)", async () => {
    const tabs = Array.from({ length: 52 }, (_x, i) => ({ id: 100 + i, url: `${PROTECT}/apps` }));
    const { w, b, m } = await started(tabs);
    w.status.set(USER, new BehaviorSubject<AuthenticationStatus>(AuthenticationStatus.Unlocked));
    m.attach(w.services);
    w.account.next({ id: USER });
    await flush();
    await m.idle();
    expect(lastWords(b, 100)).toBe("unlocked");
    // Hold the next PIN read, so every hello below waits for one answer…
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => (release = r));
    w.services.pinService.isPinSet = async () => {
      await held;
      return false;
    };
    b.sent.length = 0;
    for (const t of tabs) {
      b.hello({ id: "ext", tabId: t.id, frameId: 0, url: t.url, documentId: `doc-${t.id}` });
    }
    await flush();
    // …which then resolves to the SAME words as before (no change to broadcast).
    release();
    await flush();
    await m.idle();
    expect(lastWords(b, 100)).toBe("unlocked");
    expect(lastWords(b, 151)).toBe("unlocked");
    expect(new Set(b.sent.map((s) => s.tabId)).size).toBe(52);
  });
  it.each([
    ["its environment", "env"],
    ["its authentication status", "status"],
  ])("an account whose %s fails reads signed-out, and the next account still flows with no hello (round 14 PR-LOW-021)", async (_n, which) => {
    const { w, b, m } = await started();
    const broken = new BehaviorSubject<unknown>(null);
    if (which === "env") {
      w.envs.set(OTHER_USER, broken as unknown as BehaviorSubject<EnvironmentAddresses>);
    } else {
      w.status.set(OTHER_USER, broken as unknown as BehaviorSubject<AuthenticationStatus>);
    }
    w.status.set(USER, new BehaviorSubject<AuthenticationStatus>(AuthenticationStatus.Unlocked));
    m.attach(w.services);
    w.account.next({ id: OTHER_USER });
    await flush();
    broken.error(new Error("state not readable"));
    await flush();
    expect(lastWords(b, 1)).toBe("signed-out");
    // A healthy, unlocked Kount account, with no page hello in between.
    w.account.next({ id: USER });
    await flush();
    await m.idle();
    expect(lastWords(b, 1)).toBe("unlocked");
  });
  it("reads a PIN that cannot be read as not set", async () => {
    const { w, b, m } = await started();
    w.services.pinService.isPinSet = async () => {
      throw new Error("sdk not ready");
    };
    m.attach(w.services);
    w.account.next({ id: USER });
    await flush();
    expect(lastWords(b, 1)).toBe("locked");
  });
});

// ---- the real browser calls ------------------------------------------------------------------------------------------

describe("browserMarker — the registration (Decision 6)", () => {
  function chromeLike(opts: { existing?: boolean; registerThrows?: boolean; mv3?: boolean }) {
    const calls: string[] = [];
    const c: any = {
      runtime: { id: "ext", onMessage: { addListener: (): void => undefined }, lastError: undefined },
      tabs: { query: (_q: unknown, cb: (t: unknown[]) => void) => cb([]) },
    };
    if (opts.mv3 !== false) {
      c.scripting = {
        getRegisteredContentScripts: async (f: { ids: string[] }) => {
          expect(f).toEqual({ ids: [MARKER_SCRIPT_ID] });
          calls.push("get");
          return opts.existing ? [{ id: MARKER_SCRIPT_ID }] : [];
        },
        registerContentScripts: async (s: any[]) => {
          calls.push("register");
          if (opts.registerThrows) {
            throw new Error(`Duplicate script ID '${MARKER_SCRIPT_ID}'`);
          }
          expect(s).toEqual([
            {
              id: MARKER_SCRIPT_ID,
              matches: ["https://protect.kount.com.au/*"],
              js: [MARKER_FILE],
              runAt: "document_start",
              allFrames: false,
              persistAcrossSessions: true,
            },
          ]);
        },
        updateContentScripts: async () => {
          calls.push("update");
        },
      };
    }
    return { c, calls };
  }
  it("registers once on a first start", async () => {
    const { c, calls } = chromeLike({});
    await browserMarker(c, undefined)!.registerScript("https://protect.kount.com.au/*");
    expect(calls).toEqual(["get", "register"]);
  });
  it("updates an existing registration on a worker restart — never a duplicate", async () => {
    const { c, calls } = chromeLike({ existing: true });
    await browserMarker(c, undefined)!.registerScript("https://protect.kount.com.au/*");
    expect(calls).toEqual(["get", "update"]);
  });
  it("updates when a racing start registered it first", async () => {
    const { c, calls } = chromeLike({ registerThrows: true });
    await browserMarker(c, undefined)!.registerScript("https://protect.kount.com.au/*");
    expect(calls).toEqual(["get", "register", "update"]);
  });
  it("uses Firefox's contentScripts.register under Manifest V2", async () => {
    const { c } = chromeLike({ mv3: false });
    const registered: unknown[] = [];
    const b = { contentScripts: { register: async (o: unknown) => registered.push(o) } };
    await browserMarker(c, b)!.registerScript("https://protect.kount.com.au/*");
    expect(registered).toEqual([
      { matches: ["https://protect.kount.com.au/*"], js: [{ file: MARKER_FILE }], runAt: "document_start", allFrames: false },
    ]);
  });
  it("hears only its own command from its own extension", () => {
    let heard: (m: unknown, s: any) => void = () => undefined;
    const { c } = chromeLike({});
    c.runtime.onMessage.addListener = (f: any) => (heard = f);
    const got: MarkerSender[] = [];
    browserMarker(c, undefined)!.onHello((s) => got.push(s));
    heard({ command: "other" }, { id: "ext", tab: { id: 1 }, frameId: 0, url: `${PROTECT}/` });
    heard({ command: MARKER_HELLO }, { id: "another-extension", tab: { id: 1 }, frameId: 0, url: `${PROTECT}/` });
    heard({ command: MARKER_HELLO }, { id: "ext", tab: { id: 1 }, frameId: 0, url: `${PROTECT}/`, documentId: "d" });
    expect(got).toEqual([{ id: "ext", tabId: 1, frameId: 0, url: `${PROTECT}/`, documentId: "d" }]);
  });
});

describe("what the marker's files hold (Critical Constraint 3, Decision 7)", () => {
  const read = (name: string) => readFileSync(join(__dirname, name), "utf8");
  it("sends, stores and logs nothing: no fetch, no storage, no console", () => {
    for (const name of ["protect-marker.ts", "protect-marker.background.ts", "protect-marker.content.ts"]) {
      const text = read(name);
      expect(text).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|chrome\.storage|console\./);
    }
  });
  it("the content script reads Protect's origin from the build constants, its one source", () => {
    expect(read("protect-marker.content.ts")).toMatch(/startMarker\(window as any, KOUNT_PROTECT_ORIGIN, chrome\.runtime as any\)/);
  });
});
