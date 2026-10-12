import type { Mission, NetworkConfig, TelemetryPacketItem, GapEvent } from '../types/telemetry';

const BASE_URL = '';

export async function fetchHealth(): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/health`);
  if (!res.ok) throw new Error('Failed to fetch system health');
  return res.json();
}

export async function fetchLatestTelemetry(): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/telemetry/latest`);
  if (!res.ok) throw new Error('Failed to fetch latest telemetry');
  return res.json();
}

export async function fetchMissions(): Promise<Mission[]> {
  const res = await fetch(`${BASE_URL}/api/missions`);
  if (!res.ok) throw new Error('Failed to fetch missions');
  return res.json();
}

export async function createMission(name: string, droneId = 'VEGAPilot-01'): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/missions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, drone_id: droneId }),
  });
  if (!res.ok) throw new Error('Failed to create mission');
  return res.json();
}

export async function stopMission(missionId: string): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/missions/${missionId}/stop`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to stop mission');
  return res.json();
}

export async function fetchMissionTelemetry(
  missionId: string,
  page = 1,
  pageSize = 50,
  filters: { message_type?: string; is_valid?: boolean; is_recovered?: boolean } = {}
): Promise<{
  mission_id: string;
  page: number;
  page_size: number;
  total_items: number;
  total_pages: number;
  items: TelemetryPacketItem[];
}> {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  if (filters.message_type) params.append('message_type', filters.message_type);
  if (filters.is_valid !== undefined) params.append('is_valid', String(filters.is_valid));
  if (filters.is_recovered !== undefined) params.append('is_recovered', String(filters.is_recovered));

  const res = await fetch(`${BASE_URL}/api/missions/${missionId}/telemetry?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch mission telemetry logs');
  return res.json();
}

export async function fetchMissionEvents(missionId: string): Promise<{
  mission_id: string;
  gaps: GapEvent[];
  connection_events: any[];
}> {
  const res = await fetch(`${BASE_URL}/api/missions/${missionId}/events`);
  if (!res.ok) throw new Error('Failed to fetch mission events');
  return res.json();
}

export async function fetchNetworkConfig(): Promise<NetworkConfig> {
  const res = await fetch(`${BASE_URL}/api/config/network`);
  if (!res.ok) throw new Error('Failed to fetch network config');
  return res.json();
}

export async function updateNetworkConfig(config: Partial<NetworkConfig>): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/config/network`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error('Failed to update network config');
  return res.json();
}

export async function fetchSimulatorStatus(): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/simulator/status`);
  if (!res.ok) throw new Error('Failed to fetch simulator status');
  return res.json();
}

export async function startSimulator(rateHz = 10.0): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/simulator/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rate_hz: rateHz }),
  });
  if (!res.ok) throw new Error('Failed to start simulator');
  return res.json();
}

export async function stopSimulator(): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/simulator/stop`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to stop simulator');
  return res.json();
}

export async function injectSimulatorFault(mode: string, param?: any): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/simulator/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, param }),
  });
  if (!res.ok) throw new Error('Failed to inject fault');
  return res.json();
}

export async function sendCommand(command: string, param1 = 0, param2 = 0): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/commands/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, param1, param2 }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Command failed' }));
    throw new Error(err.detail || 'Failed to dispatch command');
  }
  return res.json();
}

export async function fetchCommandHistory(): Promise<any[]> {
  const res = await fetch(`${BASE_URL}/api/commands/history`);
  if (!res.ok) throw new Error('Failed to fetch command history');
  return res.json();
}

export async function fetchSystemEvents(): Promise<any[]> {
  const res = await fetch(`${BASE_URL}/api/commands/events`);
  if (!res.ok) throw new Error('Failed to fetch system events');
  return res.json();
}

export async function fetchWaypoints(): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/commands/waypoints`);
  if (!res.ok) throw new Error('Failed to fetch waypoints');
  return res.json();
}

export async function updateWaypoints(waypoints: any[]): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/commands/waypoints`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ waypoints }),
  });
  if (!res.ok) throw new Error('Failed to save waypoints');
  return res.json();
}
