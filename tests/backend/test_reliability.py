"""Unit tests for VEGAPilot Telemetry Reliability Engine (Tests 1-9 from Section 38)."""
import time
import pytest
from app.reliability.engine import TelemetryReliabilityEngine


def test_scenario_1_sequential_packets_zero_loss():
    """Test 1: 1 2 3 4 5 -> Expected: zero loss"""
    engine = TelemetryReliabilityEngine(mission_id="TEST-01")
    now = int(time.time() * 1000)

    for seq in [1, 2, 3, 4, 5]:
        recv_seq, is_dup, is_ooo, is_rec = engine.process_incoming_packet(
            source_seq=seq,
            source_timestamp=now - 20,
            received_at_ms=now,
            is_valid=True,
        )
        assert not is_dup
        assert not is_ooo
        assert not is_rec

    health = engine.get_data_health()
    assert health.received_packets == 5
    assert health.missing_packets == 0
    assert health.duplicate_packets == 0
    assert health.out_of_order_packets == 0
    assert health.packet_loss_percent == 0.0


def test_scenario_2_missing_packet_gap():
    """Test 2: 1 2 4 5 -> Expected: 3 missing"""
    engine = TelemetryReliabilityEngine(mission_id="TEST-02")
    now = int(time.time() * 1000)

    for seq in [1, 2, 4, 5]:
        engine.process_incoming_packet(
            source_seq=seq,
            source_timestamp=now - 20,
            received_at_ms=now,
            is_valid=True,
        )

    health = engine.get_data_health()
    assert health.received_packets == 4
    assert health.missing_packets == 1
    assert 3 in engine.gaps
    assert engine.gaps[3]["status"] == "RECOVERING"


def test_scenario_3_duplicate_packet():
    """Test 3: 1 2 3 3 4 -> Expected: duplicate 3"""
    engine = TelemetryReliabilityEngine(mission_id="TEST-03")
    now = int(time.time() * 1000)

    results = []
    for seq in [1, 2, 3, 3, 4]:
        recv_seq, is_dup, is_ooo, is_rec = engine.process_incoming_packet(
            source_seq=seq,
            source_timestamp=now - 20,
            received_at_ms=now,
            is_valid=True,
        )
        results.append((seq, is_dup))

    health = engine.get_data_health()
    assert health.received_packets == 5
    assert health.duplicate_packets == 1
    # Check 4th item was marked duplicate
    assert results[3] == (3, True)


def test_scenario_4_out_of_order_packet():
    """Test 4: 1 2 4 3 5 -> Expected: out-of-order 3"""
    engine = TelemetryReliabilityEngine(mission_id="TEST-04")
    now = int(time.time() * 1000)

    results = []
    for seq in [1, 2, 4, 3, 5]:
        recv_seq, is_dup, is_ooo, is_rec = engine.process_incoming_packet(
            source_seq=seq,
            source_timestamp=now - 20,
            received_at_ms=now,
            is_valid=True,
        )
        results.append((seq, is_ooo, is_rec))

    health = engine.get_data_health()
    assert health.received_packets == 5
    assert health.out_of_order_packets == 1
    # Packet 3 was previously registered as gap when 4 arrived, then arrived -> is_rec=True, ooo
    assert results[3][0] == 3
    assert results[3][1] is True  # is_ooo


def test_scenario_5_corrupted_packet():
    """Test 5: corrupted packet -> Expected: invalid packet"""
    engine = TelemetryReliabilityEngine(mission_id="TEST-05")
    now = int(time.time() * 1000)

    recv_seq, is_dup, is_ooo, is_rec = engine.process_incoming_packet(
        source_seq=1,
        source_timestamp=now - 10,
        received_at_ms=now,
        is_valid=False,
    )

    health = engine.get_data_health()
    assert health.invalid_packets == 1


def test_scenario_6_and_7_disconnect_and_reconnect():
    """Test 6 & 7: disconnect -> DISCONNECTED, reconnect -> LIVE/RECONNECTED"""
    engine = TelemetryReliabilityEngine(mission_id="TEST-06-07")
    old_time = int(time.time() * 1000) - 10000  # 10 seconds ago

    engine.process_incoming_packet(
        source_seq=1,
        source_timestamp=old_time - 20,
        received_at_ms=old_time,
        is_valid=True,
    )

    health_disconnected = engine.get_data_health()
    assert health_disconnected.status == "DISCONNECTED"

    # Reconnect with fresh packet
    now = int(time.time() * 1000)
    engine.process_incoming_packet(
        source_seq=2,
        source_timestamp=now - 15,
        received_at_ms=now,
        is_valid=True,
    )

    health_reconnected = engine.get_data_health()
    assert health_reconnected.status == "LIVE"


def test_scenario_8_missing_packet_recovered():
    """Test 8: 1 2 4 5, then 3 arrives -> Expected: RECOVERED"""
    engine = TelemetryReliabilityEngine(mission_id="TEST-08")
    now = int(time.time() * 1000)

    for seq in [1, 2, 4, 5]:
        engine.process_incoming_packet(
            source_seq=seq,
            source_timestamp=now - 20,
            received_at_ms=now,
            is_valid=True,
        )

    assert engine.gaps[3]["status"] == "RECOVERING"

    # Retransmitted packet 3 arrives
    recv_seq, is_dup, is_ooo, is_rec = engine.process_incoming_packet(
        source_seq=3,
        source_timestamp=now,
        received_at_ms=now + 40,
        is_valid=True,
    )

    assert is_rec is True
    assert engine.gaps[3]["status"] == "RECOVERED"

    health = engine.get_data_health()
    assert health.recovered_packets == 1
    assert health.unrecovered_packets == 0


def test_scenario_9_unrecoverable_packet_timeout():
    """Test 9: missing packet not recoverable -> Expected: UNRECOVERED after timeout"""
    engine = TelemetryReliabilityEngine(mission_id="TEST-09")
    now = int(time.time() * 1000)

    # Inject gap from 4 seconds ago
    engine.process_incoming_packet(
        source_seq=1,
        source_timestamp=now - 4000,
        received_at_ms=now - 4000,
        is_valid=True,
    )
    engine.process_incoming_packet(
        source_seq=3,
        source_timestamp=now - 3500,
        received_at_ms=now - 3500,
        is_valid=True,
    )

    assert 2 in engine.gaps
    health = engine.get_data_health()
    assert health.unrecovered_packets == 1
    assert engine.gaps[2]["status"] == "UNRECOVERED"


def test_scenario_10_mavlink_8bit_sequence_wraparound():
    """Test 10: MAVLink 8-bit uint8 sequence wraparound: 254 -> 255 -> 0 -> 1 with zero false duplicates."""
    engine = TelemetryReliabilityEngine(mission_id="TEST-10-WRAP")
    now = int(time.time() * 1000)

    for seq in [254, 255, 0, 1, 2]:
        recv_seq, is_dup, is_ooo, is_rec = engine.process_incoming_packet(
            source_seq=seq,
            source_timestamp=now - 10,
            received_at_ms=now,
            is_valid=True,
        )
        assert is_dup is False, f"Sequence #{seq} wrongly marked as duplicate during wraparound"
        assert is_ooo is False, f"Sequence #{seq} wrongly marked as out-of-order during wraparound"

    health = engine.get_data_health()
    assert health.duplicate_packets == 0
    assert health.out_of_order_packets == 0
    assert health.missing_packets == 0

    # Test gap across wraparound: 254 -> 1 (missing 255, 0)
    engine_gap = TelemetryReliabilityEngine(mission_id="TEST-10-WRAP-GAP")
    engine_gap.process_incoming_packet(source_seq=254, source_timestamp=now, received_at_ms=now, is_valid=True)
    engine_gap.process_incoming_packet(source_seq=1, source_timestamp=now, received_at_ms=now, is_valid=True)

    assert 255 in engine_gap.gaps
    assert 0 in engine_gap.gaps
    assert engine_gap.highest_source_sequence == 1


def test_scenario_11_loss_percentage_triggers_degraded():
    """Test 11: Section 12 rule: loss > 5% marks connection as DEGRADED even when age < 1000ms."""
    engine = TelemetryReliabilityEngine(mission_id="TEST-11-LOSS-DEGRADED")
    now = int(time.time() * 1000)

    # 10 packets total: send 9 packets with 1 missing (10% loss)
    # Packets 1..5 arrive, 6 missing, 7..10 arrive
    for seq in [1, 2, 3, 4, 5, 7, 8, 9, 10]:
        engine.process_incoming_packet(
            source_seq=seq,
            source_timestamp=now - 50,
            received_at_ms=now - 10,  # age is only 10ms (< 1000ms)
            is_valid=True,
        )

    health = engine.get_data_health()
    # 1 missing out of 10 expected = 10% loss > 5%
    assert health.packet_loss_percent > 5.0
    assert health.last_packet_age_ms < 1000
    assert health.status == "DEGRADED"
