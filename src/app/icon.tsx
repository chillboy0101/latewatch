import { ImageResponse } from "next/og";

export const size = {
  width: 192,
  height: 192,
};

export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "#0f172a",
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
            borderRadius: 32,
            display: "flex",
            height: 152,
            justifyContent: "center",
            position: "relative",
            width: 152,
          }}
        >
          <div
            style={{
              border: "10px solid #93c5fd",
              borderRadius: 999,
              borderRightColor: "#60a5fa",
              borderTopColor: "#2563eb",
              height: 94,
              position: "absolute",
              width: 94,
            }}
          />
          <div
            style={{
              background: "#2563eb",
              borderRadius: 999,
              height: 46,
              width: 46,
            }}
          />
          <div
            style={{
              background: "#2563eb",
              border: "4px solid #dbeafe",
              borderRadius: 999,
              height: 28,
              position: "absolute",
              right: 30,
              top: 30,
              width: 28,
            }}
          />
        </div>
      </div>
    ),
    size,
  );
}
