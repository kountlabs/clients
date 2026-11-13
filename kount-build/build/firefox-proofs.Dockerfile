# The Firefox proofs image (plan T0.5, T0.6, T1.6): Debian's Firefox ESR at a PINNED package version, Mozilla's
# geckodriver and selenium-webdriver, so the Firefox package is installed as a temporary add-on and driven headless.
# Nothing from the fetched upstream tree is in it; the package and the drivers are mounted at run time. Debian serves
# only the current ESR, so a pin it has replaced fails the build: bump FIREFOX_ESR_VERSION by hand (the README's
# checklist) — never unpin it.
#
#   docker build -t kext-firefox-proofs:153 -f apps/kount-extension/build/firefox-proofs.Dockerfile apps/kount-extension/build
FROM node:22-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da
ARG FIREFOX_ESR_VERSION=153.7.0esr-1~deb12u1
ARG GECKODRIVER_VERSION=0.37.1
# The exact selenium-webdriver (the version the spike's image resolved, 2026-11-11); its own dependencies resolve by
# their ranges, as the vault's Playwright install does — bumped by hand at a rebase.
ARG SELENIUM_VERSION=4.52.0
# The tarball's sha256 as first downloaded (2026-11-11; Mozilla publishes none) — a changed download fails the build.
ARG GECKODRIVER_SHA256=e815130ea95983e162ae91843b48d3a3ce991735635fce83a647afde21e09f7e
RUN apt-get update \
 && apt-get install -y --no-install-recommends "firefox-esr=${FIREFOX_ESR_VERSION}" ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL -o /tmp/gd.tgz "https://github.com/mozilla/geckodriver/releases/download/v${GECKODRIVER_VERSION}/geckodriver-v${GECKODRIVER_VERSION}-linux64.tar.gz" \
 && echo "${GECKODRIVER_SHA256}  /tmp/gd.tgz" | sha256sum -c - \
 && tar -xzf /tmp/gd.tgz -C /usr/local/bin geckodriver \
 && rm /tmp/gd.tgz \
 && mkdir -p /sel && cd /sel && npm init -y > /dev/null && npm install --no-audit --no-fund --save-exact "selenium-webdriver@${SELENIUM_VERSION}" \
 && firefox-esr --version && geckodriver --version | head -n1
