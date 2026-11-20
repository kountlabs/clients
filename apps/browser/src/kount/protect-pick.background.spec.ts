// The pick hook's spec (plan Decision 7, T1.3: every Accept, Resolve, Choose and Act line, sign-in then continue, and
// edge cases E1–E4, E11, E13–E15, E23, E24). Run by upstream's jest inside build.sh's container, never on the host:
//   bash apps/kount-extension/build/build.sh --test --targets chrome
import { readFileSync } from "fs";
import { join } from "path";

import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { UserId } from "@bitwarden/common/types/guid";

import {
  PickDeps,
  ProtectPickBackground,
  RedirectDetails,
  accountTag,
  chooseLogin,
  readPickSignal,
  resolvePick,
} from "./protect-pick.background";

const PROTECT = "https://protect.kount.com.au";
const ACCOUNT = "aaaaaaaa-0001-4000-8000-000000000001";
const TILE = "11111111-2222-4333-8444-555555555555";
const launch = (query: string) => `${PROTECT}/tiles/${TILE}/launch?${query}`;
const redirect = (over: Partial<RedirectDetails> = {}): RedirectDetails => ({
  url: launch(`t=tok&a=${ACCOUNT}`),
  redirectUrl: "https://vendor.example/login",
  statusCode: 303,
  type: "main_frame",
  ...over,
});

describe("readPickSignal — Accept", () => {
  it("accepts an off-origin 303 from the launch route with one uuid a", () => {
    expect(readPickSignal(redirect(), PROTECT)).toEqual({ accountUuid: ACCOUNT, target: "https://vendor.example/login" });
  });
  it.each([
    ["a sign-in bounce to Protect's own /auth/login (E14)", { redirectUrl: `${PROTECT}/auth/login` }],
    [
      "a sign-in bounce carrying the launch's query (signInHref, E14)",
      { redirectUrl: `${PROTECT}/auth/login?tile=${TILE}&t=tok&a=${ACCOUNT}&d=1` },
    ],
    ["a refused launch (400, E14)", { statusCode: 400 }],
    ["a tile that is gone (404)", { statusCode: 404 }],
    ["a status other than 303", { statusCode: 302 }],
    ["a 301", { statusCode: 301 }],
    ["a sub-frame", { type: "sub_frame" }],
    ["another origin's launch path", { url: `https://protect.kount.com.au.evil.example/tiles/${TILE}/launch?a=${ACCOUNT}` }],
    ["Protect on another port", { url: `https://protect.kount.com.au:8443/tiles/${TILE}/launch?a=${ACCOUNT}` }],
    ["a path that is not a launch", { url: `${PROTECT}/tiles/${TILE}?a=${ACCOUNT}` }],
    ["a tile-level launch with no a (E4)", { url: launch("t=tok") }],
    ["two a values", { url: launch(`a=${ACCOUNT}&a=${ACCOUNT}`) }],
    ["an a that is not a uuid", { url: launch("a=kp:acct:aaaaaaaa-0001") }],
    ["a target that is not http(s)", { redirectUrl: "javascript:alert(1)" }],
    ["a target that does not parse", { redirectUrl: "::" }],
    ["the sign-in callback's 303 on to the launch", { url: `${PROTECT}/auth/callback?code=c&state=s`, redirectUrl: launch(`t=new&a=${ACCOUNT}`) }],
    ["http Protect when the build says https", { url: `http://protect.kount.com.au/tiles/${TILE}/launch?a=${ACCOUNT}` }],
  ])("refuses %s", (_name, over) => {
    expect(readPickSignal(redirect(over as Partial<RedirectDetails>), PROTECT)).toBeNull();
  });
  it("accepts a launch with an app position d (E5) and reads a in any case, lower-cased", () => {
    const upper = ACCOUNT.toUpperCase();
    expect(readPickSignal(redirect({ url: launch(`t=tok&a=${upper}&d=2`) }), PROTECT)).toEqual({
      accountUuid: ACCOUNT,
      target: "https://vendor.example/login",
    });
  });
});

describe("accountTag", () => {
  it("is kp:acct: plus the first 13 characters, lower case", () => {
    expect(accountTag("AAAAAAAA-0001-4000-8000-000000000001")).toBe("kp:acct:aaaaaaaa-0001");
  });
});

describe("chooseLogin — Choose", () => {
  it("takes the only candidate", () => expect(chooseLogin(["b"], null, {})).toBe("b"));
  it("takes nothing from nothing", () => expect(chooseLogin([], null, {})).toBeNull());
  it("keeps the URL matches when any (E2)", () => expect(chooseLogin(["a", "b"], ["b"], { a: 9 })).toBe("b"));
  it("ignores a match list that keeps none", () => expect(chooseLogin(["a", "b"], ["z"], { b: 5 })).toBe("b"));
  it("then the most recently used", () => expect(chooseLogin(["a", "b", "c"], null, { a: 1, c: 3 })).toBe("c"));
  it("then the lowest id", () => expect(chooseLogin(["c", "b"], null, {})).toBe("b"));
});

const USER = "user-1" as UserId;
function deps(over: Partial<PickDeps> = {}, marks: string[] = []): PickDeps {
  return {
    activeUserId: async () => USER,
    status: async () => AuthenticationStatus.Unlocked,
    collections: async () => [
      { id: "col-a", externalId: accountTag(ACCOUNT) },
      { id: "col-x", externalId: "kp:acct:bbbbbbbb-0002" },
    ],
    ciphers: async () => ({
      i1: { id: "i1", type: 1, collectionIds: ["col-a"] },
      i2: { id: "i2", type: 1, collectionIds: ["col-x"] },
    }),
    matchingIds: async () => ["i1", "i2"],
    lastUsed: async () => ({}),
    mark: async (id) => {
      marks.push(id);
    },
    ...over,
  };
}
const signal = { accountUuid: ACCOUNT, target: "https://vendor.example/login" };

describe("resolvePick — Resolve and Act", () => {
  it("marks the one login of the tagged collection", async () => {
    const marks: string[] = [];
    expect(await resolvePick(signal, deps({}, marks))).toBe("i1");
    expect(marks).toEqual(["i1"]);
  });
  it("still marks a one-login collection while locked (E1)", async () => {
    const marks: string[] = [];
    const matchingIds = jest.fn();
    await resolvePick(signal, deps({ status: async () => AuthenticationStatus.Locked, matchingIds }, marks));
    expect(marks).toEqual(["i1"]);
    expect(matchingIds).not.toHaveBeenCalled();
  });
  it("does nothing signed out (E1)", async () => {
    const marks: string[] = [];
    await resolvePick(signal, deps({ status: async () => AuthenticationStatus.LoggedOut }, marks));
    expect(marks).toEqual([]);
  });
  it("does nothing with no active account", async () => {
    expect(await resolvePick(signal, deps({ activeUserId: async () => null }))).toBeNull();
  });
  it("does nothing when the collection is not in the vault (E3, E15)", async () => {
    expect(await resolvePick({ ...signal, accountUuid: "cccccccc-0003-4000-8000-000000000003" }, deps())).toBeNull();
  });
  it("does nothing when two collections carry the tag", async () => {
    const collections = async () => [
      { id: "col-a", externalId: accountTag(ACCOUNT) },
      { id: "col-b", externalId: accountTag(ACCOUNT) },
    ];
    expect(await resolvePick(signal, deps({ collections }))).toBeNull();
  });
  it("skips deleted items and other types", async () => {
    const ciphers = async () => ({
      d: { id: "d", type: 1, collectionIds: ["col-a"], deletedDate: "2026-11-01" },
      n: { id: "n", type: 2, collectionIds: ["col-a"] },
    });
    expect(await resolvePick(signal, deps({ ciphers }))).toBeNull();
  });
  it("prefers the URL match among several, unlocked (E2)", async () => {
    const ciphers = async () => ({
      p: { id: "p", type: 1, collectionIds: ["col-a"] },
      q: { id: "q", type: 1, collectionIds: ["col-a"] },
    });
    expect(await resolvePick(signal, deps({ ciphers, matchingIds: async () => ["q"] }))).toBe("q");
  });
  it("marks a picked item that will not fill on page load like any other: upstream's rule still decides (E11)", async () => {
    // A master-password re-prompt or "do not autofill on page load" is upstream's to honour at fill time; the hook
    // reads neither and changes neither — it only marks.
    const marks: string[] = [];
    const ciphers = async () => ({ r: { id: "r", type: 1, collectionIds: ["col-a"], reprompt: 1 } });
    expect(await resolvePick(signal, deps({ ciphers }, marks))).toBe("r");
    expect(marks).toEqual(["r"]);
  });
  it("among several, locked, takes the most recently used without asking for URL matches (E1, E2)", async () => {
    const matchingIds = jest.fn();
    const ciphers = async () => ({
      p: { id: "p", type: 1, collectionIds: ["col-a"] },
      q: { id: "q", type: 1, collectionIds: ["col-a"] },
    });
    const status = async () => AuthenticationStatus.Locked;
    expect(await resolvePick(signal, deps({ ciphers, status, matchingIds, lastUsed: async () => ({ p: 5 }) }))).toBe("p");
    expect(matchingIds).not.toHaveBeenCalled();
  });
  it("does nothing for a collection that holds no login (E2)", async () => {
    const ciphers = async () => ({ x: { id: "x", type: 1, collectionIds: ["col-x"] } });
    expect(await resolvePick(signal, deps({ ciphers }))).toBeNull();
  });
  it("acts for no one when the active account changes mid-resolve (E13)", async () => {
    const marks: string[] = [];
    let calls = 0;
    const activeUserId = async () => (calls++ === 0 ? USER : ("user-2" as UserId));
    expect(await resolvePick(signal, deps({ activeUserId }, marks))).toBeNull();
    expect(marks).toEqual([]);
  });
});

describe("ProtectPickBackground — the listener", () => {
  function fakeWebRequest() {
    const listeners: ((d: RedirectDetails) => void)[] = [];
    const filters: unknown[] = [];
    return {
      listeners,
      filters,
      onBeforeRedirect: {
        addListener: (cb: (d: RedirectDetails) => void, filter: unknown) => {
          listeners.push(cb);
          filters.push(filter);
        },
      },
    };
  }
  it("registers on Protect's host, main frame only", () => {
    const wr = fakeWebRequest();
    ProtectPickBackground.listen(wr, PROTECT);
    expect(wr.filters).toEqual([{ urls: ["https://protect.kount.com.au/tiles/*"], types: ["main_frame"] }]);
  });
  it("holds a launch heard before attach, then acts on it (E9)", async () => {
    const wr = fakeWebRequest();
    const hook = ProtectPickBackground.listen(wr, PROTECT);
    wr.listeners[0](redirect());
    const marks: string[] = [];
    hook.attach(deps({}, marks));
    await hook.idle();
    expect(marks).toEqual(["i1"]);
  });
  it("drops a held launch older than 30 seconds", async () => {
    const wr = fakeWebRequest();
    let t = 0;
    const hook = ProtectPickBackground.listen(wr, PROTECT, () => t);
    wr.listeners[0](redirect());
    t = 30001;
    const marks: string[] = [];
    hook.attach(deps({}, marks));
    await hook.idle();
    expect(marks).toEqual([]);
  });
  it("holds at most 20 launches before attach, the newest", async () => {
    const wr = fakeWebRequest();
    const hook = ProtectPickBackground.listen(wr, PROTECT);
    for (let i = 0; i < 25; i++) wr.listeners[0](redirect());
    const marks: string[] = [];
    hook.attach(deps({}, marks));
    await hook.idle();
    expect(marks).toHaveLength(20);
  });
  it("marks two picks in the order heard (E24: the later pick is the later write)", async () => {
    const wr = fakeWebRequest();
    const hook = ProtectPickBackground.listen(wr, PROTECT);
    const marks: string[] = [];
    hook.attach(deps({}, marks));
    wr.listeners[0](redirect());
    wr.listeners[0](redirect({ url: launch("a=bbbbbbbb-0002-4000-8000-000000000002") }));
    await hook.idle();
    expect(marks).toEqual(["i1", "i2"]);
  });
  it("ignores a refused launch and a sign-in bounce (E14)", async () => {
    const wr = fakeWebRequest();
    const hook = ProtectPickBackground.listen(wr, PROTECT);
    const marks: string[] = [];
    hook.attach(deps({}, marks));
    wr.listeners[0](redirect({ redirectUrl: `${PROTECT}/auth/login` }));
    wr.listeners[0](redirect({ statusCode: 400 }));
    wr.listeners[0](redirect({ statusCode: 404 }));
    await hook.idle();
    expect(marks).toEqual([]);
  });
  it("sign in, then continue: the bounce changes nothing, the launch after the sign-in marks once (E7)", async () => {
    const wr = fakeWebRequest();
    const hook = ProtectPickBackground.listen(wr, PROTECT);
    const marks: string[] = [];
    hook.attach(deps({}, marks));
    // The idle click: Protect's own sign-in start, carrying the launch's query.
    wr.listeners[0](redirect({ redirectUrl: `${PROTECT}/auth/login?tile=${TILE}&t=tok&a=${ACCOUNT}` }));
    await hook.idle();
    expect(marks).toEqual([]);
    // Kount ID's callback sends the browser on to the NEW session's launch link (no signal), which answers the vendor.
    wr.listeners[0](redirect({ url: `${PROTECT}/auth/callback?code=c`, redirectUrl: launch(`t=new&a=${ACCOUNT}`) }));
    wr.listeners[0](redirect({ url: launch(`t=new&a=${ACCOUNT}`) }));
    await hook.idle();
    expect(marks).toEqual(["i1"]);
  });
  it("a mark that throws is dropped quietly and the next launch still marks", async () => {
    const wr = fakeWebRequest();
    const hook = ProtectPickBackground.listen(wr, PROTECT);
    const marks: string[] = [];
    let first = true;
    const mark = async (id: string) => {
      if (first) {
        first = false;
        throw new Error("storage busy");
      }
      marks.push(id);
    };
    hook.attach(deps({ mark }));
    wr.listeners[0](redirect());
    wr.listeners[0](redirect());
    await hook.idle();
    expect(marks).toEqual(["i1"]);
  });
  it("registers nothing when the browser has no webRequest or the origin does not parse", () => {
    expect(() => ProtectPickBackground.listen(undefined, PROTECT)).not.toThrow();
    const wr = fakeWebRequest();
    ProtectPickBackground.listen(wr, "not an origin");
    expect(wr.filters).toEqual([]);
  });
});

// Critical Constraint 7, held on the source: the hook imports only what reads, opens no connection, writes nothing of its
// own, logs nothing, and its one mutating call is updateLastLaunchedDate.
describe("the hook's source", () => {
  // The RAW source is scanned (no comment stripping, which could hide code after a "//" inside a string): the file's own
  // comments are written so that none of the patterns below occurs in them.
  const code = readFileSync(join(__dirname, "protect-pick.background.ts"), "utf8");
  it("imports rxjs and three read-only common modules, nothing else, in any form", () => {
    const modules = [...code.matchAll(/\bfrom\s*"([^"]+)"/g)].map((m) => m[1]).sort();
    expect(modules).toEqual([
      "@bitwarden/common/auth/enums/authentication-status",
      "@bitwarden/common/types/guid",
      "@bitwarden/common/vault/enums",
      "rxjs",
    ]);
    // Every import or export statement names its module with `from`: no bare `import "x"`, no `export * from`.
    expect(code.match(/^\s*(import|export)\b[^\n]*"[^"]+"/gm)?.every((l) => /\bfrom\s*"/.test(l)) ?? true).toBe(true);
    expect(code).not.toMatch(/\bimport\s*\(|\brequire\s*\(|^\s*export\s*\*/m);
  });
  it.each([
    ["a connection", /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|connectNative|sendNativeMessage)\b/],
    ["a message to another context", /\b(sendMessage|postMessage|runtime\.connect)\b/],
    ["a logger or the console", /\b(console|logService|LogService)\b|\.(log|info|warn|error|debug)\(/],
    ["state of its own", /\b(localStorage|sessionStorage|indexedDB|storage\.|setItem|stateProvider)\b/],
    ["a fill", /\b(doAutoFill|autofillService|fillCipher|collectPageDetails)\b/],
    ["a browser API of its own (the caller hands it webRequest)", /\b(chrome|browser|BrowserApi)\s*\./],
  ])("holds no %s", (_what, pattern) => {
    expect(code).not.toMatch(pattern);
  });
  it("calls two service methods, and the one that writes is updateLastLaunchedDate", () => {
    // Any `<x>Service.<method>(` call; the observables (`activeAccount$`, `authStatusFor$(…)`, `encryptedCollections$(…)`,
    // `ciphers$(…)`, `localData$(…)`) are reads and end in `$`, which `\w` does not match.
    const calls = [...code.matchAll(/Service\.(\w+)\(/g)].map((m) => m[1]).sort();
    expect(calls).toEqual(["getAllDecryptedForUrl", "updateLastLaunchedDate"]);
    const observed = [...code.matchAll(/Service\.(\w+\$)/g)].map((m) => m[1]).sort();
    expect(observed).toEqual(["activeAccount$", "authStatusFor$", "ciphers$", "encryptedCollections$", "localData$"]);
  });
});

// E23 and E17, held on upstream's own method: patch 0008 makes a launch clear the per-URL sorted login list, so a pick made
// within its 3-second cache is the one the next fill reads. A rebase that moves or rewrites the method fails here.
describe("0008 — a launch clears the sorted-login cache (E23)", () => {
  const service = readFileSync(join(__dirname, "../../../../libs/common/src/vault/services/cipher.service.ts"), "utf8");
  const start = service.indexOf("async updateLastLaunchedDate(");
  const body = start < 0 ? "" : service.slice(start, service.indexOf("\n  }\n", start));
  it("writes both stamps, then clears the sorted ciphers", () => {
    expect(start).toBeGreaterThan(0);
    const write = body.indexOf("{ lastLaunched: currentTime, lastUsedDate: currentTime }");
    const clear = body.indexOf("this.clearSortedCiphers();");
    expect(write).toBeGreaterThan(0);
    expect(clear).toBeGreaterThan(write);
  });
});
