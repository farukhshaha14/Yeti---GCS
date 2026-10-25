import { useTelemetryStore } from '../stores/useTelemetryStore';
import { useConnectionStore } from '../stores/useConnectionStore';
import { useDataHealthStore } from '../stores/useDataHealthStore';
import { useAlertStore } from '../stores/useAlertStore';
import { useMissionStore } from '../stores/useMissionStore';

class TelemetryWebSocketClient {
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private pingInterval: number | null = null;
  private retryDelayMs = 1500;
  private readonly initialRetryDelayMs = 1500;
  private readonly maxRetryDelayMs = 15000;
  private isIntentionallyClosed = false;
  private consecutiveFailures = 0;

  public connect(isAutoRetry = false): void {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.isIntentionallyClosed = false;

    if (!isAutoRetry) {
      // Explicit manual connect: reset backoff and failure count
      this.retryDelayMs = this.initialRetryDelayMs;
      this.consecutiveFailures = 0;
      useConnectionStore.getState().resetReconnect();
      useConnectionStore.getState().setStatus('CONNECTING');
    } else {
      // Scheduled background retry: display RECONNECTING only if actively attempting, otherwise keep calm DISCONNECTED
      if (this.consecutiveFailures > 2) {
        useConnectionStore.getState().setStatus('RECONNECTING');
      } else {
        useConnectionStore.getState().setStatus('CONNECTING');
      }
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Use window.location.host so Vite proxy /ws routes cleanly to backend
    const wsUrl = `${protocol}//${window.location.host}/ws/telemetry`;

    try {
      this.socket = new WebSocket(wsUrl);

      this.socket.onopen = () => {
        useConnectionStore.getState().setWsConnected(true);
        useConnectionStore.getState().setStatus('CONNECTED');
        useConnectionStore.getState().resetReconnect();
        this.retryDelayMs = this.initialRetryDelayMs;
        this.consecutiveFailures = 0;

        useAlertStore.getState().addAlert({
          type: 'INFO',
          title: 'STREAM CONNECTED',
          message: 'Real-time telemetry WebSocket link established.',
        });

        // Start ping keepalive every 15 seconds
        if (this.pingInterval) clearInterval(this.pingInterval);
        this.pingInterval = window.setInterval(() => {
          if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send('ping');
          }
        }, 15000);
      };

      this.socket.onmessage = (event: MessageEvent) => {
        if (event.data === 'pong') return;

        try {
          const msg = JSON.parse(event.data);
          useConnectionStore.getState().recordMessageReceived();

          if (msg.type === 'INITIAL_STATE' || msg.type === 'TELEMETRY_UPDATE') {
            if (msg.telemetry) {
              useTelemetryStore.getState().setTelemetry(msg.telemetry);
              if (msg.telemetry.data_health) {
                useDataHealthStore.getState().setHealth(msg.telemetry.data_health);
                useConnectionStore.getState().setStatus(msg.telemetry.data_health.status);
              }
              // Record flight trail breadcrumb point from verified GPS
              const lat = msg.telemetry.gps?.latitude ?? msg.telemetry.position?.latitude;
              const lon = msg.telemetry.gps?.longitude ?? msg.telemetry.position?.longitude;
              const isValidGps = msg.telemetry.gps?.valid !== false;
              if (lat !== null && lat !== undefined && lon !== null && lon !== undefined && isValidGps) {
                useMissionStore.getState().addBreadcrumb({ lat, lon });
              }
              if (msg.telemetry.home && msg.telemetry.home.is_set && msg.telemetry.home.latitude !== null && msg.telemetry.home.longitude !== null) {
                useMissionStore.getState().setHomePosition({
                  lat: msg.telemetry.home.latitude,
                  lon: msg.telemetry.home.longitude,
                  alt_m: msg.telemetry.home.altitude_m || 0,
                });
              }
              if (msg.telemetry.mission_progress) {
                useMissionStore.getState().setMissionProgress(msg.telemetry.mission_progress);
                if (msg.telemetry.mission_progress.current_seq !== null && msg.telemetry.mission_progress.current_seq !== undefined) {
                  useMissionStore.getState().setCurrentWaypointIndex(msg.telemetry.mission_progress.current_seq);
                }
              }
            }
            if (msg.mission_id) {
              useMissionStore.getState().setActiveMissionId(msg.mission_id);
            }
          } else if (msg.type === 'MISSION_UPLOAD_STATUS') {
            const statusMap: Record<string, 'NOT_UPLOADED' | 'UPLOADING' | 'UPLOAD_SUCCESSFUL' | 'UPLOAD_FAILED' | 'ACKNOWLEDGED'> = {
              'IN_PROGRESS': 'UPLOADING',
              'COMPLETED': 'UPLOAD_SUCCESSFUL',
              'FAILED': 'UPLOAD_FAILED',
              'ACKNOWLEDGED': 'ACKNOWLEDGED',
            };
            const mappedStatus = statusMap[msg.status] || 'UPLOADING';
            useMissionStore.getState().setUploadStatus(mappedStatus, msg.detail || '');
            useAlertStore.getState().addAlert({
              type: msg.status === 'COMPLETED' ? 'INFO' : msg.status === 'FAILED' ? 'WARNING' : 'INFO',
              title: `MISSION UPLOAD ${msg.status}`,
              message: msg.detail || `Upload state: ${msg.status}`,
            });
          } else if (msg.type === 'HOME_POSITION') {
            if (msg.latitude !== undefined && msg.longitude !== undefined) {
              useMissionStore.getState().setHomePosition({
                lat: msg.latitude,
                lon: msg.longitude,
                alt_m: msg.altitude_m || 0,
              });
            }
          } else if (msg.type === 'MISSION_CURRENT') {
            if (msg.seq !== undefined && msg.seq !== null) {
              useMissionStore.getState().setCurrentWaypointIndex(msg.seq);
            }
          } else if (msg.type === 'MISSION_ITEM_REACHED') {
            if (msg.seq !== undefined && msg.seq !== null) {
              useAlertStore.getState().addAlert({
                type: 'INFO',
                title: `WAYPOINT WP${msg.seq} REACHED`,
                message: `Drone reached target mission waypoint #${msg.seq}.`,
              });
            }
          } else if (msg.type === 'MISSION_RESET') {
            if (msg.mission_id) {
              useMissionStore.getState().resetMissionRuntimeState(msg.mission_id);
              useTelemetryStore.getState().resetTelemetry();
              useAlertStore.getState().addAlert({
                type: 'INFO',
                title: 'NEW MISSION INITIALIZED',
                message: `Clean mission session: ${msg.mission_id}. Layers and flight path reset.`,
              });
            }
          } else if (msg.type === 'HEALTH_UPDATE') {
            if (msg.data_health) {
              useDataHealthStore.getState().setHealth(msg.data_health);
              useConnectionStore.getState().setStatus(msg.data_health.status);
            }
          } else if (msg.type === 'GAP_EVENT') {
            const status = msg.status;
            const seq = msg.sequence;
            if (status === 'RECOVERED') {
              useAlertStore.getState().addAlert({
                type: 'RECOVERY',
                title: `PACKET #${seq} RECOVERED`,
                message: `Sequence #${seq} recovered and validated into local database.`,
              });
            } else if (status === 'RECOVERING' || status === 'MISSING') {
              useAlertStore.getState().addAlert({
                type: 'GAP',
                title: `PACKET GAP DETECTED: #${seq}`,
                message: `Expected packet sequence #${seq} missing. Requesting retransmission.`,
              });
            } else if (status === 'UNRECOVERED') {
              useAlertStore.getState().addAlert({
                type: 'WARNING',
                title: `PACKET #${seq} UNRECOVERED`,
                message: `Recovery timeout exceeded for sequence #${seq}. Marked unrecoverable.`,
              });
            }
          } else if (msg.type === 'RECOVERY_ALERT') {
            useAlertStore.getState().addAlert({
              type: 'GAP',
              title: 'RECOVERY IN PROGRESS',
              message: `Requested retransmission for packets: ${msg.missing_sequences?.join(', ')}`,
            });
          } else if (msg.type === 'COMMAND_STATUS') {
            useAlertStore.getState().addAlert({
              type: msg.status === 'ACKNOWLEDGED' ? 'INFO' : msg.status === 'FAILED' ? 'WARNING' : 'INFO',
              title: `COMMAND: ${msg.command_name || 'CMD'} ${msg.status}`,
              message: `Status: ${msg.status} (CMD ID: ${msg.command_id || '--'})`,
            });
          } else if (msg.type === 'SYSTEM_EVENT') {
            if (msg.event_type === 'BATTERY_LOW' || msg.event_type === 'BATTERY_CRITICAL') {
              useAlertStore.getState().addAlert({
                type: 'WARNING',
                title: msg.event_type,
                message: `Battery level: ${msg.payload?.percentage}%`,
              });
            } else if (msg.event_type === 'COMMUNICATION_LOST') {
              useAlertStore.getState().addAlert({
                type: 'WARNING',
                title: 'COMMUNICATION LOST',
                message: 'No telemetry packets received within disconnect timeout.',
              });
            }
          } else if (msg.type === 'WAYPOINTS_UPDATED') {
            if (msg.waypoints) {
              useMissionStore.getState().setWaypoints(msg.waypoints);
            }
            if (msg.geofence) {
              useMissionStore.getState().setGeofence(msg.geofence);
            }
            if (msg.no_fly_zones) {
              useMissionStore.getState().setNoFlyZones(msg.no_fly_zones);
            }
          }
        } catch (e) {
          console.error('Failed to parse WebSocket packet:', e);
        }
      };

      this.socket.onerror = (error) => {
        console.warn('WebSocket error encountered:', error);
      };

      this.socket.onclose = () => {
        useConnectionStore.getState().setWsConnected(false);
        if (this.pingInterval) clearInterval(this.pingInterval);
        this.socket = null;

        if (!this.isIntentionallyClosed) {
          this.consecutiveFailures += 1;
          useConnectionStore.getState().incrementReconnect();
          useConnectionStore.getState().setStatus('DISCONNECTED');
          this.scheduleReconnect();
        }
      };
    } catch (err) {
      console.warn('WebSocket initial connection failed:', err);
      this.consecutiveFailures += 1;
      useConnectionStore.getState().setStatus('DISCONNECTED');
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    // Exponential backoff with jitter (1.5s -> 3s -> 6s -> 12s -> 15s max)
    const jitter = Math.floor(Math.random() * 400);
    const calculatedDelay = Math.min(
      Math.round(this.retryDelayMs * 1.8 + jitter),
      this.maxRetryDelayMs
    );
    this.retryDelayMs = calculatedDelay;

    this.reconnectTimer = window.setTimeout(() => {
      if (!this.isIntentionallyClosed) {
        this.connect(true);
      }
    }, calculatedDelay);
  }

  public disconnect(): void {
    this.isIntentionallyClosed = true;
    this.consecutiveFailures = 0;
    this.retryDelayMs = this.initialRetryDelayMs;
    useConnectionStore.getState().setStatus('DISCONNECTING');

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    if (this.socket) {
      try {
        this.socket.close(1000, 'User requested disconnect');
      } catch (e) {
        console.warn('Error during socket close:', e);
      }
      this.socket = null;
    }

    useConnectionStore.getState().setWsConnected(false);
    useConnectionStore.getState().setStatus('DISCONNECTED');

    // Cleanly reset packet age & transport latency metrics upon manual disconnect
    useDataHealthStore.getState().updateHealth({
      status: 'DISCONNECTED',
      transport_latency_ms: null,
      latency_ms: null,
      last_packet_age_ms: null,
    });

    useAlertStore.getState().addAlert({
      type: 'INFO',
      title: 'STREAM DISCONNECTED',
      message: 'Telemetry WebSocket connection cleanly stopped by operator.',
    });
  }

  public toggle(): void {
    const status = useConnectionStore.getState().status;
    const isStreamActive =
      status === 'LIVE' ||
      status === 'CONNECTED' ||
      status === 'DEGRADED' ||
      status === 'STALE' ||
      status === 'CONNECTING' ||
      status === 'RECONNECTING';

    if (isStreamActive) {
      this.disconnect();
    } else {
      this.connect();
    }
  }
}

export const wsClient = new TelemetryWebSocketClient();
