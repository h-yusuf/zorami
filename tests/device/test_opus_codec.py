import struct

from app.device.opus_codec import decode, encode


def test_encode_decode_round_trip_preserves_length():
    n_samples = 960  # 60ms @ 16kHz mono
    pcm_in = struct.pack(f"<{n_samples}h", *([1000, -1000] * (n_samples // 2)))

    opus_packet = encode(pcm_in, sample_rate=16000, frame_duration_ms=60)
    assert isinstance(opus_packet, bytes)
    assert len(opus_packet) < len(pcm_in)

    pcm_out = decode(opus_packet, sample_rate=16000)
    assert len(pcm_out) == len(pcm_in)
