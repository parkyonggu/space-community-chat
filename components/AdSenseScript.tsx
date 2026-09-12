import Script from "next/script";

type AdSenseScriptProps = {
  client?: string;
};

export default function AdSenseScript({
  client = process.env.NEXT_PUBLIC_ADSENSE_CLIENT,
}: AdSenseScriptProps) {
  if (!client) {
    return null;
  }

  return (
    <Script
      id="google-adsense-script"
      async
      strategy="afterInteractive"
      src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}`}
      crossOrigin="anonymous"
    />
  );
}
