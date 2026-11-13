import { ConsoleLogService } from "@bitwarden/common/platform/services/console-log.service";

import MainBackground from "../background/main.background";
import { KOUNT_PROTECT_ORIGIN } from "../kount/build-constants";
import { ProtectPickBackground } from "../kount/protect-pick.background";

// Kount: the pick hook's listener is registered first and synchronously, so a tile launch that wakes the worker is heard.
// The origin is passed here, its one use: build/check-artefacts.sh reads it back from this call in every package.
const protectPick = ProtectPickBackground.listen(chrome.webRequest as any, KOUNT_PROTECT_ORIGIN);
const logService = new ConsoleLogService(false);
const bitwardenMain = ((self as any).bitwardenMain = new MainBackground());
bitwardenMain
  .bootstrap()
  .then(() => protectPick.attach(bitwardenMain as any))
  .catch((error) => logService.error(error));
