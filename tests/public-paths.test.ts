import { describe, expect, it } from "vitest";
import { isPublicPath } from "@/auth/public-paths";

describe("isPublicPath", () => {
  it.each(["/login", "/login/", "/login/help", "/icon.svg", "/favicon.ico"])("lets %s through without a session", (path) => {
    expect(isPublicPath(path)).toBe(true);
  });

  it.each(["/", "/activity", "/login-history", "/loginsettings", "/icon.svgx", "/icon.svg/x", "/favicon.icox", "/settings/login"])(
    "checks the session for %s",
    (path) => {
      expect(isPublicPath(path)).toBe(false);
    },
  );
});
