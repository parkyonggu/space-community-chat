import "./globals.css";

export const metadata = {
  title: "스페이스 커뮤니티",
  description: "사람과 생각이 만나 서로를 존중하는 열린 공론장",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
