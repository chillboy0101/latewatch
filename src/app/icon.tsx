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
            borderRadius: 20,
            display: "flex",
            height: 160,
            justifyContent: "center",
            position: "relative",
            width: 160,
          }}
        >
          <div
            style={{
              border: "9px solid #bfdbfe",
              borderRadius: 999,
              borderRightColor: "#60a5fa",
              borderTopColor: "#2563eb",
              height: 102,
              position: "absolute",
              width: 102,
            }}
          />
          <div
            style={{
              background: "#2563eb",
              borderRadius: 999,
              boxShadow: "0 0 0 18px rgba(37, 99, 235, 0.14)",
              height: 54,
              width: 54,
            }}
          />
          <div
            style={{
              background: "#2563eb",
              border: "5px solid #ffffff",
              borderRadius: 999,
              boxShadow: "0 0 0 9px rgba(37, 99, 235, 0.18)",
              height: 29,
              position: "absolute",
              right: 29,
              top: 29,
              width: 29,
            }}
          />
        </div>
      </div>
    ),
    size,
  );
}
