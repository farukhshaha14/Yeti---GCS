import React from 'react';
import { Cpu, Compass, Gauge, Satellite } from 'lucide-react';
import { useTelemetryStore } from '../stores/useTelemetryStore';
import { useConnectionStore } from '../stores/useConnectionStore';
import type { SensorStatusItem } from '../types/telemetry';

export const SensorHealthWidget: React.FC = () => {
  const { telemetry } = useTelemetryStore();
  const { status } = useConnectionStore();
  const isDisconnected = status === 'DISCONNECTED';

  // 1. IMU Evaluation
  let imuStatus: SensorStatusItem['status'] = 'NO DATA';
  let imuDetails = 'No attitude telemetry';
  if (!isDisconnected && telemetry.attitude.roll_deg !== null && telemetry.attitude.pitch_deg !== null) {
    const maxTilt = Math.max(Math.abs(telemetry.attitude.roll_deg), Math.abs(telemetry.attitude.pitch_deg));
    if (maxTilt > 45) {
      imuStatus = 'WARNING';
      imuDetails = `Excessive tilt (${maxTilt.toFixed(1)}°)`;
    } else {
      imuStatus = 'OK';
      imuDetails = `Nominal • Roll: ${telemetry.attitude.roll_deg.toFixed(1)}°, Pitch: ${telemetry.attitude.pitch_deg.toFixed(1)}°`;
    }
  }

  // 2. GNSS Evaluation
  let gnssStatus: SensorStatusItem['status'] = 'NO DATA';
  let gnssDetails = 'No satellite lock';
  if (!isDisconnected && telemetry.gps.fix_type !== null) {
    const fix = telemetry.gps.fix_type;
    const sats = telemetry.gps.satellites ?? 0;
    if (fix >= 3 && sats >= 6) {
      gnssStatus = 'OK';
      gnssDetails = `3D Fix (${sats} sats tracked)`;
    } else if (fix === 2 || (fix >= 3 && sats < 6)) {
      gnssStatus = 'WARNING';
      gnssDetails = `Degraded fix (${sats} sats)`;
    } else {
      gnssStatus = 'ERROR';
      gnssDetails = 'No GPS fix acquired';
    }
  }

  // 3. BAROMETER Evaluation
  let baroStatus: SensorStatusItem['status'] = 'NO DATA';
  let baroDetails = 'No pressure/altitude report';
  if (!isDisconnected && telemetry.position.altitude_m !== null) {
    baroStatus = 'OK';
    baroDetails = `Active • MSL: ${telemetry.position.altitude_m.toFixed(1)}m, Rel: ${telemetry.position.relative_altitude_m?.toFixed(1) ?? '--'}m`;
  }

  const sensors: SensorStatusItem[] = [
    { name: 'Inertial Measurement Unit (IMU)', type: 'IMU', status: imuStatus, details: imuDetails },
    { name: 'GNSS Satellite Receiver', type: 'GNSS', status: gnssStatus, details: gnssDetails },
    { name: 'Barometric Altimeter', type: 'BAROMETER', status: baroStatus, details: baroDetails },
  ];

  const getStatusBadge = (st: SensorStatusItem['status']) => {
    switch (st) {
      case 'OK':
        return (
          <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.5 rounded">
            OK
          </span>
        );
      case 'WARNING':
        return (
          <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded">
            WARNING
          </span>
        );
      case 'ERROR':
        return (
          <span className="text-[10px] font-bold text-red-400 bg-red-500/10 border border-red-500/30 px-1.5 py-0.5 rounded animate-pulse">
            ERROR
          </span>
        );
      default:
        return (
          <span className="text-[10px] font-bold text-slate-500 bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded">
            NO DATA
          </span>
        );
    }
  };

  const getIcon = (type: SensorStatusItem['type']) => {
    switch (type) {
      case 'IMU':
        return <Compass className="w-4 h-4 text-cyan-400 shrink-0" />;
      case 'GNSS':
        return <Satellite className="w-4 h-4 text-emerald-400 shrink-0" />;
      case 'BAROMETER':
        return <Gauge className="w-4 h-4 text-sky-400 shrink-0" />;
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-3.5 flex flex-col justify-between">
      <div className="flex items-center justify-between pb-2 mb-2.5 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-cyan-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
            Prescribed Sensor Health
          </h3>
        </div>
        <span className="text-[10px] font-mono text-slate-400">ONBOARD TELEMETRY</span>
      </div>

      <div className="space-y-2 font-mono text-xs">
        {sensors.map((sensor) => (
          <div
            key={sensor.name}
            className="p-2 rounded bg-slate-950/70 border border-slate-800/80 flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {getIcon(sensor.type)}
              <div className="min-w-0">
                <span className="font-bold text-slate-200 text-[11px] block truncate">
                  {sensor.name}
                </span>
                <span className="text-[10px] text-slate-400 block truncate">
                  {sensor.details}
                </span>
              </div>
            </div>
            {getStatusBadge(sensor.status)}
          </div>
        ))}
      </div>
    </div>
  );
};
