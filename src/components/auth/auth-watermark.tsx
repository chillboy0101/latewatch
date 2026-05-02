export function AuthWatermark() {
  return (
    <div aria-hidden="true" className="auth-watermark">
      <div className="auth-watermark-mark">
        <span className="auth-watermark-ring" />
        <span className="auth-watermark-core" />
        <span className="auth-watermark-dot" />
      </div>
    </div>
  );
}
