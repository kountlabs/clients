# The Edge proofs image (plan T0.6, T1.6): the digest-pinned Playwright image plus Microsoft Edge at a PINNED version,
# from Microsoft's own apt repository (which keeps earlier versions), its signing key held to its published fingerprint.
# Playwright's `channel: "msedge"` drives /opt/microsoft/msedge. The package and the drivers are mounted at run time;
# nothing from the fetched upstream tree is in it. A pin that Microsoft no longer serves fails the build — bump it by hand
# at a rebase (the README's checklist).
#
#   docker build -t kext-edge-proofs:157 -f apps/kount-extension/build/edge-proofs.Dockerfile apps/kount-extension/build
FROM mcr.microsoft.com/playwright@sha256:2f05f8a734509a7b3f26a912639488ee08f58a7b292d14d62271bcff9038768f
ARG EDGE_VERSION=157.0.4341.46-1
# Microsoft's package signing key (packages.microsoft.com/keys/microsoft.asc).
ARG MS_KEY_FINGERPRINT=BC528686B50D79E339D3721CEB3E94ADBE1229CF
RUN set -eu; \
  apt-get update; \
  apt-get install -y --no-install-recommends gnupg curl ca-certificates; \
  curl -fsSL -o /tmp/ms.asc https://packages.microsoft.com/keys/microsoft.asc; \
  fpr="$(gpg --show-keys --with-colons /tmp/ms.asc | awk -F: '$1 == "fpr" { print $10; exit }')"; \
  [ "$fpr" = "$MS_KEY_FINGERPRINT" ] || { echo "the Microsoft key's fingerprint is $fpr" >&2; exit 1; }; \
  gpg --dearmor < /tmp/ms.asc > /usr/share/keyrings/microsoft-edge.gpg; \
  echo "deb [arch=amd64 signed-by=/usr/share/keyrings/microsoft-edge.gpg] https://packages.microsoft.com/repos/edge stable main" \
    > /etc/apt/sources.list.d/microsoft-edge.list; \
  apt-get update; \
  apt-get install -y --no-install-recommends "microsoft-edge-stable=${EDGE_VERSION}"; \
  rm -rf /var/lib/apt/lists/* /tmp/ms.asc; \
  microsoft-edge-stable --version
