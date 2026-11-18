"use client";
import ErreurPage from "@/components/ErreurPage";

export default function GlobalError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="fr">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 16 }}>
        <ErreurPage {...props} />
      </body>
    </html>
  );
}
