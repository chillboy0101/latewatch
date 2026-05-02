import { ImageResponse } from "next/og";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site-metadata";

export const alt = "LateWatch attendance and lateness tracking portal";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "#020617",
          color: "#f8fafc",
          display: "flex",
          height: "100%",
          padding: 72,
          width: "100%",
        }}
      >
        <div
          style={{
            background: "#0f172a",
            border: "1px solid #1e293b",
            borderRadius: 48,
            display: "flex",
            flexDirection: "column",
            height: "100%",
            justifyContent: "space-between",
            padding: 64,
            width: "100%",
          }}
        >
          <div style={{ alignItems: "center", display: "flex", gap: 24 }}>
            <div
              style={{
                alignItems: "center",
                background: "#dbeafe",
                border: "1px solid #bfdbfe",
                borderRadius: 22,
                display: "flex",
                height: 88,
                justifyContent: "center",
                position: "relative",
                width: 88,
              }}
            >
              <div
                style={{
                  border: "6px solid #93c5fd",
                  borderRadius: 999,
                  borderRightColor: "#60a5fa",
                  borderTopColor: "#2563eb",
                  height: 54,
                  position: "absolute",
                  width: 54,
                }}
              />
              <div
                style={{
                  background: "#2563eb",
                  borderRadius: 999,
                  height: 26,
                  width: 26,
                }}
              />
              <div
                style={{
                  background: "#2563eb",
                  border: "3px solid #dbeafe",
                  borderRadius: 999,
                  height: 18,
                  position: "absolute",
                  right: 17,
                  top: 17,
                  width: 18,
                }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ color: "#f8fafc", fontSize: 42, fontWeight: 800 }}>{SITE_NAME}</div>
              <div style={{ color: "#93c5fd", fontSize: 24 }}>GRA Attendance Platform</div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <div style={{ color: "#ffffff", fontSize: 72, fontWeight: 900, lineHeight: 1.03 }}>
              Attendance, lateness, audits, and exports in one secure portal.
            </div>
            <div style={{ color: "#bfdbfe", fontSize: 28, lineHeight: 1.35, width: 870 }}>
              {SITE_DESCRIPTION}
            </div>
          </div>

          <div style={{ alignItems: "center", display: "flex", gap: 16 }}>
            {["WiFi-verified check-ins", "Late penalties", "Audit-ready records"].map((item) => (
              <div
                key={item}
                style={{
                  background: "#172554",
                  border: "1px solid #1d4ed8",
                  borderRadius: 999,
                  color: "#dbeafe",
                  fontSize: 22,
                  padding: "14px 22px",
                }}
              >
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
