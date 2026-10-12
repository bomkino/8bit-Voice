abi <abi/4.0>,
include <tunables/global>

# Lets Chromium's sandbox use user namespaces on Ubuntu 24.04 and later. It
# attaches to the real binary, since ${executable} itself is a small launcher.
profile "${executable}" "/opt/${sanitizedProductName}/${executable}.bin" flags=(unconfined) {
  userns,

  # Site-specific additions and overrides. See local/README for details.
  include if exists <local/${executable}>
}
