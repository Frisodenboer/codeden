import { useMemo } from "react";
import { encode } from "uqr";
import { cn } from "@/lib/utils";

/**
 * SVG path for a QR code of `text` (dark modules as 1×1 squares, with a 2-module quiet zone),
 * plus the side length in modules.
 */
export function qrPath(text: string): { d: string; size: number } {
  const { data, size } = encode(text, { ecc: "M", border: 2 });
  let d = "";
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (data[y]?.[x]) d += `M${x} ${y}h1v1h-1z`;
    }
  }
  return { d, size };
}

/**
 * A scannable QR code. Always dark on white, whatever the theme: phone cameras read that
 * most reliably.
 */
export function QrCode({
  value,
  label,
  className,
}: {
  value: string;
  /** Accessible description, e.g. "QR code for http://192.168.1.20:4317". */
  label: string;
  className?: string;
}) {
  const { d, size } = useMemo(() => qrPath(value), [value]);
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className={cn("rounded-md bg-white", className)}
      data-testid="qr-code"
      data-value={value}
    >
      <path d={d} fill="#000" />
    </svg>
  );
}
