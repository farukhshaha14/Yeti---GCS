import { useTelemetryStore } from '../stores/useTelemetryStore';
import { useConnectionStore } from '../stores/useConnectionStore';
import { useDataHealthStore } from '../stores/useDataHealthStore';
import { useAlertStore } from '../stores/useAlertStore';
import { useMissionStore } from '../stores/useMissionStore';

class TelemetryWebSocketClient {
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private pingInterval: number | null = null;
  private retryDelayMs = 1000;
  private readonly maxRetryDelayMs = 10000;
  private isIntentionallyClosed = false;

  public connect(): void {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.isIntentionallyClosed = false;
    this.retryDelayMs = 1000;
    useConnectionStore.getState().setStatus('CONNECTING');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Use window.location.host so Vite proxy /ws routes cleanly to backend
    const wsUrl = `${protocol}//${window.location.host}/ws/telemetry`;

    try {
      this.socket = new WebSocket(wsUrl);

      this.socket.onopen = () => {
        useConnectionStore.getState().setWsConnected(true);
        useConnectionStore.getState().setStatus('CONNECTED');
        useConnectionStore.getState().resetReconnect();
        this.retryDelayMs = 1000; // Reset exponential backoff

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
            }
            if (msg.mission_id) {
              useMissionStore.getState().setActiveMissionId(msg.mission_id);
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

        if (!this.isIntentionallyClosed) {
          useConnectionStore.getState().setStatus('DISCONNECTED');
          useConnectionStore.getState().incrementReconnect();
          this.scheduleReconnect();
        }
      };
    } catch (err) {
      console.error('WebSocket initial connection failed:', err);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    this.reconnectTimer = window.setTimeout(() => {
      this.retryDelayMs = Math.min(this.retryDelayMs * 2, this.maxRetryDelayMs);
      this.connect();
    }, this.retryDelayMs);
  }

  public disconnect(): void {
    this.isIntentionallyClosed = true;
    useConnectionStore.getState().setStatus('DISCONNECTING');

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingInterval) clearInterval(this.pingInterval);

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
