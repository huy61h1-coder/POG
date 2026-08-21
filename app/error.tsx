"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="loading-screen"><div className="spinner"/><b>Không thể tải giao diện tạm thời</b><p>Vui lòng tải lại trang để đồng bộ phiên bản mới nhất.</p><button onClick={reset}>Thử tải lại</button></main>;
}
