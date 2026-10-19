import os from 'node:os';

export interface LanAddress {
  address: string;
  iface: string;
}

/**
 * Zwraca adresy IPv4 sieci lokalnej (bez loopback), preferując prywatne zakresy.
 */
export function getLanAddresses(): LanAddress[] {
  const result: LanAddress[] = [];
  const ifaces = os.networkInterfaces();

  for (const [iface, infos] of Object.entries(ifaces)) {
    for (const info of infos ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      result.push({ address: info.address, iface });
    }
  }

  const isPrivate = (ip: string): boolean =>
    ip.startsWith('192.168.') ||
    ip.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip);

  return result.sort((a, b) => Number(isPrivate(b.address)) - Number(isPrivate(a.address)));
}

/** Pierwszy sensowny adres LAN albo localhost. */
export function getPrimaryLanAddress(): string {
  return getLanAddresses()[0]?.address ?? '127.0.0.1';
}

export function buildBaseUrl(port: number): string {
  return `http://${getPrimaryLanAddress()}:${port}`;
}

export function buildJoinUrl(port: number, roomCode: string): string {
  return `${buildBaseUrl(port)}/join?room=${encodeURIComponent(roomCode)}`;
}

export function buildTvUrl(port: number, roomCode: string): string {
  return `${buildBaseUrl(port)}/tv?room=${encodeURIComponent(roomCode)}`;
}
