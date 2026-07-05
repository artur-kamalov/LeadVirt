import type { ImgHTMLAttributes } from "react";

export function ImageWithFallback({
  loading = "lazy",
  decoding = "async",
  alt = "",
  ...props
}: ImgHTMLAttributes<HTMLImageElement>) {
  return <img alt={alt} loading={loading} decoding={decoding} {...props} />;
}
