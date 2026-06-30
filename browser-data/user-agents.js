const user_agent_vendor_platform_pairs = [
  // Chrome on Windows
  {
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    vendor: "Google Inc.",
    platform: "Win32",
  },
  {
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36",
    vendor: "Google Inc.",
    platform: "Win32",
  },
  {
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/93.0.4577.82 Safari/537.36",
    vendor: "Google Inc.",
    platform: "Win32",
  },
  // Chrome on macOS
  {
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36",
    vendor: "Google Inc.",
    platform: "MacIntel",
  },
  {
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 11_2_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36",
    vendor: "Google Inc.",
    platform: "MacIntel",
  },
  {
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 12_0_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.54 Safari/537.36",
    vendor: "Google Inc.",
    platform: "MacIntel",
  },
  // Firefox on Windows
  {
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0",
    vendor: "Mozilla Foundation",
    platform: "Win32",
  },
  {
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:91.0) Gecko/20100101 Firefox/91.0",
    vendor: "Mozilla Foundation",
    platform: "Win32",
  },
  {
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:92.0) Gecko/20100101 Firefox/92.0",
    vendor: "Mozilla Foundation",
    platform: "Win32",
  },
  // Firefox on macOS
  {
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7; rv:78.0) Gecko/20100101 Firefox/78.0",
    vendor: "Mozilla Foundation",
    platform: "MacIntel",
  },
  {
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6; rv:85.0) Gecko/20100101 Firefox/85.0",
    vendor: "Mozilla Foundation",
    platform: "MacIntel",
  },
  {
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 11_1; rv:89.0) Gecko/20100101 Firefox/89.0",
    vendor: "Mozilla Foundation",
    platform: "MacIntel",
  },
  // Safari on macOS
  {
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Safari/605.1.15",
    vendor: "Apple Computer, Inc.",
    platform: "MacIntel",
  },
  {
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 11_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Safari/605.1.15",
    vendor: "Apple Computer, Inc.",
    platform: "MacIntel",
  },
  {
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 12_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Safari/605.1.15",
    vendor: "Apple Computer, Inc.",
    platform: "MacIntel",
  },
  // Edge on Windows
  {
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.864.54 Safari/537.36 Edg/91.0.864.54",
    vendor: "Google Inc.",
    platform: "Win32",
  },
  {
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36 Edg/92.0.4515.107",
    vendor: "Google Inc.",
    platform: "Win32",
  },
  {
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/93.0.4577.63 Safari/537.36 Edg/93.0.4577.63",
    vendor: "Google Inc.",
    platform: "Win32",
  },
  // Linux - Chrome
  {
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.150 Safari/537.36",
    vendor: "Google Inc.",
    platform: "Linux x86_64",
  },
  {
    userAgent:
      "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:88.0) Gecko/20100101 Firefox/88.0",
    vendor: "Mozilla Foundation",
    platform: "Linux x86_64",
  },
  {
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/89.0.4389.82 Safari/537.36",
    vendor: "Google Inc.",
    platform: "Linux x86_64",
  },
];

export default user_agent_vendor_platform_pairs;
