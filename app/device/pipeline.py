import json
from typing import AsyncIterator, TypedDict

from app.adapters.llm.base import LLMAdapter
from app.adapters.search.base import SearchAdapter
from app.adapters.stt.base import STTAdapter
from app.adapters.tts.base import TTSAdapter
from app.device.opus_codec import encode as opus_encode

_SEARCH_TOOL_SCHEMA = [
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Cari informasi terkini di internet, misalnya cuaca, berita, atau harga.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    }
]


class OutgoingEvent(TypedDict, total=False):
    kind: str
    text: str
    data: bytes


class Pipeline:
    def __init__(
        self,
        stt: STTAdapter,
        llm: LLMAdapter,
        tts: TTSAdapter,
        voice: str,
        system_prompt: str,
        search: SearchAdapter | None = None,
    ):
        self._stt = stt
        self._llm = llm
        self._tts = tts
        self._voice = voice
        self._system_prompt = system_prompt
        self._search = search

    async def handle_utterance(self, pcm_audio: bytes) -> AsyncIterator[OutgoingEvent]:
        stt_result = await self._stt.transcribe(pcm_audio, sample_rate=16000)
        yield OutgoingEvent(kind="stt", text=stt_result.text)

        messages = [
            {"role": "system", "content": self._system_prompt},
            {"role": "user", "content": stt_result.text},
        ]

        tools = _SEARCH_TOOL_SCHEMA if self._search is not None else None
        llm_result = await self._llm.complete(messages=messages, tools=tools)

        if llm_result.tool_calls and self._search is not None:
            call = llm_result.tool_calls[0]
            args = json.loads(call["function"]["arguments"])
            search_result = await self._search.search(args["query"], max_results=3)

            search_context = "\n".join(
                f"- {r['title']}: {r['snippet']}" for r in search_result.results
            )
            messages.append({"role": "assistant", "content": None, "tool_calls": llm_result.tool_calls})
            messages.append(
                {"role": "tool", "tool_call_id": call["id"], "content": search_context}
            )
            llm_result = await self._llm.complete(messages=messages)

        final_text = llm_result.text
        tts_result = await self._tts.synthesize(final_text, voice=self._voice)

        yield OutgoingEvent(kind="tts_start")
        yield OutgoingEvent(kind="tts_sentence", text=llm_result.text)

        frame_bytes = 2 * (tts_result.sample_rate * 60 // 1000)  # 16-bit mono, 60ms
        pcm = tts_result.pcm_audio
        for offset in range(0, len(pcm), frame_bytes):
            chunk = pcm[offset : offset + frame_bytes]
            if len(chunk) < frame_bytes:
                chunk = chunk + b"\x00" * (frame_bytes - len(chunk))
            opus_packet = opus_encode(chunk, sample_rate=tts_result.sample_rate, frame_duration_ms=60)
            yield OutgoingEvent(kind="audio_frame", data=opus_packet)

        yield OutgoingEvent(kind="tts_stop")
