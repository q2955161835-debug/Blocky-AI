import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const EXPECTED_LOGO_SHA256 =
  "12D3F351006663FD07EFD11480101F3C06A43F91633F2E8A914888CA63CF0D9D";

const EXPECTED_WINDOWS_ICON_SHA256 = {
  "32x32.png": "193342E1F008436D9BB2ADCED8D9AB756194E71C55BCB086127181289C3F108F",
  "64x64.png": "D9335F27BE613F55DD0E493BA3186AC822D314EC2450438796275CCD39114205",
  "128x128.png": "050EFCC3FB45CBD4F1345BF46DA59227332E6C46B4D23F4395F0BE4B82EC3817",
  "128x128@2x.png": "1092F15ACB9956998EE78DA939F37DC1965C424A28F8AE239F7F21B815ABAAEA",
  "icon.png": "073E00081A5E1B3904642FD263CC66B29C41B49F61FD7E9027A4B63B43CB4BC7",
  "icon.ico": "CBBAE888F508EDBA2E051640D992ABB38752D5C9513B53EFE50E400F2C7DB69F",
  "Square30x30Logo.png": "9A42DAFDC9D63B1F55EF69AB1D2718FD206A033186999F147CBCF4A6A2884705",
  "Square44x44Logo.png": "FAB33D0B8471C81A8CBD98A8F50CDD4FDE65EDDA5D366ECCDD0E5BF672A5D2D0",
  "Square71x71Logo.png": "7D2D5AE79D2A6CDBEC0FDD26E84E82C5AA07E4122D90BC5132549F4DF14243B4",
  "Square89x89Logo.png": "3EEE984B4BD07181DC5FE5FB55D0441E2B4DE7320DFA941C3AB1D8847198671E",
  "Square107x107Logo.png": "2544AD28802DE10BD8CEAA9586D554CCFB1D73DDAD3CD089C0C37CFD64B40245",
  "Square142x142Logo.png": "97A5CB9D707B745BAE37E4CBF20B583FD4F7D6E0C509A3758E420D1327C580E0",
  "Square150x150Logo.png": "50057E6961BC78A425791327CC02B2573ED96D6CBBAB615E6DBB6C079BD2F909",
  "Square284x284Logo.png": "5F0043EEDBF55F7F9EB49BCF879566AEB042B332EF34C7F2B92561C829343C14",
  "Square310x310Logo.png": "120F7A53F144F6E97C53CD7483E3CF385E972D4B6140B5856E63C447AAD44159",
  "StoreLogo.png": "C27350A514636F19248C114E5396C4E8F48AF1709842C335084A853A0856AB04",
} as const;

const logoPath = resolve(process.cwd(), "../../logo/logo.png");
const iconDirectoryPath = resolve(process.cwd(), "src-tauri/icons");

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex").toUpperCase();
}

describe("Blocky branding assets", () => {
  it("locks the approved square source logo", () => {
    const logo = readFileSync(logoPath);

    expect(sha256(logo)).toBe(EXPECTED_LOGO_SHA256);
    expect(logo.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(logo.readUInt32BE(16)).toBe(1254);
    expect(logo.readUInt32BE(20)).toBe(1254);
  });

  it("keeps every Windows package icon generated from the approved logo", () => {
    for (const [fileName, expectedHash] of Object.entries(
      EXPECTED_WINDOWS_ICON_SHA256,
    )) {
      const bytes = readFileSync(resolve(iconDirectoryPath, fileName));
      expect(sha256(bytes), fileName).toBe(expectedHash);
    }
  });

  it("keeps a valid Windows ICO container", () => {
    const icon = readFileSync(resolve(iconDirectoryPath, "icon.ico"));

    expect([...icon.subarray(0, 4)]).toEqual([0, 0, 1, 0]);
    expect(icon.readUInt16LE(4)).toBeGreaterThan(0);
  });
});
