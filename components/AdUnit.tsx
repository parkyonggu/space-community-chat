import Script from "next/script";
import AdSenseScript from "./AdSenseScript";

type AdUnitProps = {
  slot: string;
  client?: string;
  format?: string;
  responsive?: boolean;
  className?: string;
};

export default function AdUnit({
  slot,
  client = process.env.NEXT_PUBLIC_ADSENSE_CLIENT,
  format = "auto",
  responsive = true,
  className = "",
}: AdUnitProps) {
  if (!client || !slot) {
    return null;
  }

  return (
    <div className={className} aria-label="광고">
      <AdSenseScript client={client} />
      <ins
        className="adsbygoogle"
        style={{ display: "block" }}
        data-ad-client={client}
        data-ad-slot={slot}
        data-ad-format={format}
        data-full-width-responsive={responsive ? "true" : "false"}
      />
      <Script id={`adsense-push-${slot}`} strategy="afterInteractive">
        {`(adsbygoogle = window.adsbygoogle || []).push({});`}
      </Script>
    </div>
  );
}
