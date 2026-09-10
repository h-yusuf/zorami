import time

from app.device.pacer import pace_frames


async def test_first_frame_sent_immediately():
    frames = [b"frame0", b"frame1", b"frame2"]
    start = time.monotonic()
    sent = []
    async for frame in pace_frames(frames, frame_duration_ms=60):
        sent.append((frame, time.monotonic() - start))

    assert sent[0][1] < 0.01
    assert [f for f, _ in sent] == frames


async def test_frames_spaced_by_frame_duration():
    frames = [b"a", b"b", b"c"]
    timestamps = []
    start = time.monotonic()
    async for _ in pace_frames(frames, frame_duration_ms=60):
        timestamps.append(time.monotonic() - start)

    gap_1 = timestamps[1] - timestamps[0]
    gap_2 = timestamps[2] - timestamps[1]
    assert 0.05 <= gap_1 <= 0.09
    assert 0.05 <= gap_2 <= 0.09


async def test_no_prebuffer_burst():
    frames = [b"x"] * 10
    start = time.monotonic()
    burst_count = 0
    async for _ in pace_frames(frames, frame_duration_ms=60):
        if time.monotonic() - start < 0.01:
            burst_count += 1
    assert burst_count == 1
