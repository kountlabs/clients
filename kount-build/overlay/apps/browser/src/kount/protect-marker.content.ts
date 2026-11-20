// The page marker's content script (plan Decision 6; webpack entry `content/kount-protect-marker`, patch 0003). Never
// listed in a manifest: the background registers it for Protect's host and injects it into Protect tabs already open
// (protect-marker.background.ts). It needs Protect's exact origin before its first write and cannot wait for the
// background, so the build constant is compiled into this bundle too — the origin's second checked consumer: the
// artefact checker reads it back from this call in every package, beside the pick hook's.
import { KOUNT_PROTECT_ORIGIN } from "./build-constants";
import { startMarker } from "./protect-marker";

startMarker(window as any, KOUNT_PROTECT_ORIGIN, chrome.runtime as any);
