import type { Metadata } from "next";
import "leaflet/dist/leaflet.css";

export const metadata: Metadata = {
  title: "ADS-B Arrival Sequencing",
  description: "Historical arrival sequence analysis and replay",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
