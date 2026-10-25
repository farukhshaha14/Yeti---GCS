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
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);

  try {
    const res = await fetch(`${BASE_URL}/api/config/network`, {
      signal: controller.signal,
    });
    if (!res.ok) {
      let detail = '';
      try {
        const body = await res.json();
        detail = body.detail || '';
      } catch {
        detail = res.statusText;
      }
      throw new Error(`Failed to load network config (HTTP ${res.status}): ${detail || 'Backend unreachable'}`);
    }
    return await res.json();
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error('Network config request timed out after 6s. Backend unreachable.');
    }
    throw new Error(err.message || 'Failed to fetch network config');
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function updateNetworkConfig(config: Partial<NetworkConfig>): Promise<any> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(`${BASE_URL}/api/config/network`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
      signal: controller.signal,
    });
    if (!res.ok) {
      let detail = '';
      try {
        const body = await res.json();
        detail = body.detail || '';
      } catch {
        detail = res.statusText;
      }
      throw new Error(`Failed to update network config (HTTP ${res.status}): ${detail || 'Invalid settings'}`);
    }
    return await res.json();
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error('Update network config request timed out after 8s.');
    }
    throw new Error(err.message || 'Failed to update network config');
  } finally {
    clearTimeout(timeoutId);
  }
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

export async function uploadMissionFile(filename: string, content: string, missionId?: string): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/missions/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, content, mission_id: missionId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to upload mission' }));
    throw new Error(err.detail || 'Failed to upload mission file');
  }
  return res.json();
}

export async function fetchCompetitionTemplates(): Promise<any[]> {
  const res = await fetch(`${BASE_URL}/api/missions/templates`);
  if (!res.ok) throw new Error('Failed to fetch competition templates');
  return res.json();
}

export async function loadCompetitionTemplate(templateId: string, missionId?: string): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/missions/templates/load`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ template_id: templateId, mission_id: missionId }),
  });
  if (!res.ok) throw new Error('Failed to load competition template');
  return res.json();
}

export async function fetchTelemetryLogs(
  missionId?: string,
  page = 1,
  pageSize = 50,
  filters: { message_type?: string; is_valid?: boolean; is_recovered?: boolean; start_time?: number; end_time?: number } = {}
): Promise<{
  mission_id: string | null;
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
  if (missionId) params.append('mission_id', missionId);
  if (filters.message_type) params.append('message_type', filters.message_type);
  if (filters.is_valid !== undefined) params.append('is_valid', String(filters.is_valid));
  if (filters.is_recovered !== undefined) params.append('is_recovered', String(filters.is_recovered));
  if (filters.start_time) params.append('start_time', String(filters.start_time));
  if (filters.end_time) params.append('end_time', String(filters.end_time));

  const res = await fetch(`${BASE_URL}/api/telemetry/logs?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch telemetry logs');
  return res.json();
}

export async function startTelemetryReplay(missionId: string, speed = 1.0): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/telemetry/replay/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mission_id: missionId, speed }),
  });
  if (!res.ok) throw new Error('Failed to start telemetry replay');
  return res.json();
}

export async function stopTelemetryReplay(): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/telemetry/replay/stop`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to stop telemetry replay');
  return res.json();
}

export async function fetchTelemetryReplayStatus(): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/telemetry/replay/status`);
  if (!res.ok) throw new Error('Failed to fetch replay status');
  return res.json();
}

export async function fetchNetworkStatus(): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/network/status`);
  if (!res.ok) throw new Error('Failed to fetch network status');
  return res.json();
}

export async function fetchMissionDetails(missionId: string): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/missions/${missionId}`);
  if (!res.ok) throw new Error(`Failed to fetch mission details for ${missionId}`);
  return res.json();
}

export async function updateMission(
  missionId: string,
  payload: {
    name?: string;
    waypoints?: any[];
    home?: { lat: number; lon: number; alt_m: number };
    geofence?: Array<{ lat: number; lon: number }>;
    no_fly_zones?: Array<Array<{ lat: number; lon: number }>>;
  }
): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/missions/${missionId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to update mission' }));
    throw new Error(err.detail || 'Failed to update mission');
  }
  return res.json();
}

export async function validateMission(
  missionId: string,
  waypoints: any[],
  home?: { lat: number; lon: number; alt_m: number }
): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/missions/${missionId}/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ waypoints, home }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Validation failed' }));
    throw new Error(err.detail || 'Validation request failed');
  }
  return res.json();
}

export async function uploadMissionMavlink(missionId: string): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/missions/${missionId}/upload-mavlink`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Upload failed' }));
    throw new Error(err.detail || 'Mission upload request failed');
  }
  return res.json();
}

export async function downloadMissionMavlink(missionId: string): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/missions/${missionId}/download-mavlink`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Download failed' }));
    throw new Error(err.detail || 'Mission download request failed');
  }
  return res.json();
}

