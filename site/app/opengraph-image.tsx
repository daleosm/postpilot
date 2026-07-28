import { ImageResponse } from "next/og";

export const dynamic = "force-static";
export const alt = "Cutluma — open-source workflow software for episodic TV post-production";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "stretch",
          background: "#f4f5f1",
          color: "#17211b",
          display: "flex",
          flexDirection: "column",
          height: "100%",
          justifyContent: "space-between",
          padding: "66px 72px",
          width: "100%",
        }}
      >
        <div style={{ color: "#28664c", display: "flex", fontSize: 24, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>
          Open-source TV post-production operations
        </div>
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 940 }}>
          <div style={{ fontSize: 88, fontWeight: 750, letterSpacing: "-0.07em", lineHeight: 0.92 }}>
            Cutluma
          </div>
          <div style={{ fontSize: 46, fontWeight: 620, letterSpacing: "-0.045em", lineHeight: 1.06, marginTop: 24 }}>
            Run every episode. Keep the facility in sync.
          </div>
        </div>
        <div style={{ borderTop: "2px solid #bdc8bf", color: "#34423a", display: "flex", fontSize: 25, justifyContent: "space-between", paddingTop: 22 }}>
          <span>Workflow · Bookings · QC · Delivery · Commercial operations</span>
          <span>cutluma</span>
        </div>
      </div>
    ),
    size,
  );
}
