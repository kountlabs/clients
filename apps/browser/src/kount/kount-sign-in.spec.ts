// The Kount sign-in's spec (sign-in-lock-and-look Decision 1, T1.3; E2, E24, E31, E41, E47, E54). Run by upstream's
// jest inside build.sh's container, never on the host:
//   bash apps/kount-extension/build/build.sh --test --targets chrome
// The rules are pure (kount-sign-in.ts); the second half reads the PATCHED upstream files of the applied tree to hold
// them to calling the rules where Decision 1 says — before the hand-off opens a tab, and before the code is redeemed.
import { readFileSync } from "fs";
import { join } from "path";

import { TestBed } from "@angular/core/testing";
import { MockProxy, mock } from "jest-mock-extended";
import { BehaviorSubject, Observable, throwError } from "rxjs";

import { DefaultLoginComponentService, SsoComponent } from "@bitwarden/auth/angular";
import { SsoUrlService } from "@bitwarden/auth/common";
import { SsoLoginServiceAbstraction } from "@bitwarden/common/auth/abstractions/sso-login.service.abstraction";
import { ClientType } from "@bitwarden/common/enums";
import {
  Environment,
  EnvironmentService,
} from "@bitwarden/common/platform/abstractions/environment.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { Utils } from "@bitwarden/common/platform/misc/utils";
import { PasswordGenerationServiceAbstraction } from "@bitwarden/generator-legacy";
// eslint-disable-next-line no-restricted-imports
import { CryptoFunctionService } from "@bitwarden/legacy-crypto";

import { ExtensionLoginComponentService } from "../auth/popup/login/extension-login-component.service";
import { BrowserPlatformUtilsService } from "../platform/services/platform-utils/browser-platform-utils.service";
import { ExtensionAnonLayoutWrapperDataService } from "../popup/components/extension-anon-layout-wrapper/extension-anon-layout-wrapper-data.service";

import { KOUNT_SSO_IDENTIFIER, KOUNT_VAULT_BASE } from "./build-constants"; // the identifier: isKountStart, the hand-off
import { EnvironmentAddresses } from "./kount-environment";
import { isKountReturn, isKountStart, kountHandOffRefused, kountReturnRefused } from "./kount-sign-in";

// As upstream's own spec of the service does (extension-login-component.service.spec.ts).
jest.mock("../platform/flags", () => ({
  flagEnabled: jest.fn(),
}));

function env(base: string, over: Partial<{ webVault: string; api: string; identity: string }> = {}): EnvironmentAddresses {
  return {
    getWebVaultUrl: () => over.webVault ?? base,
    getApiUrl: () => over.api ?? `${base}/api`,
    getIdentityUrl: () => over.identity ?? `${base}/identity`,
  };
}
const KOUNT = env(KOUNT_VAULT_BASE);
const OTHER = env("https://vault.example.com");
const MIXED_IDENTITY = env(KOUNT_VAULT_BASE, { identity: "https://id.example.com" });
const MIXED_WEB = env(KOUNT_VAULT_BASE, { webVault: "https://vault.example.com" });

describe("isKountStart", () => {
  it("is the fixed identifier with no e-mail", () => {
    expect(isKountStart(KOUNT_SSO_IDENTIFIER, "")).toBe(true);
    expect(isKountStart(KOUNT_SSO_IDENTIFIER, null)).toBe(true);
    expect(isKountStart(KOUNT_SSO_IDENTIFIER, undefined)).toBe(true);
  });
  it("is never upstream's own single sign-on, which always carries an e-mail (E31)", () => {
    expect(isKountStart(KOUNT_SSO_IDENTIFIER, "person@example.com")).toBe(false);
    expect(isKountStart("acme", "")).toBe(false);
    expect(isKountStart(undefined, "")).toBe(false);
  });
});

describe("kountHandOffRefused — the hand-off (E47)", () => {
  it("hands a Kount start off in a Kount environment", () => {
    expect(kountHandOffRefused(KOUNT_SSO_IDENTIFIER, "", KOUNT)).toBe(false);
  });
  it.each([
    ["another server (the selection changed after the press, or another server's account is active)", OTHER],
    ["Kount's base with another identity address (E41)", MIXED_IDENTITY],
    ["Kount's base with another web vault (E41)", MIXED_WEB],
    ["no environment", null],
  ])("refuses a Kount start in %s — the fixed identifier never leaves a Kount environment", (_name, e) => {
    expect(kountHandOffRefused(KOUNT_SSO_IDENTIFIER, "", e)).toBe(true);
  });
  it("never refuses ordinary single sign-on on another server (E31)", () => {
    expect(kountHandOffRefused("acme", "person@example.com", OTHER)).toBe(false);
    expect(kountHandOffRefused(undefined, "person@example.com", OTHER)).toBe(false);
  });
});

describe("kountReturnRefused — the return (E54)", () => {
  // The return of a Kount start is recognised by its empty saved e-mail alone, whatever the state the vault hands back
  // carries (review round 7 MED-001) — so no identifier is passed here.
  it("lets an unchanged Kount sign-in redeem its code", () => {
    expect(kountReturnRefused("", KOUNT, KOUNT)).toBe(false);
    expect(kountReturnRefused(null, KOUNT, KOUNT)).toBe(false);
  });
  it.each([
    ["the identity address changed after the tab opened", KOUNT, MIXED_IDENTITY],
    ["the environment in force is another server", KOUNT, OTHER],
    ["the selection is another server", OTHER, KOUNT],
    ["no environment in force", KOUNT, null],
  ])("refuses a Kount start when %s — no token request, the code and verifier go nowhere", (_name, selected, inForce) => {
    expect(kountReturnRefused("", selected, inForce)).toBe(true);
    expect(kountReturnRefused(undefined, selected, inForce)).toBe(true);
  });
  it("lets an ordinary single sign-on on another server complete — an e-mail was saved (E31)", () => {
    expect(kountReturnRefused("person@example.com", OTHER, OTHER)).toBe(false);
    expect(kountReturnRefused("person@example.com", MIXED_IDENTITY, MIXED_IDENTITY)).toBe(false);
  });
});

// ---- the patched hand-off, run (patch 0005; round 13 PR-MED-069) ----------------------------------------------------
// The service the button calls, built as upstream's own spec builds it, with every dependency a stub: what it launches,
// what it builds and what it clears are observed — not where the call sits in its text. Synthetic values only.

describe("the patched hand-off, run (E47)", () => {
  let service: ExtensionLoginComponentService;
  let environmentService: MockProxy<EnvironmentService>;
  let passwordGenerationService: MockProxy<PasswordGenerationServiceAbstraction>;
  let platformUtilsService: MockProxy<BrowserPlatformUtilsService>;
  let ssoLoginService: MockProxy<SsoLoginServiceAbstraction>;
  let ssoUrlService: MockProxy<SsoUrlService>;

  function build(inForce: EnvironmentAddresses): void {
    const cryptoFunctionService = mock<CryptoFunctionService>();
    environmentService = mock<EnvironmentService>();
    passwordGenerationService = mock<PasswordGenerationServiceAbstraction>();
    platformUtilsService = mock<BrowserPlatformUtilsService>();
    ssoLoginService = mock<SsoLoginServiceAbstraction>();
    ssoUrlService = mock<SsoUrlService>();
    const layout = mock<ExtensionAnonLayoutWrapperDataService>();
    environmentService.environment$ = new BehaviorSubject<Environment>(inForce as unknown as Environment);
    platformUtilsService.getClientType.mockReturnValue(ClientType.Browser);
    passwordGenerationService.generatePassword.mockResolvedValue("synthetic-value");
    jest
      .spyOn(Utils as { fromArrayToUrlB64: (arr: Uint8Array) => string }, "fromArrayToUrlB64")
      .mockReturnValue("synthetic-challenge");
    ssoUrlService.buildSsoUrl.mockReturnValue("https://synthetic.invalid/#/sso");
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ExtensionLoginComponentService,
          useFactory: () =>
            new ExtensionLoginComponentService(
              cryptoFunctionService,
              environmentService,
              passwordGenerationService,
              platformUtilsService,
              ssoLoginService,
              layout,
              ssoUrlService,
            ),
        },
        { provide: DefaultLoginComponentService, useExisting: ExtensionLoginComponentService },
        { provide: CryptoFunctionService, useValue: cryptoFunctionService },
        { provide: EnvironmentService, useValue: environmentService },
        { provide: PasswordGenerationServiceAbstraction, useValue: passwordGenerationService },
        { provide: PlatformUtilsService, useValue: platformUtilsService },
        { provide: SsoLoginServiceAbstraction, useValue: ssoLoginService },
        { provide: ExtensionAnonLayoutWrapperDataService, useValue: layout },
        { provide: SsoUrlService, useValue: ssoUrlService },
      ],
    });
    service = TestBed.inject(ExtensionLoginComponentService);
  }

  it("a Kount start in a Kount environment builds the Kount address with no e-mail and opens it once", async () => {
    build(KOUNT);
    await service.redirectToSsoLoginWithOrganizationSsoIdentifier("", KOUNT_SSO_IDENTIFIER);
    expect(ssoUrlService.buildSsoUrl).toHaveBeenCalledTimes(1);
    const args = ssoUrlService.buildSsoUrl.mock.calls[0];
    expect(args[0]).toBe(KOUNT_VAULT_BASE);
    expect(args[5]).toBe("");
    expect(args[6]).toBe(KOUNT_SSO_IDENTIFIER);
    expect(platformUtilsService.launchUri).toHaveBeenCalledTimes(1);
    expect(ssoLoginService.setCodeVerifier).not.toHaveBeenCalledWith("");
    expect(ssoLoginService.setSsoState).not.toHaveBeenCalledWith("");
  });
  it.each([
    ["another server in force", OTHER],
    ["Kount's base with another identity address", MIXED_IDENTITY],
    ["Kount's base with another web vault", MIXED_WEB],
  ])("a Kount start with %s opens NOTHING, builds nothing and drops the saved state and verifier", async (_n, e) => {
    build(e);
    await service.redirectToSsoLoginWithOrganizationSsoIdentifier("", KOUNT_SSO_IDENTIFIER);
    expect(ssoUrlService.buildSsoUrl).not.toHaveBeenCalled();
    expect(platformUtilsService.launchUri).not.toHaveBeenCalled();
    expect(ssoLoginService.setCodeVerifier).toHaveBeenLastCalledWith("");
    expect(ssoLoginService.setSsoState).toHaveBeenLastCalledWith("");
  });
  it("ordinary single sign-on on another server is handed off unchanged (E31)", async () => {
    build(OTHER);
    await service.redirectToSsoLoginWithOrganizationSsoIdentifier("person@example.com", "acme");
    expect(ssoUrlService.buildSsoUrl).toHaveBeenCalledTimes(1);
    const args = ssoUrlService.buildSsoUrl.mock.calls[0];
    expect(args[0]).toBe("https://vault.example.com");
    expect(args[5]).toBe("person@example.com");
    expect(args[6]).toBe("acme");
    expect(platformUtilsService.launchUri).toHaveBeenCalledTimes(1);
    expect(ssoLoginService.setCodeVerifier).not.toHaveBeenCalledWith("");
  });
});

// ---- the patched return guard, run (patch 0005; round 14 PR-LOW-020) ------------------------------------------------
// The component's own `refuseKountReturn`, called on a stand-in holding only what it uses (the environment, toast, i18n
// and router stubs): an ordinary return reads nothing of Kount's, and a Kount return that cannot read its environments
// is refused with the way back.

describe("the patched return guard, run (E54)", () => {
  type Guard = (savedEmail: string | null | undefined) => Promise<boolean>;
  const guard = (SsoComponent.prototype as unknown as { refuseKountReturn: Guard }).refuseKountReturn;
  function standIn(selected: Observable<EnvironmentAddresses>, inForce: Observable<EnvironmentAddresses>) {
    return {
      environmentService: { globalEnvironment$: selected, environment$: inForce },
      toastService: { showToast: jest.fn() },
      i18nService: { t: (key: string) => key },
      router: { navigate: jest.fn().mockResolvedValue(true) },
    };
  }
  const failing = () => throwError(() => new Error("state not readable"));

  it("an ordinary return goes on without reading either environment (E31)", async () => {
    const s = standIn(failing(), failing());
    await expect(guard.call(s, "person@example.com")).resolves.toBe(false);
    expect(s.router.navigate).not.toHaveBeenCalled();
    expect(s.toastService.showToast).not.toHaveBeenCalled();
  });
  it("a Kount return with both environments Kount's goes on", async () => {
    const s = standIn(new BehaviorSubject(KOUNT), new BehaviorSubject(KOUNT));
    await expect(guard.call(s, "")).resolves.toBe(false);
    expect(s.router.navigate).not.toHaveBeenCalled();
  });
  it.each([
    ["the selected environment cannot be read", () => failing(), () => new BehaviorSubject(KOUNT)],
    ["the environment in force cannot be read", () => new BehaviorSubject(KOUNT), () => failing()],
    ["another server is in force", () => new BehaviorSubject(KOUNT), () => new BehaviorSubject(OTHER)],
  ])("a Kount return is refused, with the toast and the way back, when %s", async (_n, selected, inForce) => {
    const s = standIn(selected(), inForce());
    await expect(guard.call(s, "")).resolves.toBe(true);
    expect(s.toastService.showToast).toHaveBeenCalledTimes(1);
    expect(s.router.navigate).toHaveBeenCalledWith(["/login"]);
  });
  it("classifies by the saved e-mail alone", () => {
    expect(isKountReturn("")).toBe(true);
    expect(isKountReturn(null)).toBe(true);
    expect(isKountReturn(undefined)).toBe(true);
    expect(isKountReturn("person@example.com")).toBe(false);
  });
});

// ---- the patched upstream files (patch 0005), read as text from the applied tree ------------------------------------

const TREE = join(__dirname, "..", "..", "..", "..");
const read = (path: string) => readFileSync(join(TREE, path), "utf8");

/** Where `needle` first occurs in `text` — and it MUST occur: an absent site (-1) would sort before anything (PR-MED-069). */
function at(text: string, needle: string): number {
  const i = text.indexOf(needle);
  expect(i).toBeGreaterThan(-1);
  return i;
}

describe("where the patched sign-in calls the rules (Decision 1)", () => {
  // The hand-off's behaviour is run above; its text is held only to the environment being read at the hand-off itself.
  it("the hand-off reads the environment in force at the hand-off and refuses before it builds or opens anything", () => {
    const text = read("apps/browser/src/auth/popup/login/extension-login-component.service.ts");
    const refused = at(text, "if (kountHandOffRefused(orgSsoIdentifier, email, env)) {");
    expect(refused).toBeGreaterThan(at(text, "const env = await firstValueFrom(this.environmentService.environment$);"));
    expect(refused).toBeLessThan(at(text, "buildSsoUrl("));
    expect(refused).toBeLessThan(at(text, "launchUri("));
  });
  it("the return refuses after the verifier and state are cleared and before the code is redeemed", () => {
    const text = read("libs/auth/src/angular/sso/sso.component.ts");
    const start = at(text, "private async handleTokenRequestForAuthenticatedUser(");
    const body = text.slice(start, text.indexOf("\n  }\n", start));
    const refused = at(body, "await this.refuseKountReturn(");
    expect(refused).toBeGreaterThan(at(body, 'setCodeVerifier("")'));
    expect(refused).toBeGreaterThan(at(body, 'setSsoState("")'));
    expect(refused).toBeLessThan(at(body, "await this.logIn("));
    expect(body.slice(refused)).toMatch(/^await this\.refuseKountReturn\(savedSsoEmail\)\) \{\s*return;\s*\}/);
    // The refusal reads the e-mail the extension saved at the start, never the state's identifier (round 7 MED-001) —
    // read with this attempt's verifier and state, BEFORE they are cleared (round 11 PR-HIGH-032).
    // An unreadable e-mail counts as none, so the cleanup still runs (round 15 PR-LOW-025).
    const emailRead = at(body, "const savedSsoEmail = await this.ssoLoginService.getSsoEmail().catch((): null => null);");
    expect(emailRead).toBeGreaterThan(at(body, "await this.ssoLoginService.getSsoState()"));
    expect(emailRead).toBeLessThan(at(body, 'setCodeVerifier("")'));
    const method = text.slice(text.indexOf("private async refuseKountReturn("));
    // The guard reads the saved e-mail first (round 14 PR-LOW-020), then the rule with it.
    const guardBody = method.slice(0, at(method, "\n  }\n"));
    expect(at(guardBody, "if (!isKountReturn(savedEmail)) {")).toBeLessThan(at(guardBody, "refused = kountReturnRefused(\n        savedEmail,"));
  });
  it("the screen starts the Kount sign-in with the fixed identifier and no e-mail, and keeps the e-mail path", () => {
    const ts = read("libs/auth/src/angular/login/login.component.ts");
    expect(ts).toContain('redirectToSsoLoginWithOrganizationSsoIdentifier("", KOUNT_SSO_IDENTIFIER)');
    const html = read("libs/auth/src/angular/login/login.component.html");
    expect(html).toContain('data-testid="kount-use-email-link"');
    expect(html).toContain('[ngClass]="{ \'tw-hidden\': kountOnly }" data-testid="kount-email-entry"');
    // Kount ID is named only on the Kount screen; any other server keeps upstream's label (round 11 PR-LOW-004).
    expect(html).toContain('{{ (kountScreen ? "kountSignInWithKountId" : "useSingleSignOn") | i18n }}');
  });
  it("the Kount screen needs BOTH the selected and the in-force environment to be Kount's (round 11 PR-MED-060)", () => {
    const ts = read("libs/auth/src/angular/login/login.component.ts");
    expect(ts).toContain("combineLatest([this.environmentService.globalEnvironment$, this.environmentService.environment$])");
    expect(ts).toContain("this.kountScreen = isKountEnvironment(selected) && isKountEnvironment(inForce);");
  });
  it("a view destroyed during its first reads subscribes to nothing, and its focus stays inside it (round 13 PR-LOW-013)", () => {
    const ts = read("libs/auth/src/angular/login/login.component.ts");
    const init = ts.slice(at(ts, "private async defaultOnInit("));
    // The screen is decided after the remembered e-mail is read (so a remembered e-mail never flashes the Kount-only
    // screen), and only by a view still alive.
    const guarded = at(init, "if (!this.kountGone) {\n      combineLatest([this.environmentService.globalEnvironment$");
    expect(guarded).toBeGreaterThan(at(init, "await this.loadRememberedEmail();"));
    // A deferred focus looks only inside this component, and only while it lives; nothing Kount adds searches the page.
    const focus = ts.slice(at(ts, "private kountFocus("));
    const body = focus.slice(0, at(focus, "\n  }\n"));
    expect(body).toContain("if (this.kountGone) {");
    expect(body).toContain("host.querySelector<HTMLElement>(selector)?.focus();");
    expect(ts).not.toMatch(/document\.(querySelector|getElementById)/);
    const destroy = ts.slice(at(ts, "ngOnDestroy(): void {"));
    expect(at(destroy, "this.kountGone = true;")).toBeLessThan(at(destroy, "this.destroy$.next();"));
  });
  it("no readiness gate: nothing waits for the first reads before upstream's screen shows (round 14 PR-REG-002, -003)", () => {
    const html = read("libs/auth/src/angular/login/login.component.html");
    expect(html).toContain("<div [ngClass]=\"{ 'tw-hidden': loginUiState !== LoginUiState.EMAIL_ENTRY }\">");
    expect(html).not.toContain("tw-invisible");
    const ts = read("libs/auth/src/angular/login/login.component.ts");
    expect(ts).not.toMatch(/kountReady|kountSettle|kountEnvKnown|kountEmailKnown/);
  });
  it("an automatic focus never takes it from another control the person chose (round 14 PR-REG-004)", () => {
    const ts = read("libs/auth/src/angular/login/login.component.ts");
    const focus = ts.slice(at(ts, "private kountFocus("));
    const body = focus.slice(0, at(focus, "\n  }\n"));
    expect(at(body, "if (auto && active != null && active !== host.ownerDocument.body && !host.contains(active)) {")).toBeLessThan(
      at(body, "host.querySelector<HTMLElement>(selector)?.focus();"),
    );
    // The move into the Kount-only screen is automatic; the link's move to the e-mail box is explicit.
    expect(ts).toContain("this.kountFocus('[data-testid=\"login-sso-button\"]', true);");
    expect(ts).toContain('this.kountFocus("#email");');
  });
  it("the screen's subscription: a typed address stays shown, and an error falls back to upstream's screen (round 15 PR-LOW-026, -027)", () => {
    const ts = read("libs/auth/src/angular/login/login.component.ts");
    const init = ts.slice(at(ts, "private async defaultOnInit("));
    const sub = init.slice(at(init, "combineLatest([this.environmentService.globalEnvironment$"));
    const decided = at(sub, "this.kountScreen = isKountEnvironment(selected) && isKountEnvironment(inForce);");
    const kept = at(sub, "if (this.kountScreen && this.emailFormControl.value) {\n              this.kountEntryShown = true;");
    // The typed address is honoured after the screen is decided and before the focus decision.
    expect(kept).toBeGreaterThan(decided);
    expect(kept).toBeLessThan(at(sub, "if (!was && this.kountOnly) {"));
    expect(at(sub, "error: () => {\n            this.kountScreen = false;")).toBeGreaterThan(kept);
  });
  it("an automatic focus runs only while the Kount-only e-mail step still asks for it (round 15 PR-LOW-028)", () => {
    const ts = read("libs/auth/src/angular/login/login.component.ts");
    const focus = ts.slice(at(ts, "private kountFocus("));
    const body = focus.slice(0, at(focus, "\n  }\n"));
    expect(at(body, "if (auto && !(this.kountOnly && this.loginUiState === LoginUiState.EMAIL_ENTRY)) {")).toBeLessThan(
      at(body, "host.querySelector<HTMLElement>(selector)?.focus();"),
    );
  });
  it("upstream's single sign-on label is upstream's; the Kount label is its own message (round 11 PR-LOW-004)", () => {
    const messages = JSON.parse(read("apps/browser/src/_locales/en/messages.json"));
    expect(messages.useSingleSignOn.message).toBe("Use single sign-on");
    expect(messages.kountSignInWithKountId.message).toBe("Sign in with Kount ID");
  });
  it("the browser's forward button never validates a hidden e-mail entry (E24)", () => {
    const ts = read("libs/auth/src/angular/login/login.component.ts");
    const pop = ts.slice(at(ts, "private handlePopState"));
    expect(at(pop, "if (this.kountOnly)")).toBeLessThan(at(pop, "await this.continue()"));
  });
});
