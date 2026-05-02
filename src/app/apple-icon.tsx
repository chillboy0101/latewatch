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
          background: "transparent",
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
            borderRadius: 19,
            display: "flex",
            height: 150,
            justifyContent: "center",
            position: "relative",
            width: 150,
          }}
        >
          <div
            style={{
              border: "8px solid #bfdbfe",
              borderRadius: 999,
              borderRightColor: "#60a5fa",
              borderTopColor: "#2563eb",
              height: 96,
              position: "absolute",
              width: 96,
            }}
          />
          <div
            style={{
              background: "#2563eb",
              borderRadius: 999,
              boxShadow: "0 0 0 17px rgba(37, 99, 235, 0.14)",
              height: 51,
              width: 51,
            }}
          />
          <div
            style={{
              background: "#2563eb",
              border: "5px solid #ffffff",
              borderRadius: 999,
              boxShadow: "0 0 0 8px rgba(37, 99, 235, 0.18)",
              height: 27,
              position: "absolute",
              right: 27,
              top: 27,
              width: 27,
            }}
          />
        </div>
      </div>
    ),
    size,
  );
}
