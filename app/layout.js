import "./globals.css";
import Script from "next/script";

export const metadata = {
  title: "스페이스 커뮤니티",
  description: "사람과 생각이 만나 서로를 존중하는 열린 공론장",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <head>
        <Script
          id="google-adsense-script"
          async
          strategy="beforeInteractive"
          src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3255503954415485"
          crossOrigin="anonymous"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
