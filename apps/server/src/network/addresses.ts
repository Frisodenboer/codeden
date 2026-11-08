import { type NetworkInterfaceInfo, networkInterfaces } from "node:os";
import type { NetworkAddress } from "@codeden/contracts";

export type InterfaceMap = NodeJS.Dict<NetworkInterfaceInfo[]>;

/** `::ffff:192.168.1.2` -> `192.168.1.2`; other addresses unchanged (lower case). */
export function normalizeAddress(address: string | undefined | null): string {
  const lower = (address ?? "").trim().toLowerCase();
  return lower.startsWith("::ffff:") && lower.includes(".") ? lower.slice(7) : lower;
}

function ipv4Octets(address: string): number[] | undefined {
  const parts = address.split(".");
  if (parts.length !== 4) return undefined;
  const octets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : Number.NaN));
  return octets.every((o) => o >= 0 && o <= 255) ? octets : undefined;
}

/**
 * Is this peer on this machine? `127.0.0.0/8`, `::1` and their IPv4-mapped forms are; an empty
 * or unknown address is not (fail closed: it counts as remote).
 */
export function isLoopbackAddress(address: string | undefined | null): boolean {
  const normalized = normalizeAddress(address);
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
  const octets = ipv4Octets(normalized);
  return octets?.[0] === 127;
}

/** Tailscale (and other CGNAT VPNs) hand out addresses in `100.64.0.0/10`. */
export function isVpnRange(address: string): boolean {
  const octets = ipv4Octets(address);
  return (
    octets !== undefined &&
    octets[0] === 100 &&
    (octets[1] as number) >= 64 &&
    (octets[1] as number) <= 127
  );
}

/** Link-local `169.254.0.0/16` (no DHCP lease): never useful to a phone. */
function isLinkLocal(address: string): boolean {
  const octets = ipv4Octets(address);
  return octets?.[0] === 169 && octets[1] === 254;
}

/** Names of VPN interfaces, recognised so their address is labelled as a VPN. */
const VPN_NAME = /tailscale|wireguard|wg\d|utun|zerotier|\bzt|tun\d|vpn/i;

/**
 * Every address CodeDen answers on for `port`: this machine (`localhost`) first, then each
 * non-internal IPv4 address, LAN before VPN. Tailscale's range, and interfaces named like a VPN,
 * count as `vpn`. Interfaces are injectable for tests.
 */
export function listAddresses(
  port: number,
  interfaces: InterfaceMap = networkInterfaces(),
): NetworkAddress[] {
  const local: NetworkAddress = {
    kind: "local",
    label: "This computer",
    interfaceName: null,
    host: "localhost",
    url: `http://localhost:${port}`,
  };
  const found: NetworkAddress[] = [];
  const seen = new Set<string>();
  for (const [name, infos] of Object.entries(interfaces)) {
    for (const info of infos ?? []) {
      if (info.family !== "IPv4" || info.internal) continue;
      const host = info.address;
      if (seen.has(host) || isLinkLocal(host) || isLoopbackAddress(host)) continue;
      seen.add(host);
      const vpn = isVpnRange(host) || VPN_NAME.test(name);
      const tailscale = isVpnRange(host) || /tailscale/i.test(name);
      found.push({
        kind: vpn ? "vpn" : "lan",
        label: tailscale ? "Tailscale" : vpn ? `VPN (${name})` : name,
        interfaceName: name,
        host,
        url: `http://${host}:${port}`,
      });
    }
  }
  found.sort((a, b) => Number(a.kind === "vpn") - Number(b.kind === "vpn"));
  return [local, ...found];
}
