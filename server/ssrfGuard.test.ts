import { describe, expect, it } from "vitest";

import { checkSafeOutboundUrl } from "./ssrfGuard";

describe("checkSafeOutboundUrl (W2)", () => {
  describe("public hostnames pass", () => {
    it.each([
      "https://api.openai.com/v1",
      "https://api.anthropic.com",
      "https://generativelanguage.googleapis.com/v1beta",
      "https://api.example.com:8443/path",
      "http://203.0.113.42/", // public IPv4 (TEST-NET-3 — not actually routable but not private either)
      "http://[2001:db8::1]/", // public IPv6 doc range
    ])("%s", (url) => {
      const result = checkSafeOutboundUrl(url);
      expect(result.ok).toBe(true);
    });
  });

  describe("loopback / private / link-local hostnames are rejected", () => {
    it.each<[string, string]>([
      ["http://localhost", "loopback alias"],
      ["http://localhost:5000/api", "loopback alias"],
      ["http://LOCALHOST/", "loopback alias"], // case-insensitive
      ["http://127.0.0.1", "loopback/private"],
      ["http://127.255.255.254", "loopback/private"], // anywhere in 127/8
      ["http://10.0.0.1", "loopback/private"],
      ["http://172.16.0.1", "loopback/private"],
      ["http://172.31.255.255", "loopback/private"], // top of 172.16/12
      ["http://192.168.1.1", "loopback/private"],
      ["http://169.254.169.254/", "loopback/private"], // EC2 instance metadata
      ["http://0.0.0.0", "loopback/private"],
      ["http://[::1]/", "IPv6 loopback"],
      ["http://[fc00::1]/", "IPv6 loopback"], // ULA
      ["http://[fd12:3456:789a::1]/", "IPv6 loopback"], // ULA
      ["http://[fe80::1]/", "IPv6 loopback"], // link-local
      ["http://[::ffff:127.0.0.1]/", "IPv6 loopback"], // v4-mapped loopback
    ])("%s → rejected (%s)", (url) => {
      const result = checkSafeOutboundUrl(url);
      expect(result.ok).toBe(false);
      expect(result.reason).toBeDefined();
    });
  });

  describe("172.x boundary cases", () => {
    it("rejects 172.16.0.0 (start of private range)", () => {
      expect(checkSafeOutboundUrl("http://172.16.0.0/").ok).toBe(false);
    });
    it("rejects 172.31.255.255 (end of private range)", () => {
      expect(checkSafeOutboundUrl("http://172.31.255.255/").ok).toBe(false);
    });
    it("allows 172.15.0.0 (below private range)", () => {
      expect(checkSafeOutboundUrl("http://172.15.0.0/").ok).toBe(true);
    });
    it("allows 172.32.0.0 (above private range)", () => {
      expect(checkSafeOutboundUrl("http://172.32.0.0/").ok).toBe(true);
    });
  });

  describe("malformed input", () => {
    it.each(["not a url", "://broken", "", "ftp://"])("%s → rejected", (url) => {
      const result = checkSafeOutboundUrl(url);
      expect(result.ok).toBe(false);
    });
  });
});
