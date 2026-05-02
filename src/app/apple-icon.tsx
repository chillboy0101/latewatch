import { ImageResponse } from "next/og";

export const size = {
  width: 180,
  height: 180,
};

export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "#f8fafc",
          display: "flex",
          height: "100%",
          justifyContent: "center",
          width: "100%",
        }}
      >
        <div
          style={{
            alignItems: "center",
            background: "#dbeafe",
            border: "1px solid #bfdbfe",
            borderRadius: 30,
            display: "flex",
            height: 140,
            justifyContent: "center",
            position: "relative",
            width: 140,
          }}
        >
          <div
            style={{
              border: "9px solid #93c5fd",
              borderRadius: 999,
              borderRightColor: "#60a5fa",
              borderTopColor: "#2563eb",
              height: 86,
              position: "absolute",
              width: 86,
            }}
          />
          <div
            style={{
              background: "#2563eb",
              borderRadius: 999,
              height: 42,
              width: 42,
            }}
          />
          <div
            style={{
              background: "#2563eb",
              border: "4px solid #dbeafe",
              borderRadius: 999,
              height: 26,
              position: "absolute",
              right: 27,
              top: 27,
              width: 26,
            }}
          />
        </div>
      </div>
    ),
    size,
  );
}
